import { execFile } from 'node:child_process';
export function elegirCarpeta(): Promise<string | null> {
  return new Promise((resolve, reject) => execFile('zenity', ['--file-selection', '--directory', '--title=Elegir carpeta'], (error, stdout) => {
    if (error && error.code !== 1) reject(new Error('No se pudo abrir el selector de carpetas. Comprueba que zenity esté instalado.'));
    else resolve(error ? null : stdout.trim() || null);
  }));
}
