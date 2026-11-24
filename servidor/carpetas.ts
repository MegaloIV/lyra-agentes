// El explorador de carpetas del chip «carpeta»: lista las subcarpetas de una ruta para navegar dentro del mismo menú,
// sin abrir una ventana aparte. Solo nombres de carpetas (nada de archivos ni de su contenido); las ocultas no se listan.
import { readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

const MAXIMO = 400;

export type Explorado = { ruta: string; carpetas: string[]; recortado?: boolean; aviso?: string };

/** `ruta` admite ~/; si no existe o no se puede leer, sube hasta la primera carpeta que sí */
export async function explorar(ruta: string): Promise<Explorado> {
  const casa = homedir();
  let r = (ruta.trim() || '~').replace(/^~(?=\/|$)/, casa);
  if (!isAbsolute(r) || r.includes('\0')) r = casa;
  r = resolve(r);
  let aviso: string | undefined;
  for (;;) {
    try {
      const real = await realpath(r);
      if (!(await stat(real)).isDirectory()) throw new Error();
      const entradas = await readdir(real, { withFileTypes: true });
      const carpetas: string[] = [];
      for (const e of entradas) {
        if (e.name.startsWith('.')) continue;
        if (e.isDirectory()) carpetas.push(e.name);
        else if (e.isSymbolicLink() && await stat(join(real, e.name)).then(s => s.isDirectory(), () => false)) carpetas.push(e.name);
      }
      carpetas.sort((a, b) => a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' }));
      return { ruta: real, carpetas: carpetas.slice(0, MAXIMO), recortado: carpetas.length > MAXIMO || undefined, aviso };
    } catch {
      const arriba = dirname(r);
      if (arriba === r) return { ruta: '/', carpetas: [], aviso: 'No se pudo leer esa carpeta.' };
      aviso = 'Esa carpeta no existe o no se puede leer; te muestro la de arriba.';
      r = arriba;
    }
  }
}
