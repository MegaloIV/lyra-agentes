import { execFile } from 'node:child_process';
export function crearNotificador(visible: () => boolean) {
  const ultimas = new Map<string, number>();
  return (id: string, titulo: string, texto: string) => {
    const ahora = Date.now();
    if (visible() || ahora - (ultimas.get(id) ?? -Infinity) < 5000) return;
    ultimas.set(id, ahora);
    execFile('notify-send', ['-a', 'Atril', '-u', 'normal', '--', titulo, texto], () => {});
  };
}
