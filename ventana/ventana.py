#!/usr/bin/env python3
"""Ventana propia de Lyra · Agentes: GTK4 + WebKitGTK (mucho más liviana que un navegador).

No es un navegador: no hay pestañas, barra ni extensiones; solo muestra la página del servidor local
(127.0.0.1). Los enlaces de afuera se abren en el navegador predeterminado.

Uso: ventana.py URL        (la URL trae el token: ?t=…)
Una sola instancia: si ya está abierta, la trae al frente.
"""
import os
import subprocess
import sys
from urllib.parse import urlparse

import gi

gi.require_version("Gtk", "4.0")
gi.require_version("Gdk", "4.0")
gi.require_version("WebKit", "6.0")
from gi.repository import Gdk, Gio, GLib, Gtk, WebKit  # noqa: E402

# La ventana es transparente y la página decide cuánto: la barra de la izquierda deja ver el fondo del
# escritorio y la lectura y el panel derecho quedan opacos. Para eso, en Hyprland conviene que la ventana
# no tenga opacidad propia (regla `opacity = "1.0 override 1.0 override"` para la clase io.lyra.Agentes).
TRANSPARENTE = "rgba(0,0,0,0)"
DATOS = os.path.join(GLib.get_user_data_dir(), "lyra-agentes", "web")
CACHE = os.path.join(GLib.get_user_cache_dir(), "lyra-agentes")
DESCARGAS = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOWNLOAD) or os.path.expanduser("~")


class Ventana(Gtk.Application):
    def __init__(self) -> None:
        super().__init__(application_id="io.lyra.Agentes", flags=Gio.ApplicationFlags.HANDLES_COMMAND_LINE)
        self.ventana: Gtk.ApplicationWindow | None = None
        self.vista: WebKit.WebView | None = None
        self.origen = ""

    def do_command_line(self, linea: Gio.ApplicationCommandLine) -> int:
        args = linea.get_arguments()[1:]
        if self.ventana:                      # segunda vez: solo traerla al frente
            self.ventana.present()
            return 0
        if not args:
            linea.printerr("Falta la URL\n")
            return 1
        self.abrir(args[0])
        return 0

    def abrir(self, url: str) -> None:
        u = urlparse(url)
        self.origen = f"{u.scheme}://{u.netloc}"
        sesion = WebKit.NetworkSession.new(DATOS, CACHE)
        sesion.connect("download-started", self.al_descargar)

        contenido = WebKit.UserContentManager()
        # Avisa a la página que está en esta ventana (antes de que se dibuje nada), para que use fondos translúcidos
        contenido.add_script(WebKit.UserScript.new("document.documentElement.dataset.ventana = 'gtk';",
            WebKit.UserContentInjectedFrames.TOP_FRAME, WebKit.UserScriptInjectionTime.START, None, None))
        self.vista = vista = WebKit.WebView(network_session=sesion, user_content_manager=contenido)
        ajustes = vista.get_settings()
        ajustes.set_javascript_can_access_clipboard(True)
        ajustes.set_enable_developer_extras("--depurar" in sys.argv)
        ajustes.set_enable_back_forward_navigation_gestures(False)
        color = Gdk.RGBA()
        color.parse(TRANSPARENTE)
        vista.set_background_color(color)
        vista.connect("decide-policy", self.al_decidir)
        vista.connect("notify::title", lambda v, _p: self.ventana and self.ventana.set_title(v.get_title() or "Lyra"))
        vista.connect("web-process-terminated", lambda v, _r: GLib.timeout_add(500, lambda: v.reload() and False))

        self.ventana = ventana = Gtk.ApplicationWindow(application=self, title="Lyra")
        ventana.set_default_size(1280, 860)
        ventana.set_icon_name("lyra-agentes")
        ventana.set_child(vista)
        ventana.add_css_class("lyra-transparente")
        css = Gtk.CssProvider()
        css.load_from_string("window.lyra-transparente { background: transparent; }")
        Gtk.StyleContext.add_provider_for_display(ventana.get_display(), css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
        teclas = Gtk.EventControllerKey()
        teclas.connect("key-pressed", self.al_tecla)
        ventana.add_controller(teclas)
        vista.load_uri(url)
        ventana.present()

    def al_tecla(self, _c, tecla: int, _codigo: int, estado: Gdk.ModifierType) -> bool:
        """Ctrl + / − / 0: tamaño de la letra (zoom). Ctrl+R: recargar."""
        if not estado & Gdk.ModifierType.CONTROL_MASK or not self.vista:
            return False
        v = self.vista
        if tecla in (Gdk.KEY_plus, Gdk.KEY_equal, Gdk.KEY_KP_Add):
            v.set_zoom_level(min(v.get_zoom_level() + 0.1, 2.5))
        elif tecla in (Gdk.KEY_minus, Gdk.KEY_KP_Subtract):
            v.set_zoom_level(max(v.get_zoom_level() - 0.1, 0.5))
        elif tecla in (Gdk.KEY_0, Gdk.KEY_KP_0):
            v.set_zoom_level(1.0)
        elif tecla in (Gdk.KEY_r, Gdk.KEY_R):
            v.reload()
        else:
            return False
        return True

    def al_decidir(self, _v, decision, tipo) -> bool:
        """Solo se navega dentro del servidor local; lo demás va al navegador del sistema."""
        if tipo not in (WebKit.PolicyDecisionType.NAVIGATION_ACTION, WebKit.PolicyDecisionType.NEW_WINDOW_ACTION):
            return False
        uri = decision.get_navigation_action().get_request().get_uri()
        if uri.startswith(self.origen + "/") or uri == self.origen or uri.startswith(("blob:", "data:", "about:")):
            if tipo == WebKit.PolicyDecisionType.NEW_WINDOW_ACTION:
                decision.ignore()
                return True
            return False
        decision.ignore()
        if uri.startswith(("http://", "https://", "mailto:")):
            subprocess.Popen(["xdg-open", uri], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        return True

    def al_descargar(self, _s, descarga: WebKit.Download) -> None:
        """«Guardar como Markdown»: a la carpeta de descargas, sin pisar un archivo que ya esté."""
        def destino(d: WebKit.Download, sugerido: str) -> bool:
            nombre = os.path.basename(sugerido) or "conversacion.md"
            base, ext = os.path.splitext(nombre)
            ruta, n = os.path.join(DESCARGAS, nombre), 1
            while os.path.exists(ruta):
                n += 1
                ruta = os.path.join(DESCARGAS, f"{base}-{n}{ext}")
            d.set_destination(ruta)
            return True

        def lista(d: WebKit.Download) -> None:
            ruta = d.get_destination() or ""
            subprocess.Popen(["notify-send", "-a", "Agentes", "-i", "lyra-agentes", "Conversación guardada", ruta.replace(os.path.expanduser("~"), "~")])

        descarga.connect("decide-destination", destino)
        descarga.connect("finished", lista)


if __name__ == "__main__":
    sys.exit(Ventana().run([a for a in sys.argv if a != "--depurar"]))
