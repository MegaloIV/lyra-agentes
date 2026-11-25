// Íconos de herramientas: trazos de 16×16, heredan el color del texto
const trazos: Record<string, string> = {
  leer: 'M3 2.5h6.5L13 6v7.5H3z M9.5 2.5V6H13 M5.5 9h5 M5.5 11.5h3.5',
  editar: 'M10.5 2.5l3 3L6 13H3v-3z M9 4l3 3',
  crear: 'M3 2.5h6.5L13 6v7.5H3z M8 7.5v4 M6 9.5h4',
  terminal: 'M2 3h12v10H2z M4.5 6.5L6.5 8l-2 1.5 M8 10.5h3.5',
  gato: 'M3 13.5V6L2.5 2.5l3.4 2.2h4.2l3.4-2.2L13 6v7.5z M5.8 8.2v.9 M10.2 8.2v.9 M7 11l1 .6 1-.6',
  buscar: 'M7 3a4 4 0 1 1 0 8a4 4 0 0 1 0-8z M10 10l3.5 3.5',
  web: 'M8 2a6 6 0 1 1 0 12A6 6 0 0 1 8 2z M2 8h12 M8 2c2 2.2 2 9.8 0 12 M8 2c-2 2.2-2 9.8 0 12',
  agente: 'M8 2.5a2.5 2.5 0 1 1 0 5a2.5 2.5 0 0 1 0-5z M3 13.5c.6-2.6 2.6-4 5-4s4.4 1.4 5 4',
  tareas: 'M2.5 4l1.2 1.2L6 3 M8 4.3h5.5 M2.5 8.5l1.2 1.2L6 7.5 M8 8.8h5.5 M8 13h5.5 M3 13h1.5',
  plan: 'M3 2.5h10v11H3z M5.5 5.5h5 M5.5 8h5 M5.5 10.5h3',
  pregunta: 'M8 2a6 6 0 1 1 0 12A6 6 0 0 1 8 2z M6.2 6.3a1.9 1.9 0 1 1 2.6 1.8c-.5.3-.8.7-.8 1.3v.3 M8 11.6v.1',
  skill: 'M8 1.8l1.8 3.9 4.2.5-3.1 2.9.8 4.2L8 11.2l-3.7 2.1.8-4.2L2 6.2l4.2-.5z',
  mcp: 'M6 2v3 M10 2v3 M4 5h8v3a4 4 0 0 1-8 0z M8 12v2.5',
  otro: 'M3 8h.1 M8 8h.1 M13 8h.1',
  papelera: 'M2.5 4.5h11 M6 4.5V3h4v1.5 M4 4.5l.7 9h6.6l.7-9 M6.8 7v4.5 M9.2 7v4.5',
  imagen: 'M2.5 3h11v10h-11z M2.5 11l3.2-3.2 2.6 2.6 1.7-1.7 3.5 3.3 M10.5 5.8h.1',
  nuevo: 'M8 3v10 M3 8h10',
  menos: 'M3 8h10',
  video: 'M2 3.5h12v9H2z M6.5 6v4l3.5-2z',
  apps: 'M3 3h4v4H3z M9 3h4v4H9z M3 9h4v4H3z M9 9h4v4H9z',
  carpeta: 'M2 4.5V12.5h12V5.5H8L6.5 3.5H2z',
  carpetaNueva: 'M2 4.5V12.5h12V5.5H8L6.5 3.5H2z M8 7.3v3.6 M6.2 9.1h3.6',
  sacar: 'M2 4.5V12.5h12V5.5H8L6.5 3.5H2z M6.2 9.1h3.6',
  indice: 'M5.5 4h8 M5.5 8h8 M5.5 12h8 M2.5 4h.1 M2.5 8h.1 M2.5 12h.1',
  visor: 'M2 3h12v10H2z M9.5 3v10 M4 6h3.5 M4 8.5h3.5',
  abrir: 'M9 2.5h4.5V7 M13.5 2.5L7.5 8.5 M12 9.5v4H2.5V4h4',
  codigo: 'M5.5 4.5L2 8l3.5 3.5 M10.5 4.5L14 8l-3.5 3.5 M9 3l-2 10',
  descargar: 'M8 2.5v7.5 M4.8 7L8 10.2 11.2 7 M2.5 13.5h11',
  copiar: 'M5.5 5.5h8v8h-8z M10.5 5.5V2.5h-8v8h3',
  cerrar: 'M4 4l8 8 M12 4l-8 8',
  recargar: 'M13 8a5 5 0 1 1-1.5-3.6 M13 2.5v2.5h-2.5',
  enviar: 'M8 13V3.5 M4 7.5l4-4 4 4',
  detener: 'M4.5 4.5h7v7h-7z',
  chispa: 'M8 2v3 M8 11v3 M2 8h3 M11 8h3 M4 4l1.8 1.8 M10.2 10.2L12 12 M12 4l-1.8 1.8 M5.8 10.2L4 12',
  rama: 'M4.5 2a1.5 1.5 0 1 1 0 3a1.5 1.5 0 0 1 0-3z M4.5 11a1.5 1.5 0 1 1 0 3a1.5 1.5 0 0 1 0-3z M11.5 4a1.5 1.5 0 1 1 0 3a1.5 1.5 0 0 1 0-3z M4.5 5v6 M11.5 7c0 2.6-4 2.2-6.6 4.3',
  ok: 'M3 8.5l3 3 7-7',
  corriendo: 'M8 2.5a5.5 5.5 0 1 0 5.5 5.5',
  escudo: 'M8 2l5 2v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4z',
  memoria: 'M5 2.5h6a1.5 1.5 0 0 1 1.5 1.5v9.5L8 11l-4.5 2.5V4A1.5 1.5 0 0 1 5 2.5z',
  nota: 'M2.5 2.5h11v7l-4 4h-7z M13.5 9.5h-4v4 M5 5.5h6 M5 8h3.5',
  ensanchar: 'M2.5 2.5h11v11h-11z M10 2.5v11 M7.5 5.5L5 8l2.5 2.5',
  tamanos: 'M2 8h12 M4.5 5.5L2 8l2.5 2.5 M11.5 5.5L14 8l-2.5 2.5 M2 3v10 M14 3v10',
};

export function Icono({ nombre, tam = 16 }: { nombre: string; tam?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={tam} height={tam} fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={trazos[nombre] || trazos.otro} />
    </svg>
  );
}
