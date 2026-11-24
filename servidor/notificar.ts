import { execFile } from 'node:child_process';
/** `alAbrir`: se tocó «Abrir» en la notificación (en dunst, clic → menú con la acción) */
export function crearNotificador(visible: () => boolean, alAbrir: (id: string) => void = () => {}) {
  const ultimas = new Map<string, number>();
  return (id: string, titulo: string, texto: string) => {
    const ahora = Date.now();
    if (visible() || ahora - (ultimas.get(id) ?? -Infinity) < 5000) return;
    ultimas.set(id, ahora);
    // Se firman como «Agentes» para distinguirlas de otras apps llamadas Lyra
    execFile('notify-send', ['-a', 'Agentes', '-i', 'lyra-agentes', '-u', 'normal', '-A', 'default=Abrir', '--wait', '--', titulo, texto], (_e, salida) => {
      if (String(salida).trim() === 'default') alAbrir(id);
    });
  };
}
