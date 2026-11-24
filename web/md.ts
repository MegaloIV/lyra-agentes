import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/common';
import DOMPurify from 'dompurify';
const md = new MarkdownIt({ html: false, linkify: true });
md.renderer.rules.fence = (tokens, i) => {
  const t = tokens[i]!, lenguaje = t.info.trim().split(/\s+/)[0] || '';
  const codigo = lenguaje && hljs.getLanguage(lenguaje) ? hljs.highlight(t.content, { language: lenguaje }).value : md.utils.escapeHtml(t.content);
  return `<div class="codigo-cabecera"><span>${md.utils.escapeHtml(lenguaje || 'texto')}</span><button class="copiar" type="button">Copiar</button></div><pre class="codigo"><code class="hljs">${codigo}</code></pre>`;
};
md.renderer.rules.table_open = () => '<div class="tabla"><table>';
md.renderer.rules.table_close = () => '</table></div>';
const enlace = md.renderer.rules.link_open || ((t, i, o, _e, s) => s.renderToken(t, i, o));
md.renderer.rules.link_open = (t, i, o, e, s) => { t[i]!.attrSet('target', '_blank'); t[i]!.attrSet('rel', 'noopener'); return enlace(t, i, o, e, s); };
export function renderizar(texto: string, prefijo = ''): string {
  let numero = 0;
  const tokens = md.parse(texto, {});
  for (const t of tokens) if (t.type === 'heading_open' && ['h2', 'h3'].includes(t.tag)) t.attrSet('id', `${prefijo}-h-${++numero}`);
  return DOMPurify.sanitize(md.renderer.render(tokens, md.options, {}), { ADD_ATTR: ['target', 'rel'] });
}
export function renderizarLinea(texto: string): string { return DOMPurify.sanitize(md.renderInline(texto), { ADD_ATTR: ['target', 'rel'] }); }
export function encabezados(texto: string, prefijo: string) {
  const tokens = md.parse(texto, {}), lista: { id: string; nivel: string; texto: string }[] = []; let n = 0;
  tokens.forEach((t, i) => { if (t.type === 'heading_open' && ['h2', 'h3'].includes(t.tag)) lista.push({ id: `${prefijo}-h-${++n}`, nivel: t.tag, texto: tokens[i + 1]?.content || '' }); });
  return lista;
}
