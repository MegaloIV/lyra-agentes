// Cuentas del zoom de imágenes del visor, sin DOM (para poder probarlas). La imagen se dibuja con
// translate(x, y) scale(escala) desde su esquina de arriba a la izquierda, dentro de un marco de `ancho × alto`.
export type Tam = { ancho: number; alto: number };
export type Vista = { escala: number; x: number; y: number };

export const MAXIMO = 32;

/** Escala para que entre entera; las chicas no se agrandan */
export function escalaAjuste(marco: Tam, img: Tam): number {
  if (!img.ancho || !img.alto || !marco.ancho || !marco.alto) return 1;
  return Math.min(1, marco.ancho / img.ancho, marco.alto / img.alto);
}

/** La más chica permitida: la de ajuste, o 10 % si la imagen ya entra a tamaño real */
export function escalaMinima(marco: Tam, img: Tam): number {
  const ajuste = escalaAjuste(marco, img);
  return ajuste < 1 ? ajuste : 0.1;
}

/** Si entra, va centrada; si no, no deja que se vea el borde de afuera (no se puede perder de vista) */
export function limitar(v: Vista, marco: Tam, img: Tam): Vista {
  const eje = (pos: number, lado: number, marcoLado: number) => {
    const largo = lado * v.escala;
    return largo <= marcoLado ? (marcoLado - largo) / 2 : Math.min(0, Math.max(marcoLado - largo, pos));
  };
  return { escala: v.escala, x: eje(v.x, img.ancho, marco.ancho), y: eje(v.y, img.alto, marco.alto) };
}

export function ajustada(marco: Tam, img: Tam): Vista {
  return limitar({ escala: escalaAjuste(marco, img), x: 0, y: 0 }, marco, img);
}

/** Cambia a `escala` dejando quieto el punto del marco (px, py) que está bajo el puntero */
export function zoomEn(v: Vista, escala: number, px: number, py: number, marco: Tam, img: Tam): Vista {
  const e = Math.min(MAXIMO, Math.max(escalaMinima(marco, img), escala));
  const k = e / v.escala;
  return limitar({ escala: e, x: px - (px - v.x) * k, y: py - (py - v.y) * k }, marco, img);
}

export function mover(v: Vista, dx: number, dy: number, marco: Tam, img: Tam): Vista {
  return limitar({ escala: v.escala, x: v.x + dx, y: v.y + dy }, marco, img);
}

/** Doble clic: de ajustada a tamaño real (o al doble, si ya era real) y de vuelta */
export function alternar(v: Vista, px: number, py: number, marco: Tam, img: Tam): Vista {
  const ajuste = escalaAjuste(marco, img);
  if (v.escala > ajuste * 1.01) return ajustada(marco, img);
  return zoomEn(v, ajuste < 1 ? 1 : 2, px, py, marco, img);
}
