export type Adjunto = { etiqueta: string; ruta: string; nombre: string };

export function etiquetaAdjunto(nombre: string, tipo: string, lista: Adjunto[]): string {
  const clase = tipo.startsWith('image/') || /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(nombre) ? 'imagen' : 'archivo';
  let numero = 1;
  while (lista.some(a => a.etiqueta === `[${clase} ${numero}]`)) numero++;
  return `[${clase} ${numero}]`;
}

/** El texto que recibe el agente incluye las rutas; en el redactor quedan marcadores cortos. */
export function textoConAdjuntos(texto: string, lista: Adjunto[]): string {
  const usados = lista.filter(a => texto.includes(a.etiqueta));
  return texto.trim() + (usados.length ? '\n\nArchivos adjuntos (rutas locales):\n' + usados.map(a => `${a.etiqueta}: ${JSON.stringify(a.ruta)}`).join('\n') : '');
}

export function rutasPegadas(datos: string): string[] {
  return datos.split(/\r?\n/).flatMap(linea => {
    try {
      const url = new URL(linea);
      return url.protocol === 'file:' && (!url.hostname || url.hostname === 'localhost') ? [decodeURIComponent(url.pathname)] : [];
    } catch { return []; }
  });
}
