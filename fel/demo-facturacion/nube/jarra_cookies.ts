// Jarra de cookies mínima para la prueba de humo (un navegador real guarda TODAS las cookies, no solo la última).
// Cloudflare añade su propia cookie «__cf_bm» a algunas respuestas: un cliente que guarde solo «la última cookie recibida» pisa la de sesión y la siguiente petición llega sin sesión (401 no_sesion).
// Solo se guardan pares nombre=valor (los atributos se ignoran); «Max-Age=0» o un valor vacío borran la cookie.
export class JarraCookies {
  private m = new Map<string, string>();
  /** Registra las cabeceras Set-Cookie de una respuesta; devuelve los NOMBRES (nunca los valores). */
  guardar(setCookies: string[]): string[] {
    const nombres: string[] = [];
    for (const sc of setCookies) {
      const [par, ...attrs] = sc.split(";"); const i = par.indexOf("="); if (i < 1) continue;
      const nombre = par.slice(0, i).trim(), valor = par.slice(i + 1).trim(); nombres.push(nombre.slice(0, 30));
      const borra = valor === "" || attrs.some((a) => /^\s*max-age\s*=\s*0*\s*$/i.test(a));
      if (borra) this.m.delete(nombre); else this.m.set(nombre, valor);
    }
    return nombres;
  }
  /** Valor de la cabecera Cookie ("" si no hay ninguna). */
  cabecera(): string { return [...this.m].map(([k, v]) => `${k}=${v}`).join("; "); }
}
