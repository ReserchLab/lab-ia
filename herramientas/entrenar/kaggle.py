# laboratorio.ia · entrenamiento automático en Kaggle (GPU gratuita).
# laboratorio.ia lo envía a tu cuenta de Kaggle con estas variables al principio:
#   DATOS_URL  enlace de un solo uso a tus datos (SFT y DPO), que caduca al terminar
#   BASE       llama-3.2-3b | mistral-7b | gemma-7b | gemma-2b
#   EPOCAS, MAX_TOKENS
# Deja en /kaggle/working: adapter_model.safetensors, adapter_config.json y resultado.json.
# También sirve a mano: define esas variables y ejecútalo en un cuaderno con GPU.
import json, os, subprocess, sys, time, urllib.request

inicio = time.time()
SALIDA = "/kaggle/working" if os.path.isdir("/kaggle/working") else os.path.abspath("salida")
os.makedirs(SALIDA, exist_ok=True)
resultado = {"fase": "inicio"}


def guardar_resultado(**cambios):
    resultado.update(cambios, segundos=int(time.time() - inicio))
    with open(os.path.join(SALIDA, "resultado.json"), "w") as f:
        json.dump(resultado, f, ensure_ascii=False, indent=1)


def paso(nombre):
    print(f"\n=== {nombre} ({int(time.time() - inicio)} s) ===", flush=True)
    guardar_resultado(fase=nombre)


BASES = {
    "llama-3.2-3b": dict(hf="unsloth/Llama-3.2-3B-Instruct", tipo="llama", sistema=True),
    "mistral-7b": dict(hf="unsloth/mistral-7b-instruct-v0.2", tipo="mistral", sistema=False),
    "gemma-7b": dict(hf="unsloth/gemma-7b-it", tipo="gemma", sistema=False),
    "gemma-2b": dict(hf="unsloth/gemma-2b-it", tipo="gemma", sistema=False),
}
B = BASES[globals().get("BASE", "llama-3.2-3b")]
EPOCAS = int(globals().get("EPOCAS", 2))
MAX_TOKENS = int(globals().get("MAX_TOKENS", 4096))
RANGO, MODULOS = 8, ["q_proj", "v_proj"]  # lo que acepta Workers AI (rango <= 32)

