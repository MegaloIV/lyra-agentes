export class Cola<T> implements AsyncIterable<T> {
  private valores: T[] = [];
  private despertar?: () => void;
  private cerrada = false;
  poner(valor: T) { if (this.cerrada) throw new Error('La sesión está cerrada.'); this.valores.push(valor); this.despertar?.(); }
  cerrar() { this.cerrada = true; this.despertar?.(); }
  async *[Symbol.asyncIterator]() {
    while (!this.cerrada) {
      if (this.valores.length) yield this.valores.shift()!;
      else await new Promise<void>(resolve => { this.despertar = resolve; });
    }
  }
}
