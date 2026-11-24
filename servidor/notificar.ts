import { execFile } from 'node:child_process';
export function crearNotificador(visible: () => boolean) {
  const ultimas = new Map<string, number>();
  return (id: string, titulo: string, texto: string) => {
    const ahora = Date.now();
    if (visible() || ahora - (ultimas.get(id) ?? -Infinity) < 5000) return;
    ultimas.set(id, ahora);
    // «Agentes» y no «Lyra»: Lyra cuenta las notificaciones del escritorio salvo las suyas
    execFile('notify-send', ['-a', 'Agentes', '-i', 'lyra-agentes', '-u', 'normal', '--', titulo, texto], () => {});
  };
}