try:
    paso("datos")
    with urllib.request.urlopen(urllib.request.Request(DATOS_URL, headers={"User-Agent": "laboratorio-ia-kaggle"}), timeout=120) as r:
        datos = json.load(r)
    sft, dpo = datos.get("sft", []), datos.get("dpo", [])
    print(len(sft), "ejemplos SFT ·", len(dpo), "pares DPO")
    if len(sft) < 10:
        raise SystemExit("Hacen falta al menos 10 ejemplos SFT")
    guardar_resultado(sft=len(sft), dpo=len(dpo))

    paso("instalar")
    subprocess.run([sys.executable, "-m", "pip", "install", "-q", "unsloth"], check=True)

    paso("modelo")
    from unsloth import FastLanguageModel
    import torch
    model, tokenizer = FastLanguageModel.from_pretrained(B["hf"], max_seq_length=MAX_TOKENS, load_in_4bit=True)
    model = FastLanguageModel.get_peft_model(model, r=RANGO, lora_alpha=RANGO * 2, lora_dropout=0, target_modules=MODULOS,
                                             bias="none", use_gradient_checkpointing="unsloth", random_state=7)

    def plano(mensajes):
        """Mistral y Gemma no tienen rol «system»: se une a la primera pregunta."""
        if B["sistema"] or not mensajes or mensajes[0]["role"] != "system":
            return mensajes
        resto = [dict(m) for m in mensajes[1:]]
        if resto and resto[0]["role"] == "user":
            resto[0]["content"] = mensajes[0]["content"] + "\n\n" + resto[0]["content"]
        return resto

    def recortar(texto, n=MAX_TOKENS * 3):
        return texto if len(texto) <= n else texto[-n:]

    import inspect
    from datasets import Dataset

    def con_firma(clase, **kw):
        """Las versiones de TRL cambian nombres de parámetros; se pasan solo los que existen."""
        p = inspect.signature(clase.__init__).parameters
        if "max_seq_length" in kw and "max_seq_length" not in p:
            kw["max_length"] = kw.pop("max_seq_length")
        return {k: v for k, v in kw.items() if k in p}

    comun = dict(per_device_train_batch_size=2, gradient_accumulation_steps=4, warmup_steps=5, logging_steps=5,
                 optim="adamw_8bit", lr_scheduler_type="linear", seed=7, output_dir="/tmp/salida", report_to="none",
                 fp16=not torch.cuda.is_bf16_supported(), bf16=torch.cuda.is_bf16_supported(), save_strategy="no")

    paso("sft")
    from trl import SFTTrainer, SFTConfig
    textos = [recortar(tokenizer.apply_chat_template(plano(f["messages"]), tokenize=False)) for f in sft]
    args = SFTConfig(**con_firma(SFTConfig, learning_rate=2e-4, num_train_epochs=EPOCAS, dataset_text_field="text", max_seq_length=MAX_TOKENS, **comun))
    entrenador = SFTTrainer(**con_firma(SFTTrainer, model=model, train_dataset=Dataset.from_dict({"text": textos}), args=args, tokenizer=tokenizer, processing_class=tokenizer))
    r = entrenador.train()
    guardar_resultado(perdida_sft=round(float(r.training_loss), 4))

    def guardar_adaptador():
        model.save_pretrained("/tmp/adaptador")
        cfg = json.load(open("/tmp/adaptador/adapter_config.json"))
        cfg["model_type"] = B["tipo"]  # Workers AI lo exige: llama, mistral o gemma
        json.dump(cfg, open(os.path.join(SALIDA, "adapter_config.json"), "w"), indent=2)
        os.replace("/tmp/adaptador/adapter_model.safetensors", os.path.join(SALIDA, "adapter_model.safetensors"))

    guardar_adaptador()  # el de SFT queda a salvo aunque falle el DPO

    if len(dpo) >= 20:
        try:
            paso("dpo")
            from unsloth import PatchDPOTrainer
            PatchDPOTrainer()
            from trl import DPOTrainer, DPOConfig

            def fila(f):
                prompt = tokenizer.apply_chat_template(plano(f["prompt"]), tokenize=False, add_generation_prompt=True)
                return {"prompt": recortar(prompt, MAX_TOKENS * 2), "chosen": f["chosen"][0]["content"] + tokenizer.eos_token, "rejected": f["rejected"][0]["content"] + tokenizer.eos_token}

            args = DPOConfig(**con_firma(DPOConfig, learning_rate=5e-6, num_train_epochs=1, beta=0.1, max_length=MAX_TOKENS, max_prompt_length=MAX_TOKENS // 2, **comun))
            r = DPOTrainer(**con_firma(DPOTrainer, model=model, ref_model=None, train_dataset=Dataset.from_list([fila(f) for f in dpo]), args=args, tokenizer=tokenizer, processing_class=tokenizer)).train()
            guardar_resultado(perdida_dpo=round(float(r.training_loss), 4))
            guardar_adaptador()
        except Exception as e:  # el adaptador SFT ya está guardado
            print("DPO falló:", e)
            guardar_resultado(error_dpo=str(e)[:500])

    paso("prueba")
    FastLanguageModel.for_inference(model)
    mensajes = plano([{"role": "system", "content": "Eres laboratorio.ia, un asistente de investigación científica."},
                      {"role": "user", "content": sft[0]["messages"][-2]["content"].split("\n\n---\n")[0][:500]}])
    ids = tokenizer.apply_chat_template(mensajes, add_generation_prompt=True, return_tensors="pt").to("cuda")
    salida = model.generate(input_ids=ids, max_new_tokens=300, temperature=0.4, do_sample=True)
    guardar_resultado(muestra=tokenizer.decode(salida[0][ids.shape[1]:], skip_special_tokens=True)[:1500])

    tam = os.path.getsize(os.path.join(SALIDA, "adapter_model.safetensors")) / 1e6
    print(f"adapter_model.safetensors: {tam:.1f} MB")
    guardar_resultado(fase="listo", mb=round(tam, 1))
except BaseException as e:
    guardar_resultado(fase="error", error=f"{type(e).__name__}: {e}"[:1500])
    raise
