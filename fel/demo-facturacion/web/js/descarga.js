// Descarga de archivos generados por el servidor (CSV, PDF de demostración) con la sesión actual; nada se guarda en el navegador.
import { h } from "/app/js/ui.js";
export async function descargarArchivo(ruta, nombre) {
  const r = await fetch(ruta, { headers: { "x-demo": "1" } });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).mensaje || "No se pudo descargar el archivo.");
  const url = URL.createObjectURL(await r.blob()), a = h("a", { href: url, download: nombre }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}
