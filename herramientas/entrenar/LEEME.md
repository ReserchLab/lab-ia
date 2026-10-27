# Entrena tu propio modelo con laboratorio.ia

Cada vez que usas laboratorio.ia dejas señales de lo que es una buena respuesta para ti:

| Señal | Cómo se da | Qué produce |
|---|---|---|
| ▲ / ▼ | Botones bajo cada respuesta | ▲ entra en *SFT solo ▲*; ▼ se excluye del SFT |
| Regenerar | «regenerar» en la última respuesta | Par DPO: la nueva (mejor) frente a la descartada |
| Editar | «✎ editar» en cualquier pregunta | La pregunta y respuesta anteriores quedan en *señales* |
| Combinar modelos | ⧉ Combinar + «☆ Esta fue la mejor» | Pares DPO: la elegida (o la integrada) frente a las demás |
| Revisión manual | «revisada por mí» en las fuentes | Queda en *señales* |

Los datos no salen de tu laboratorio.ia hasta que tú los descargas.

## 1. Descarga los datos

**Ajustes → Entrenar tu propio modelo**:

- **SFT** (`{"messages":[…]}`): todas tus respuestas salvo las ▼, con el contexto de la conversación y los resultados de búsqueda que tuvo el modelo (así aprende a citar solo lo que tiene delante).
- **SFT solo ▲**: menos ejemplos, pero los mejores.
- **DPO** (`{"prompt":[…],"chosen":[…],"rejected":[…]}`): pares de preferencia.
- **Señales**: todo en crudo, para analizarlo.

Es el formato de chat de OpenAI y Hugging Face: sirve para Unsloth, TRL, Axolotl, AutoTrain o el ajuste fino de OpenAI. Con unos 50 ejemplos SFT o 30 pares DPO ya se nota el cambio. Con varios cientos, mucho más.

## 2. Entrena gratis en Google Colab

[**▶ Abrir el cuaderno en Colab**](https://colab.research.google.com/github/ReserchLab/lab-ia/blob/main/herramientas/entrenar/entrenar.ipynb)

1. *Entorno de ejecución → Cambiar tipo de entorno → GPU T4* (gratis).
2. Elige `MODO` (sft o dpo), `BASE` y un `NOMBRE`.
3. Ejecuta las celdas en orden y sube tu `.jsonl` cuando lo pida.
4. La última celda sube el adaptador a tu Cloudflare. Necesita tu **ID de cuenta** y un **token con permiso «Workers AI: Edit»** ([crear token](https://dash.cloudflare.com/profile/api-tokens), plantilla «Workers AI»).

| Base | En Workers AI | Notas |
|---|---|---|
| Llama 3.2 3B Instruct | `@cf/meta/llama-3.2-3b-instruct` | Recomendado: ~20 min en una T4 |
| Mistral 7B Instruct v0.2 | `@cf/mistral/mistral-7b-instruct-v0.2-lora` | Más capaz, más lento |
| Gemma 7B / 2B it | `@cf/google/gemma-7b-it-lora` / `gemma-2b-it-lora` | En beta en Workers AI |

Límites de Workers AI: rango LoRA ≤ 32, archivo < 300 MB, hasta 100 adaptadores por cuenta. El cuaderno usa rango 8 sobre `q_proj` y `v_proj`, la configuración que documenta Cloudflare.

Sin el cuaderno, con wrangler:

```bash
npx wrangler ai finetune create @cf/meta/llama-3.2-3b-instruct mi-laboratorio-v1 ./adaptador
npx wrangler ai finetune list
```

## 3. Úsalo en laboratorio.ia

**Ajustes → Entrenar tu propio modelo → Usa tu modelo aquí**: elige la base y escribe el nombre. laboratorio.ia lo prueba en ese momento y lo añade al selector de modelos como **★ tu modelo**. Puedes asignarlo a una tarea o combinarlo con otros modelos y seguir valorando sus respuestas. Así cada versión aprende de la anterior.

En el teléfono (Termux), el `.zip` que descarga el cuaderno se carga con el modelo base en Ollama, LM Studio o llama.cpp.

## Qué esperar

Un modelo de 3B a 7B ajustado con tus datos no supera a los grandes modelos en conocimiento general. Lo que aprende es tu estilo, tu formato, tus temas y a citar las fuentes que recibe. Para el conocimiento sigue usando *Investigar*: así tu modelo responde con fuentes reales.

Privacidad: revisa el `.jsonl` antes de compartirlo. Contiene tus preguntas y respuestas.
