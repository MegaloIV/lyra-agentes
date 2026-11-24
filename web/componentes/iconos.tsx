// Íconos de herramientas: trazos de 16×16, heredan el color del texto
const trazos: Record<string, string> = {
  leer: 'M3 2.5h6.5L13 6v7.5H3z M9.5 2.5V6H13 M5.5 9h5 M5.5 11.5h3.5',
  editar: 'M10.5 2.5l3 3L6 13H3v-3z M9 4l3 3',
  crear: 'M3 2.5h6.5L13 6v7.5H3z M8 7.5v4 M6 9.5h4',
  terminal: 'M2 3h12v10H2z M4.5 6.5L6.5 8l-2 1.5 M8 10.5h3.5',
  buscar: 'M7 3a4 4 0 1 1 0 8a4 4 0 0 1 0-8z M10 10l3.5 3.5',
  web: 'M8 2a6 6 0 1 1 0 12A6 6 0 0 1 8 2z M2 8h12 M8 2c2 2.2 2 9.8 0 12 M8 2c-2 2.2-2 9.8 0 12',
  agente: 'M8 2.5a2.5 2.5 0 1 1 0 5a2.5 2.5 0 0 1 0-5z M3 13.5c.6-2.6 2.6-4 5-4s4.4 1.4 5 4',
  tareas: 'M2.5 4l1.2 1.2L6 3 M8 4.3h5.5 M2.5 8.5l1.2 1.2L6 7.5 M8 8.8h5.5 M8 13h5.5 M3 13h1.5',
  plan: 'M3 2.5h10v11H3z M5.5 5.5h5 M5.5 8h5 M5.5 10.5h3',
  pregunta: 'M8 2a6 6 0 1 1 0 12A6 6 0 0 1 8 2z M6.2 6.3a1.9 1.9 0 1 1 2.6 1.8c-.5.3-.8.7-.8 1.3v.3 M8 11.6v.1',
  skill: 'M8 1.8l1.8 3.9 4.2.5-3.1 2.9.8 4.2L8 11.2l-3.7 2.1.8-4.2L2 6.2l4.2-.5z',
  mcp: 'M6 2v3 M10 2v3 M4 5h8v3a4 4 0 0 1-8 0z M8 12v2.5',
  otro: 'M3 8h.1 M8 8h.1 M13 8h.1',
};

export function Icono({ nombre }: { nombre: string }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={trazos[nombre] || trazos.otro} />
    </svg>
  );
}
