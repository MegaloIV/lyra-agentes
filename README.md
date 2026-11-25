# Lyra · Agentes

Una ventana para trabajar con varios agentes de programación a la vez —**Claude Code**, **Codex** y un **modelo local** con Ollama— y leer cada conversación como un documento ordenado, en vez de una terminal que se desplaza sin fin.

- **Conversaciones como documento:** el texto del agente en Markdown, las acciones (leer, editar, ejecutar) plegadas con su diff o su salida, y un índice para saltar entre tus mensajes.
- **Varios agentes al mismo tiempo:** la barra de la izquierda muestra quién te necesita, quién trabaja y quién terminó. El historial de los cuatro proveedores se agrupa por la carpeta de cada proyecto (cada una en un cuadro gris con borde blanco), por día o por semana, y se carga completo (no solo las más recientes). Además puedes crear tus propias carpetas. El botón «Abrir en otro escritorio» de cada proyecto abre su carpeta en el gestor de archivos, en un escritorio vacío (en Hyprland; en otros escritorios, solo la abre).
- **Sin diálogos:** el agente nuevo empieza al escribir. El proveedor, el modelo, el esfuerzo, los permisos y la carpeta son chips en la misma caja de texto, y se pueden cambiar en cualquier momento (Shift+Tab cambia los permisos, como en la terminal). Al retomar una conversación del historial también se eligen el modelo, el esfuerzo y los permisos con que sigue; si no se toca nada, sigue con los predeterminados. El chip de la carpeta tiene sus carpetas recientes y un explorador para subir y bajar de nivel en el mismo menú, sin abrir otra ventana.
- **Límites de uso a la vista:** abajo en la barra, cuánto usaste de Claude y de Codex (la ventana de 5 horas y la semanal), con la hora en que se renueva cada una. Se actualiza solo y al tocar «Uso».
- **Permisos y preguntas en línea:** aprobar, rechazar con un motivo o responder sin salir del documento.
- **Memorias al costado:** lo que recuerda o lee siempre cada agente (Claude, Codex y el local) para la carpeta de la conversación, lo general y, en Claude, la memoria de los otros proyectos. Tocar un archivo lo abre en el visor.
- **GitHub al costado:** la rama de la carpeta del agente, los cambios sin commit (con su diff), los commits recientes, el PR de la rama con sus pruebas (CI) y los issues abiertos. Si una prueba falla, «Pasarle el error» pone su registro en la caja; cada issue tiene un botón para que lo resuelva el agente. Los botones solo escriben el encargo en la caja: tú decides si lo mandas.
- **Visor al costado:** muestra Markdown, imágenes, video y audio, PDF, Word, presentaciones y hojas de cálculo, sin abrir otra app. «Abrir con…» ofrece las apps de tu escritorio que abren ese archivo, y la papelera (dos clics) lo manda a la papelera del escritorio, de donde se recupera.
- **Ventana propia:** GTK4 + WebKitGTK (unos 300 MB), no un navegador. También se puede usar desde un navegador. El clic derecho (o el toque con dos dedos) solo muestra copiar, cortar, pegar y la ortografía donde hay texto; nada de Atrás, Adelante ni Recargar.

Todo corre en tu computadora: un servidor local (127.0.0.1) maneja a los agentes con tus propias cuentas y la ventana lo muestra.

## Requisitos

