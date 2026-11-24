# Lyra · Agentes

Una ventana para trabajar con varios agentes de programación a la vez —**Claude Code**, **Codex**, **Gemini CLI** y un **modelo local** con Ollama— y leer cada conversación como un documento ordenado, en vez de una terminal que se desplaza sin fin.

- **Conversaciones como documento:** el texto del agente en Markdown, las acciones (leer, editar, ejecutar) plegadas con su diff o su salida, y un índice para saltar entre tus mensajes.
- **Varios agentes al mismo tiempo:** la barra de la izquierda muestra quién te necesita, quién trabaja y quién terminó. El historial de los cuatro proveedores se agrupa por la carpeta de cada proyecto, y además puedes crear tus propias carpetas.
- **Sin diálogos:** el agente nuevo empieza al escribir. El proveedor, el modelo, el esfuerzo, los permisos y la carpeta son chips en la misma caja de texto, y se pueden cambiar en cualquier momento (Shift+Tab cambia los permisos, como en la terminal).
- **Límites de uso a la vista:** abajo en la barra, cuánto usaste de Claude y de Codex (la ventana de 5 horas y la semanal), con la hora en que se renueva cada una. Se actualiza solo y al tocar «Uso».
- **Permisos y preguntas en línea:** aprobar, rechazar con un motivo o responder sin salir del documento.
- **Visor al costado:** muestra Markdown, imágenes, video y audio, PDF, Word, presentaciones y hojas de cálculo, sin abrir otra app. «Abrir con…» ofrece las apps de tu escritorio que abren ese archivo.
- **Ventana propia:** GTK4 + WebKitGTK (unos 300 MB), no un navegador. También se puede usar desde un navegador.

Todo corre en tu computadora: un servidor local (127.0.0.1) maneja a los agentes con tus propias cuentas y la ventana lo muestra.

## Requisitos

