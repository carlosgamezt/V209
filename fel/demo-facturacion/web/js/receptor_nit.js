// Autollenado del NOMBRE de un receptor al escribir su identificación (Nueva factura y Clientes). Lógica pura (sin DOM): se prueba en Deno y se usa en el navegador.
// La consulta la hace el SERVIDOR (POST /api/receptores/nit): el navegador nunca habla con Digifact ni conoce credenciales.
//  · «CF» (cualquier mayúscula/minúscula, con espacios: «cf», «Cf», «C F») se normaliza a «CF», pone «CONSUMIDOR FINAL» y NUNCA consulta nada.
//  · Un NIT se consulta solo cuando se terminó de escribir (espera de 600 ms sin teclas, o al salir del campo); se cancela la consulta anterior y se descartan sus respuestas.
//  · Nunca se pisa un nombre escrito por la persona; al cambiar el NIT se limpia un nombre autollenado (no queda el del receptor anterior).
export const NOMBRE_CF = "CONSUMIDOR FINAL";
export const RE_NIT = /^\d{1,11}[0-9K]$/;

/** Identificación sin espacios ni guiones y en mayúsculas. */
export const normalizarId = (t) => String(t ?? "").replace(/[\s-]+/g, "").toUpperCase();
export const esCF = (t) => normalizarId(t) === "CF";

/** Dígito verificador del NIT (módulo 11, «K» = 10). Solo decide si vale la pena una consulta AUTOMÁTICA; no se usa para rechazar un NIT. */
export function digitoVerificadorValido(nit) {
  const n = normalizarId(nit); if (!RE_NIT.test(n) || n.length < 2) return false;
  const cuerpo = n.slice(0, -1), n1 = cuerpo.length + 1; let s = 0;
  for (let i = 0; i < cuerpo.length; i++) s += Number(cuerpo[i]) * (n1 - i);
  const r = (11 - (s % 11)) % 11; return (r === 10 ? "K" : String(r)) === n.slice(-1);
}
/** ¿Se puede consultar? Automático (al dejar de escribir): formato y dígito verificador válidos. Al salir del campo: basta el formato. */
export const esNitConsultable = (n, alSalir = false) => RE_NIT.test(n) && n.length >= 5 && (alSalir || digitoVerificadorValido(n));

/** Etiqueta de ORIGEN del nombre que se muestra junto al campo. Una consulta de Digifact TEST NO es una certificación fiscal de SAT. */
export const ETIQUETAS = { digifact: "Consultado mediante Digifact TEST", simulado: "Datos simulados", manual: "Ingreso manual", cf: "Consumidor final" };

/** Texto de la línea de estado bajo el campo (una sola línea, discreta). `info` es lo que entrega el controlador. */
export function textoEstado(info) {
  if (!info) return "";
  switch (info.fase) {
    case "consultando": return "Consultando NIT…";
    case "ok": return info.simulado ? "Datos simulados de demostración: no provienen de SAT." : "Consulta de prueba en Digifact TEST: no es una certificación fiscal de SAT.";
    case "no_encontrado": return `No se encontró este NIT${info.simulado ? " (consulta simulada)" : " en Digifact TEST"}. Escribe el nombre manualmente.`;
    case "error": return "No se pudo consultar el NIT ahora. Puedes escribir el nombre manualmente.";
    case "conservado": return "Se conservó el nombre que escribiste.";
    case "cf": return "Consumidor final: sin consulta. Solo para facturas menores a Q 2,500.00.";
    default: return "";
  }
}

/**
 * @param modelo   objeto con { tipo, numero, nombre } que el formulario ya usa (el controlador lo actualiza)
 * @param consultar (nit, { signal }) => Promise<{ encontrado, nombre, origen, simulado }>   — llama al servidor
 * @param refrescar () => void       — vuelca el modelo en los campos
 * @param estado   (info|null) => void — muestra la línea de estado
 * @param etiqueta (tipo|null) => void — muestra el origen del nombre: «digifact» | «simulado» | «manual» | «cf»
 * @param {{ modelo: { tipo: string, numero: string, nombre: string }, consultar: Function, refrescar?: () => void, estado?: (info: any) => void, etiqueta?: (tipo: string | null) => void, esperaMs?: number, temporizador?: any }} _o
 */
