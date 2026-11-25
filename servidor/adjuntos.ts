import { randomUUID } from 'node:crypto';
import { mkdir, open, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

export const MAX_ADJUNTO = 25 * 1024 * 1024;
/** Una copia local duradera: los agentes pueden leerla también al retomar la conversación. */
export async function guardarAdjunto(datos: AsyncIterable<Uint8Array>, nombre: string,
  base = join(homedir(), '.local/state/lyra-agentes/adjuntos')) {
  const limpio = basename(nombre).replace(/[^\p{L}\p{N}._ -]/gu, '_').replace(/^\.+/, '').slice(-160) || 'archivo';
  await mkdir(base, { recursive: true, mode: 0o700 });
  const ruta = join(base, `${randomUUID()}-${limpio}`);
  const archivo = await open(ruta, 'wx', 0o600);
  let tamano = 0;
  try {
    for await (const trozo of datos) {
      tamano += trozo.length;
      if (tamano > MAX_ADJUNTO) throw new Error('El archivo supera los 25 MB.');
      await archivo.writeFile(trozo);
    }
    return { ruta, nombre: limpio, tamano };
  } catch (e) {
    await rm(ruta, { force: true });
    throw e;
  } finally { await archivo.close(); }
}