- Linux con un escritorio que use archivos `.desktop` (probado en Hyprland).
- [Node.js](https://nodejs.org) 24 o más nuevo (el servidor corre TypeScript directamente).
- Para la ventana: Python 3 con PyGObject, GTK 4 y WebKitGTK 6.0 (en Arch: `python-gobject gtk4 webkitgtk-6.0`). Para video, los plugins de GStreamer (`gst-libav`, `gst-plugins-good`).
- Al menos uno de estos, con tu sesión iniciada:
  - **Claude Code** (`claude`): viene con el Agent SDK de Anthropic.
  - **Codex** (`codex`): se usa con `codex app-server`.
  - **Gemini CLI** (`gemini`): se usa con `gemini --acp`.
  - **Ollama** con un modelo que sepa usar herramientas (ver más abajo).
- Opcional: **LibreOffice**, para ver presentaciones, hojas de cálculo y documentos `.doc` en el visor. Los `.docx` y los PDF se ven sin él.

## Instalación

```sh
git clone https://github.com/MegaloIV/lyra-agentes.git
cd lyra-agentes
npm install
ln -s "$PWD/bin/lyra-agentes" ~/.local/bin/lyra-agentes
lyra-agentes --instalar   # la agrega al menú de aplicaciones, con su ícono
```

Al abrirse por primera vez, el lanzador construye la interfaz y arranca el servidor.

## Uso

```sh
lyra-agentes             # abre la ventana (y arranca el servidor si hace falta)
lyra-agentes --cerrar    # cierra la ventana; el servidor y los agentes siguen
lyra-agentes --detener   # detiene el servidor (cierra los agentes abiertos)
lyra-agentes --log       # muestra el registro del servidor
lyra-agentes --instalar  # la agrega al menú de aplicaciones
```

**Límites de uso:** los de Claude son los del plan de claude.ai (los mismos de `/usage`); con una clave de API no hay. Los de Codex son los de tu cuenta de ChatGPT. Gemini CLI no informa su cuota a otras apps, así que su fila solo dice si tiene sesión. El agente local no tiene límites.

Atajos: Alt+N agente nuevo, Ctrl+K ir a la caja, Ctrl+I índice, Ctrl+O visor y Shift+Tab siguiente modo de permisos.

## Agente local (Ollama)

El proveedor **Local** usa el mismo Claude Code, pero apuntado a un Ollama de tu máquina mediante su API compatible con la de Anthropic. Tus archivos y conversaciones no salen de la computadora.

- Solo aparecen los modelos que saben usar herramientas y tienen al menos 16k de contexto. Claude Code manda instrucciones largas, así que conviene 32k o más:

  ```sh
  printf 'FROM qwen3:8b\nPARAMETER num_ctx 65536\n' > Modelfile
  ollama create qwen3-agente -f Modelfile
  ```

- El agente local solo recibe las herramientas básicas: leer, escribir, editar, Bash, Glob, Grep y la lista de tareas. Así las instrucciones caben y un modelo chico no se pierde.
- Es bastante más lento que los proveedores en la nube: en una laptop, una tarea simple puede tardar unos minutos.
- Si Ollama no está corriendo, el servidor lo arranca (`ollama serve`) y lo deja encendido.

## Configuración

Variables de entorno; también se pueden escribir, una por línea, en `~/.config/lyra-agentes/entorno`, que el lanzador lee al arrancar:

| Variable | Para qué |
| --- | --- |
| `LYRA_AGENTES_PUERTO` | Puerto del servidor (4317 por defecto). |
| `LYRA_AGENTES_OLLAMA` | Dirección de Ollama (`http://127.0.0.1:11434` por defecto). |
| `LYRA_AGENTES_OLLAMA_BIN` | Ejecutable de Ollama, si no está en el PATH. |
| `OLLAMA_MODELS` | Carpeta de modelos de Ollama, si no es la de siempre. |
| `LYRA_AGENTES_TERMINAL` | Terminal para «Abrir terminal aquí» (si no, `$TERMINAL` o la primera instalada). |
| `LYRA_AGENTES_GPU` | Si tiene algún valor, la ventana no fuerza la tarjeta integrada en equipos con dos. |

**Transparencia:** en la ventana propia, la barra de la izquierda y la lectura, el índice y el visor (más oscuros) son translúcidos (90 %), con el fondo desenfocado; sin foco, el compositor baja toda la ventana a 85 %. El desenfoque lo hace el compositor: la ventana lo pide con `backdrop-filter` (GTK 4.24 o más nuevo, protocolo `ext-background-effect`). Si tu compositor le pone opacidad a todas las ventanas, quítasela a esta (dejando solo una baja cuando no tiene el foco) para que no se sume. En Hyprland:

```lua
hl.window_rule({ name = "lyra_agentes", match = { class = "^(io\\.lyra\\.Agentes)$" }, opacity = "1.0 override 0.85 override" })
```

Las opacidades se cambian con las variables CSS `--opacidad-barra` y `--opacidad-lectura` en `web/estilo.css`.

El estado se guarda en `~/.local/state/lyra-agentes/`: el token, las carpetas propias y el registro de las sesiones locales. Las conversaciones quedan donde las guarda cada CLI (`~/.claude`, `~/.codex`, `~/.gemini`).

## Seguridad

- El servidor escucha solo en 127.0.0.1 y exige un token aleatorio, guardado con permisos 600, en cada conexión. Además comprueba el origen.
- El visor solo muestra archivos de tu carpeta personal, `/tmp` y `/mnt/shared`, nunca de carpetas ocultas como `~/.ssh`. Resuelve los enlaces simbólicos antes de comprobar la ruta. El HTML se muestra sin scripts.
- Borrar una conversación no es definitivo: las de Claude, Gemini y las locales van a la papelera del escritorio, y las de Codex se archivan.

## Desarrollo

```sh
LYRA_AGENTES_DESARROLLO=1 npm run server   # el servidor, aceptando la interfaz de Vite
npm run dev         # en otra terminal: la interfaz con recarga en http://127.0.0.1:5173/?t=TOKEN
npm test            # pruebas (node --test)
npm run typecheck
```

- `servidor/` tiene un archivo por proveedor (`claude.ts`, `codex.ts`, `gemini.ts`, `local.ts`), que implementan la interfaz común de `motor.ts`. `normalizar*.ts` convierte los mensajes de cada uno en bloques del documento.
- `web/` es la interfaz, hecha con Preact.
- `ventana/ventana.py` es la ventana GTK.