export function crearAutollenado({ modelo, consultar, refrescar = () => {}, estado = (_info) => {}, etiqueta = (_tipo) => {}, esperaMs = 600, temporizador = { poner: (f, ms) => setTimeout(f, ms), quitar: (i) => clearTimeout(i) } }) {
  let auto = false, origenAuto = null, manual = false, cf = false, seq = 0, timer = null, aborto = null, consultadoPara = null;   // consultadoPara: el NIT (normalizado) ya consultado o en consulta

  const cancelar = () => { consultadoPara = null; if (timer !== null) { temporizador.quitar(timer); timer = null; } if (aborto) { try { aborto.abort(); } catch { /* ya terminó */ } aborto = null; } seq++; };
  const etiquetar = () => etiqueta(cf || modelo.tipo === "CF" ? "cf" : auto ? origenAuto : modelo.nombre.trim() ? "manual" : null);
  const limpiarNombre = () => { modelo.nombre = ""; auto = false; manual = false; origenAuto = null; };
  const aplicarCF = () => { cancelar(); modelo.tipo = "CF"; modelo.numero = "CF"; modelo.nombre = NOMBRE_CF; auto = false; manual = false; origenAuto = null; cf = true; refrescar(); estado({ fase: "cf" }); etiquetar(); };

  async function ejecutar(n) {
    timer = null; const mia = seq; consultadoPara = n; aborto = new AbortController(); estado({ fase: "consultando" });
    let r;
    try { r = await consultar(n, { signal: aborto.signal }); }
    catch (e) { if (e?.name === "AbortError" || mia !== seq) return; estado({ fase: "error" }); return; }
    if (mia !== seq) return;   // respuesta vieja: la persona ya cambió el NIT
    aborto = null;
    if (!r?.encontrado) { estado({ fase: "no_encontrado", simulado: !!r?.simulado }); etiquetar(); return; }
    if (modelo.nombre.trim() && !auto) { estado({ fase: "conservado" }); etiquetar(); return; }   // nunca se pisa lo que escribió la persona
    // lo no simulado que el servidor devuelve para un NIT viene de la consulta real (CF nunca llega aquí)
    modelo.nombre = r.nombre; auto = true; manual = false; origenAuto = r.simulado ? "simulado" : "digifact"; refrescar(); estado({ fase: "ok", origen: r.origen, simulado: origenAuto === "simulado" }); etiquetar();
  }
  function programar(n, alSalir) {
    if (modelo.tipo !== "NIT" || !esNitConsultable(n, alSalir)) return;
    if (alSalir) { ejecutar(n); return; }
    timer = temporizador.poner(() => ejecutar(n), esperaMs);
  }

  return {
    /** La persona escribió en «Identificación» (valor tal cual). */
    alEscribirId(valor) {
      cancelar(); estado(null); modelo.numero = valor;
      const n = normalizarId(valor);
      if (n === "CF") { aplicarCF(); return; }
      if (cf || modelo.tipo === "CF") { cf = false; modelo.tipo = "NIT"; limpiarNombre(); refrescar(); }   // sale de CF: sin datos del receptor anterior
      else if (auto) { limpiarNombre(); refrescar(); }                             // otro NIT: el nombre autollenado ya no corresponde
      programar(n, false); etiquetar();
    },
    /** La persona salió del campo «Identificación»: si quedó una consulta en espera, se hace ya. */
    alSalirIdentificacion() {
      const n = normalizarId(modelo.numero); if (cf || modelo.tipo === "CF" || esCF(n) || n === consultadoPara) return;
      if (timer !== null) { temporizador.quitar(timer); timer = null; }
      programar(n, true);
    },
    /** La persona eligió otro «Tipo» de identificación. */
    alElegirTipo(tipo) {
      cancelar(); estado(null);
      if (tipo === "CF") { aplicarCF(); return; }
      const veniaCF = cf || modelo.tipo === "CF"; modelo.tipo = tipo;
      if (veniaCF) { cf = false; modelo.numero = ""; limpiarNombre(); refrescar(); etiquetar(); return; }   // de CF a otro tipo: campos vacíos
      if (auto) { limpiarNombre(); refrescar(); }
      programar(normalizarId(modelo.numero), false); etiquetar();
    },
    /** La persona escribió en «Nombre». */
    alEscribirNombre(valor) { modelo.nombre = valor; manual = valor.trim() !== ""; auto = false; origenAuto = null; etiquetar(); },
    /** Estado interno (para pruebas). */
    get interno() { return { auto, manual, cf, pendiente: timer !== null }; },
    cancelar() { cancelar(); estado(null); etiquetar(); },
  };
}