- Linux con un escritorio que use archivos `.desktop` (probado en Hyprland).
- [Node.js](https://nodejs.org) 24 o más nuevo (el servidor corre TypeScript directamente).
- Para la ventana: Python 3 con PyGObject, GTK 4 y WebKitGTK 6.0 (en Arch: `python-gobject gtk4 webkitgtk-6.0`). Para video, los plugins de GStreamer (`gst-libav`, `gst-plugins-good`).
- Al menos uno de estos, con tu sesión iniciada:
  - **Claude Code** (`claude`): viene con el Agent SDK de Anthropic.
  - **Codex** (`codex`): se usa con `codex app-server`.
  - **Ollama** con un modelo que sepa usar herramientas (ver más abajo).
- Opcional: **GitHub CLI** (`gh`) con `gh auth login`, para ver PRs, pruebas e issues en la pestaña GitHub. Sin él se ve todo lo de git.
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

**Límites de uso:** los de Claude son los del plan de claude.ai (los mismos de `/usage`); con una clave de API no hay. Los de Codex son los de tu cuenta de ChatGPT. El agente local no tiene límites.

**Panel de la derecha:** sus pestañas están abajo en la barra izquierda, sobre el uso: índice, visor, GitHub, terminales del agente, memorias, tus terminales y notas (post-its que se guardan solos y se ven en todas las conversaciones). El último botón de esa fila cambia el ancho: si algo no está en su tamaño de siempre lo restablece; si ya lo está, lleva el panel al máximo (crece la mitad de lo que haría falta para tapar el nombre de la sesión).

Atajos: Alt+N agente nuevo, Ctrl+K ir a la caja, Ctrl+I índice, Ctrl+O visor, Ctrl+G GitHub, Ctrl+M memorias, Ctrl+T terminales, Ctrl+Shift+T tus terminales, Ctrl+Shift+N notas y Shift+Tab siguiente modo de permisos.

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

En LyraAgentes, Claude empieza con **Opus 5.5** (`claude-opus-5-5`). Para Claude y Codex,
**Normal** equivale a esfuerzo **Alto** (`high`), tanto al crear como al retomar una sesión o volver
a elegir Normal. Las selecciones explícitas se respetan. El modelo predeterminado de Codex sigue
siendo el de su configuración; su menú se obtiene del catálogo de `codex app-server`.

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

El estado se guarda en `~/.local/state/lyra-agentes/`: el token, las carpetas propias y el registro de las sesiones locales. Las conversaciones quedan donde las guarda cada CLI (`~/.claude`, `~/.codex`).

## Seguridad

- El servidor escucha solo en 127.0.0.1 y exige un token aleatorio, guardado con permisos 600, en cada conexión. Además comprueba el origen.
- La pestaña GitHub solo lee: git sin fsmonitor, diff externo ni textconv (un repo ajeno no puede hacer que ejecute programas suyos) y `gh` con la sesión que ya tienes; la app no guarda tokens. Solo lee repos de tu carpeta personal, `/tmp` y `/mnt/shared`.
- El visor solo muestra archivos de tu carpeta personal, `/tmp` y `/mnt/shared`, nunca de carpetas ocultas como `~/.ssh`. Resuelve los enlaces simbólicos antes de comprobar la ruta. El HTML se muestra sin scripts. Borrar desde el visor sigue las mismas reglas y nunca es definitivo: solo mueve a la papelera (en `/tmp`, que no tiene, no borra). El explorador de carpetas solo lista nombres de carpetas, sin las ocultas.
- Borrar una conversación no es definitivo: las de Claude y las locales van a la papelera del escritorio, y las de Codex se archivan.

## Desarrollo

```sh
LYRA_AGENTES_DESARROLLO=1 npm run server   # el servidor, aceptando la interfaz de Vite
npm run dev         # en otra terminal: la interfaz con recarga en http://127.0.0.1:5173/?t=TOKEN
npm test            # pruebas (node --test)
npm run typecheck
```

- `servidor/` tiene un archivo por proveedor (`claude.ts`, `codex.ts`, `local.ts`), que implementan la interfaz común de `motor.ts`. `normalizar*.ts` convierte los mensajes de cada uno en bloques del documento.
- `web/` es la interfaz, hecha con Preact.
- `ventana/ventana.py` es la ventana GTK.

En la caja: Ctrl+C sin selección detiene el agente; Ctrl+X seguido de Ctrl+S en 1,5 segundos envía ya: si el agente está trabajando, lo interrumpe y manda el mensaje enseguida (Enter, en cambio, lo deja en cola). Con selección se conservan copiar y cortar; sin ella, Ctrl+X no hace nada (antes sonaba). Ctrl+S solo no guarda la página. El contador «Pensando…» flota sobre la caja, y los ajustes se compactan si la caja se angosta, así nada se descuadra.

Sobre la caja, **Ir al final** aparece cuando te alejas del final y se oculta al volver abajo. Si escribes mientras
el agente responde, el documento deja de seguir la respuesta hasta que vuelvas al final.
Puedes pegar imágenes del portapapeles, pegar o arrastrar archivos, o elegirlos con **+**. Se muestran como
`[imagen 1]`, `[archivo 1]`, etc.; al enviar se añaden sus rutas locales al mensaje. Las subidas tienen un límite
de 25 MB por archivo y se conservan en `~/.local/state/lyra-agentes/adjuntos/` para poder retomar la conversación.
Los archivos pegados como URI local conservan su ruta original. El botón × quita el adjunto del borrador.

Con el perfil de energía en «ahorro», WebKit dibuja a 30 cuadros por segundo y escribir se siente lento; la ventana lo ignora y dibuja a 60. Para respetar el ahorro: `LYRA_AHORRO=1 lyra-agentes`.
