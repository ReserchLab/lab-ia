<p align="center"><img src="docs/icono.svg" width="96" alt="laboratorio.ia"></p>

<h1 align="center">laboratorio.ia</h1>

<p align="center"><b>Chat, investigación científica verificada e imágenes con IA.</b><br>
En tu propia cuenta de Cloudflare (gratis) o dentro de tu teléfono. Libre y sin publicidad.</p>

<p align="center"><b><a href="https://lab-ia-demo.reserchlab.workers.dev">▶ Pruébalo sin registrarte</a></b> (versión de prueba: chat e investigación, con límites diarios)</p>

<p align="center">
  <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/ReserchLab/lab-ia"><img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare"></a>
</p>
<p align="center">
  <a href="https://github.com/ReserchLab/lab-ia/stargazers"><img src="https://img.shields.io/github/stars/ReserchLab/lab-ia?style=flat&color=ff2d2d&label=%E2%98%85%20estrellas" alt="Estrellas"></a>
  <a href="https://github.com/ReserchLab/lab-ia/releases/latest"><img src="https://img.shields.io/github/v/release/ReserchLab/lab-ia?label=APK&color=111" alt="APK"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/licencia-MIT-111" alt="MIT"></a>
  <a href="https://labia-ciencia.pages.dev"><img src="https://img.shields.io/badge/web-labia--ciencia.pages.dev-111" alt="Web"></a>
</p>

---

## Qué hace

- **Chat** con decenas de modelos gratuitos (Workers AI, Kilo, OVH, Pollinations) y los de tus claves (Groq, Gemini, OpenRouter, Cerebras, Mistral, NVIDIA, GitHub Models…). El modo **auto** elige y, si un modelo falla, pasa al siguiente.
- **Investigar**: busca en 13 fuentes —PubMed, Europe PMC, Semantic Scholar, OpenAlex, Crossref, arXiv, UniProt, NCBI Gene, ClinicalTrials.gov, ChEMBL, PubChem, Wikipedia y la web—, lee las páginas y responde con citas **[n]** enlazadas.
- **Verificación automática y manual**: comprueba que cada cita exista, que cada enlace abra y que cada DOI esté registrado en Crossref; con la skill *Investigación verificada* revisa además cada afirmación contra su fuente. Tú marcas cada fuente como «revisada por mí». Cada respuesta trae el **enlace real de la búsqueda** en cada base (y Google Scholar) para repetirla.
- **Imágenes** con FLUX, Leonardo y SDXL (Workers AI) o Pollinations.
- **21 skills** (biología molecular, biomedicina y ensayos, fármacos, ecología, física y matemáticas, revisor de artículos, redacción científica, código científico, diseño experimental, scRNA-seq, nf-core…). Formato `SKILL.md` compatible con Claude: crea las tuyas a mano o describiéndolas a la IA.
- **Memoria del chat**: recuerda la conversación (resumen automático de lo antiguo + registro fijo de las referencias citadas). La puedes ver y editar.
- **Modelos por tarea**: uno para conversar, otro para investigar, razonar, programar e imágenes, con recomendaciones probadas.
- **Varios modelos a la vez**: compara 2-4 respuestas en pestañas, elige la mejor (★) y recibe una integrada.
- **Edita y regenera**: corrige cualquier pregunta anterior y vuelve a enviarla, o regenera la última respuesta. Valora cada respuesta con ▲ / ▼.
- **Entrena tu propio modelo**: tus valoraciones, ediciones, regeneraciones y elecciones se exportan como datos **SFT** y **DPO** (JSONL). Con **✦ Entrenar automáticamente**, laboratorio.ia genera más datos investigando tus temas, entrena un adaptador LoRA en la GPU gratis de Kaggle y lo sube a tu Workers AI, todo solo. También hay un [cuaderno de Colab](herramientas/entrenar/LEEME.md) para hacerlo a mano. Aparece como ★ tu modelo.
- **API compatible con OpenAI** con tu clave `labia-…`: usa tus modelos desde Codex, Cline o el SDK de OpenAI.
- Interfaz de matriz de puntos con **modo noche** (por defecto) y **modo día**, pensada para el móvil (Nothing, Android) y que se adapta a tablet y escritorio.

## <a id="nube"></a>Tu laboratorio.ia en Cloudflare (recomendado)

Todo corre en **tu** cuenta de Cloudflare: tus datos (D1), tus imágenes (KV), tus modelos (Workers AI) y tus claves, cifradas. El plan gratuito alcanza para uso personal.

1. Pulsa **Deploy to Cloudflare** (arriba). Conecta tu GitHub y tu Cloudflare; se crea una copia del proyecto, la base de datos y el almacén de imágenes.
2. Abre la dirección que te da (`https://lab-ia.<tu-subdominio>.workers.dev`) y **crea tu cuenta**: la primera es la de administrador. El registro queda cerrado; puedes abrirlo en Ajustes para tu familia o tu equipo.
3. Opcional: en **Ajustes → Modelos y proveedores** añade claves gratuitas (cada proveedor trae el enlace para conseguirla). Recomendadas: **Tavily** (búsqueda web), **Groq** y **Gemini**.
4. En la app de Android, en *Mi nube*, pega tu dirección.

