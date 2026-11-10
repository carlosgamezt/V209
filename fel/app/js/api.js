// Contrato de datos de la interfaz. Hay dos implementaciones con la MISMA forma:
//   · demo.js   — datos de ejemplo en memoria (sin red, sin credenciales): para revisar la interfaz.
//   · remoto.js — lecturas con RLS contra Supabase y escrituras por la Edge Function "fel-api".
export class ErrorApi extends Error {
  constructor(mensaje, codigo = "error", status = 400) { super(mensaje); this.codigo = codigo; this.status = status; }
}

export async function crearApi(config) {
  if (config.modo === "remoto") {
    const { crearRemoto } = await import("./remoto.js");
    return crearRemoto(config);
  }
  const { crearDemo } = await import("./demo.js");
  return crearDemo(config);
}