<details><summary>Desplegar a mano con wrangler</summary>

La versión de prueba abierta usa `wrangler.demo.jsonc` (`DEMO = "si"`: invitados sin registro, límites diarios, sin imágenes ni Workers AI).


```bash
git clone https://github.com/ReserchLab/lab-ia && cd lab-ia
npm install
npx wrangler login
npm run deploy                       # crea D1 y KV y publica el Worker
npx wrangler secret put CLAVE_MAESTRA  # recomendado: cifra las claves con un secreto tuyo
```
</details>

**Límites del plan gratuito de Cloudflare:** 10 000 neuronas al día de Workers AI (un par de cientos de respuestas o unas decenas de imágenes; se reponen a las 00:00 UTC). Cuando se agotan, laboratorio.ia sigue con Kilo, OVH, Pollinations y tus claves. Algunas bases (OpenAlex, Semantic Scholar, arXiv) limitan las peticiones desde Cloudflare; el resto de fuentes cubre ese hueco.

## App de Android

Descarga **[lab.ia.apk](https://github.com/ReserchLab/lab-ia/releases/latest/download/lab.ia.apk)** (130 KB). Se conecta a tu nube, a tu teléfono (Termux) o a otro equipo de tu Wi-Fi; avisa con una notificación cuando termina una respuesta y guarda las imágenes en tu galería.

## En el teléfono, sin nube (Termux)

Para quien quiere todo local: laboratorio.ia y [FreeLLMAPI](https://github.com/tashfeenahmed/freellmapi) dentro de Debian en Termux, accesibles desde tu Wi-Fi con PIN. Instrucciones en **[termux/LEEME.md](termux/LEEME.md)**.

## API compatible con OpenAI

En **Ajustes → Tu clave de API** ves tu clave `labia-…`.

```bash
curl https://lab-ia.<tu-subdominio>.workers.dev/v1/chat/completions \
  -H "Authorization: Bearer labia-…" -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"hola"}]}'
```

`GET /v1/models`, `POST /v1/chat/completions` (con `stream`) y `POST /v1/images/generations`.

## Skills

Una skill es una carpeta con `SKILL.md`: el frontmatter de Claude (`name`, `description`) más campos opcionales de laboratorio.ia: `nombre`, `resumen`, `icono`, `modo` (chat · investigar · imagen), `fuentes`, `modelo`, `tarea`, `leer: si`, `verificacion: completa`, `categoria`. Una carpeta `references/` añade material de consulta. Para importar skills de Claude:

```bash
node herramientas/importar-skills.mjs servidor/skills /ruta/a/una-skill --modo investigar --fuentes pubmed,europepmc
```

## Estructura

| Carpeta | Qué es |
|---|---|
| `web/` | Interfaz (HTML, CSS y JS sin compilación), la misma en la nube y en el teléfono |
| `comun/` | Núcleo compartido: chat, investigación, memoria, verificación, fuentes, modelos por tarea, skills |
| `nube/` | Worker de Cloudflare: cuentas, D1, KV, Workers AI, enrutador de proveedores, API OpenAI |
| `servidor/` | Servidor del teléfono (Node, sin dependencias) sobre FreeLLMAPI; `servidor/skills/` = skills incluidas |
| `android/` | App (WebView nativo, notificaciones, integración con Termux) |
| `termux/` | Scripts `lab`, `ia` y `lab-servidor` |
| `docs/` | Página del proyecto (GitHub Pages) |

## Apoya el proyecto

Si laboratorio.ia te sirve: dale una **★ estrella** en GitHub y compártelo.

Donaciones en cripto:

| | Dirección |
|---|---|
| **Bitcoin (BTC)** | `bc1qd9j45f4t0jwyhjhqh2kvz2cr7k8xye460rr2y7` |
| **Monero (XMR)** | `447gTj6Hg6gaAEAUmjqfhqDZr1PziUTvbT4LYLpmLVnTNVFK6cqeqPfh6P4neMKLWX5jDXAr94fWHacJwDvjmCzBBH8wPBt` |
| **USDC** (red Arbitrum, mínimo 5) | `0xAC43f9b0E7F0ae6386cfC8ef6BFf62CE9c3006A1` |

Con código QR y botón para abrir tu billetera en [la página del proyecto](https://labia-ciencia.pages.dev/#apoyar).

¡Gracias!<br>
<sub>Hecho xhumanx + IA</sub>

## Licencia

[MIT](LICENSE). Las skills importadas de los plugins de Anthropic conservan su licencia Apache 2.0.
