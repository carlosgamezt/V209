// NÚCLEO del SIMULADOR LOCAL del formulario FEL (solo pruebas del agente). Funciones puras: validación, cálculo exacto, máquina de estados, registro de eventos y libro de emisiones SIMULADAS.
// NO es el portal de SAT, no emite nada real, no usa credenciales ni contacta ningún host: todo lleva «SIMULADO - SIN VALOR FISCAL».
// Diseño: fel/docs/agente-arquitectura.md · agente-seguridad.md §2 (separación simulador ↔ integración real).
import { randomBytes, randomUUID, createHash } from "node:crypto";

// ---------------------------------------------------------------- decimales exactos (escala 6)
const ESC = 1_000_000n;
export const aEscalado = (t) => {
  if (typeof t !== "string" || !/^\d{1,12}(\.\d{1,6})?$/.test(t.trim())) return null;
  const [e, d = ""] = t.trim().split(".");
  return BigInt(e) * ESC + BigInt((d + "000000").slice(0, 6));
};
/** Redondeo «mitad hacia arriba» a 2 decimales para mostrar. */
export const aTexto2 = (n) => { const c = (n + 5_000n) / 10_000n; return `${c / 100n}.${String(c % 100n).padStart(2, "0")}`; };

// ---------------------------------------------------------------- validación del formulario
const TIPOS_ID = ["NIT", "CUI", "EXT", "CF"], TIPOS_LINEA = ["Bien", "Servicio"];
const texto = (x, max) => typeof x === "string" && x.trim().length >= 1 && x.length <= max;
const sinControl = (s) => !/[\u0000-\u001f\u007f]/.test(s);

/** Valida el formulario completo (el servidor es la fuente de verdad; el navegador repite estas reglas solo para comodidad). */
export function validarFormulario(f) {
  const errores = [], e = (campo, mensaje) => errores.push({ campo, mensaje });
  if (f === null || typeof f !== "object") return { ok: false, errores: [{ campo: "formulario", mensaje: "Formulario no válido" }] };
  if (f.tipo_documento !== "FACT-SIM") e("tipo_documento", "Elige el tipo de documento (factura simulada)");
  if (typeof f.fecha !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(f.fecha) || Number.isNaN(Date.parse(f.fecha)) || new Date(f.fecha).toISOString().slice(0, 10) !== f.fecha) e("fecha", "Indica una fecha válida (AAAA-MM-DD)");
  if (f.moneda !== "GTQ") e("moneda", "La moneda debe ser GTQ");
  const est = f.establecimiento ?? {};
  if (typeof est.codigo !== "string" || !/^[0-9A-Za-z-]{1,10}$/.test(est.codigo)) e("establecimiento_codigo", "Escribe el código del establecimiento (letras, números o guion; máximo 10)");
  const r = f.receptor ?? {};
  if (!TIPOS_ID.includes(r.tipo_id)) e("receptor_tipo", "Elige el tipo de identificación del receptor");
  else if (r.tipo_id === "CF") { if (r.id !== "CF") e("receptor_id", "Consumidor final: la identificación es «CF»"); }
  else {
    if (typeof r.id !== "string" || !/^[0-9A-Za-z-]{1,30}$/.test(r.id)) e("receptor_id", "La identificación solo admite letras, números y guion (máximo 30)");
    if (!texto(r.nombre, 200) || !sinControl(r.nombre)) e("receptor_nombre", "Escribe el nombre del receptor (máximo 200 caracteres)");
  }
  if (r.direccion !== undefined && r.direccion !== "" && (typeof r.direccion !== "string" || r.direccion.length > 300 || !sinControl(r.direccion))) e("receptor_direccion", "La dirección no puede superar 300 caracteres");
  const ls = f.lineas;
  if (!Array.isArray(ls) || ls.length < 1) e("lineas", "Agrega al menos un concepto");
  else if (ls.length > 50) e("lineas", "Máximo 50 conceptos");
  else ls.forEach((l, i) => {
    const n = i + 1, x = l ?? {};
    if (!TIPOS_LINEA.includes(x.tipo)) e(`linea-${n}-tipo`, `Concepto ${n}: elige Bien o Servicio`);
    if (!texto(x.descripcion, 300) || !sinControl(x.descripcion)) e(`linea-${n}-descripcion`, `Concepto ${n}: escribe la descripción (máximo 300 caracteres)`);
    const c = aEscalado(x.cantidad), p = aEscalado(x.precio_unitario), d = aEscalado(x.descuento === undefined || x.descuento === "" ? "0" : x.descuento);
    if (c === null || c <= 0n) e(`linea-${n}-cantidad`, `Concepto ${n}: la cantidad debe ser un número mayor que cero (hasta 6 decimales)`);
    if (p === null) e(`linea-${n}-precio`, `Concepto ${n}: el precio debe ser un número (hasta 6 decimales)`);
    if (d === null) e(`linea-${n}-descuento`, `Concepto ${n}: el descuento debe ser un número`);
    else if (c !== null && c > 0n && p !== null && d > (c * p) / ESC) e(`linea-${n}-descuento`, `Concepto ${n}: el descuento no puede superar el importe`);
  });
  if (f.observaciones !== undefined && f.observaciones !== "" && (typeof f.observaciones !== "string" || f.observaciones.length > 500 || !sinControl(f.observaciones.replace(/\n/g, " ")))) e("observaciones", "Las observaciones no pueden superar 500 caracteres");
  return { ok: errores.length === 0, errores };
}

/** Importes exactos de un formulario YA válido. Sin impuestos (el simulador no aplica reglas fiscales). */
export function calcular(f) {
  let subtotal = 0n, descuentos = 0n;
  const lineas = f.lineas.map((l, i) => {
    const c = aEscalado(l.cantidad), p = aEscalado(l.precio_unitario), d = aEscalado(l.descuento === undefined || l.descuento === "" ? "0" : l.descuento);
    const importe = (c * p + ESC / 2n) / ESC; subtotal += importe; descuentos += d;
    return { n: i + 1, tipo: l.tipo, descripcion: l.descripcion.trim(), cantidad: l.cantidad, precio_unitario: l.precio_unitario, importe: aTexto2(importe), descuento: aTexto2(d), neto: aTexto2(importe - d) };
  });
  return { lineas, subtotal: aTexto2(subtotal), descuentos: aTexto2(descuentos), total: aTexto2(subtotal - descuentos) };
}
export const resumenDe = (f) => ({
  tipo_documento: f.tipo_documento, fecha: f.fecha, moneda: f.moneda, establecimiento: f.establecimiento.codigo,
  receptor: { tipo_id: f.receptor.tipo_id, id: f.receptor.id, nombre: f.receptor.tipo_id === "CF" ? "Consumidor final" : f.receptor.nombre.trim(), direccion: (f.receptor.direccion ?? "").trim() },
  observaciones: (f.observaciones ?? "").trim(), ...calcular(f),
});
export const hashResumen = (r) => createHash("sha256").update(JSON.stringify(r)).digest("hex");

// ---------------------------------------------------------------- máquina de estados de una sesión del formulario
export const ESTADOS = ["creada", "abierta", "previsualizada", "confirmada", "descartada", "interrumpida", "error"];
export const FINALES = new Set(["confirmada", "descartada", "interrumpida", "error"]);
const TRANSICIONES = { creada: ["abierta", "interrumpida"], abierta: ["abierta", "previsualizada", "interrumpida", "descartada"], previsualizada: ["abierta", "previsualizada", "confirmada", "descartada", "interrumpida", "error"] };
export const FALLOS = ["ninguno", "error_antes", "corte_tras_confirmar", "lento"];
export class ErrorSim extends Error { constructor(codigo, estado, mensaje) { super(mensaje ?? codigo); this.codigo = codigo; this.estado = estado; } }

const RE_EMPRESA = /^[A-Za-z0-9_-]{1,64}$/, RE_REF = /^[A-Za-z0-9_.:-]{8,80}$/;
/** `verificarConcesion(token, ahora)` → concesión | null. Si se entrega, la confirmación EXIGE una concesión firmada por NEXA (autorización humana separada del agente). */
export function crearNucleo({ ahora = () => new Date(), maxEventos = 5000, verificarConcesion = null } = {}) {
  const sesiones = new Map(), emisiones = [], eventos = [], concesiones = new Map(); let numero = 0, seq = 0;
  const log = (s, evento, detalle) => { eventos.push({ n: ++seq, t: ahora().toISOString(), empresa: s.empresa, sesion: s.id, evento, ...(detalle ? { detalle } : {}) }); if (eventos.length > maxEventos) eventos.shift(); };
  const mover = (s, a) => { if (!(TRANSICIONES[s.estado] ?? []).includes(a)) throw new ErrorSim("ESTADO", s.estado, `La sesión está «${s.estado}»: no admite pasar a «${a}»`); s.estado = a; };

  const n = {
    crearSesion({ empresa, referencia, fallo = "ninguno" }) {
      if (!RE_EMPRESA.test(empresa ?? "")) throw new ErrorSim("DATOS", "-", "empresa no válida");
      if (!RE_REF.test(referencia ?? "")) throw new ErrorSim("DATOS", "-", "referencia no válida");
      if (!FALLOS.includes(fallo)) throw new ErrorSim("DATOS", "-", "fallo no válido");
      const s = { id: randomBytes(16).toString("hex"), empresa, referencia, estado: "creada", fallo, csrf: null, hash: null, resumen: null, creada: ahora().toISOString() };
      sesiones.set(s.id, s); log(s, "sesion_creada", fallo === "ninguno" ? undefined : `fallo:${fallo}`); return s;
    },
    sesion: (id) => sesiones.get(id) ?? null,
    exigeAutorizacionHumana: () => verificarConcesion !== null,
    /** Recibe una concesión de NEXA (servidor a servidor). Solo se guarda si la firma es válida y no caducó; nunca se devuelve a nadie. */
    registrarConcesion(token) {
      if (!verificarConcesion) throw new ErrorSim("NO_CONFIGURADO", "-", "El simulador no exige autorización humana");
      const c = verificarConcesion(token, ahora());
      if (!c) throw new ErrorSim("CONCESION_INVALIDA", "-", "Concesión no válida");
      for (const [k, v] of concesiones) if (Date.parse(v.c.expira) <= ahora().getTime()) concesiones.delete(k);   // purga de caducadas
      if (concesiones.size >= 1000) throw new ErrorSim("LIMITE", "-", "Demasiadas concesiones pendientes");
      if (!concesiones.has(c.jti)) concesiones.set(c.jti, { c, usada: false });
      eventos.push({ n: ++seq, t: ahora().toISOString(), empresa: c.empresa, sesion: "-", evento: "concesion_recibida", detalle: `orden:${c.orden}` }); if (eventos.length > maxEventos) eventos.shift();
      return { jti: c.jti };
    },
    /** Lectura desde el plano de control: solo con la empresa de la sesión (otra empresa ⇒ como si no existiera). */
    sesionDeEmpresa: (id, empresa) => { const s = sesiones.get(id); return s && s.empresa === empresa ? s : null; },
    abrir(s) { if (s.estado === "creada") { mover(s, "abierta"); log(s, "formulario_abierto"); } return s; },
    previsualizar(s, formulario) {
      if (FINALES.has(s.estado)) throw new ErrorSim("ESTADO", s.estado, "La sesión ya terminó");
      const v = validarFormulario(formulario);
      if (!v.ok) { if (s.estado === "creada") mover(s, "abierta"); log(s, "validacion_fallida", `${v.errores.length} errores`); return { ok: false, errores: v.errores }; }
      if (s.estado === "creada") mover(s, "abierta");
      mover(s, "previsualizada"); s.resumen = resumenDe(formulario); s.hash = hashResumen(s.resumen); s.csrf = randomBytes(16).toString("hex");
      log(s, "vista_previa", `total:${s.resumen.total}`); return { ok: true, resumen: s.resumen, csrf: s.csrf };
    },
    volver(s) { mover(s, "abierta"); s.csrf = null; log(s, "vuelta_a_edicion"); return s; },
    descartar(s, csrf) { if (s.estado !== "abierta" && csrf !== s.csrf) throw new ErrorSim("CSRF", s.estado); mover(s, "descartada"); s.csrf = null; log(s, "sesion_descartada"); return s; },
    interrumpir(s, motivo = "control") { if (FINALES.has(s.estado)) throw new ErrorSim("ESTADO", s.estado, "La sesión ya terminó"); mover(s, "interrumpida"); s.csrf = null; log(s, "sesion_interrumpida", motivo); return s; },
    /** Confirmación. `origen`: «humano» (clic de una persona en el navegador) o «agente» (petición marcada por el agente: SIEMPRE rechazada). */
    confirmar(s, { csrf, origen }) {
      if (origen === "agente") { log(s, "confirmacion_bloqueada", "origen:agente"); throw new ErrorSim("SOLO_HUMANO", s.estado, "La confirmación solo puede hacerla una persona"); }
      if (s.estado === "confirmada") { log(s, "confirmacion_repetida_bloqueada"); throw new ErrorSim("YA_CONFIRMADA", s.estado, "Esta sesión ya fue confirmada"); }
      if (s.estado !== "previsualizada") { log(s, "confirmacion_bloqueada", `estado:${s.estado}`); throw new ErrorSim("ESTADO", s.estado, "Primero debe verse la vista previa"); }
      if (typeof csrf !== "string" || csrf.length !== 32 || csrf !== s.csrf) { log(s, "confirmacion_bloqueada", "sin_token_valido"); throw new ErrorSim("CSRF", s.estado, "Token de confirmación no válido"); }
      let concesion = null;
      if (verificarConcesion) {
        for (const v of concesiones.values()) if (!v.usada && v.c.empresa === s.empresa && v.c.orden === s.referencia && v.c.resumen_hash === s.hash && Date.parse(v.c.expira) > ahora().getTime()) { concesion = v; break; }
        if (!concesion) { log(s, "confirmacion_bloqueada", "sin_autorizacion_humana"); throw new ErrorSim("SIN_AUTORIZACION_HUMANA", s.estado, "Falta la autorización de la persona en NEXA para esta vista previa"); }
      }
      log(s, "confirmacion_solicitada");
      if (concesion) { concesion.usada = true; log(s, "autorizacion_humana_usada", `jti:${concesion.c.jti.slice(0, 8)}`); }   // un solo uso: se consume ANTES de registrar
      if (s.fallo === "error_antes") { mover(s, "error"); log(s, "error_inyectado", "antes_de_registrar"); throw new ErrorSim("ERROR_SERVIDOR", s.estado, "Error del servidor simulado"); }
      const previas = emisiones.filter((x) => x.empresa === s.empresa && x.referencia === s.referencia).length;
      const em = { id: randomUUID(), empresa: s.empresa, referencia: s.referencia, sesion: s.id, serie: "SIMA", numero: String(++numero).padStart(8, "0"), autorizacion: `SIM-${randomUUID().toUpperCase()}`, hash: s.hash, t: ahora().toISOString() };
      emisiones.push(em); mover(s, "confirmada"); s.csrf = null;
      log(s, "emision_registrada", `numero:${em.numero}`);
      if (previas > 0) log(s, "emision_duplicada_de_referencia", `previas:${previas}`);   // el simulador NO deduplica a propósito: se limita a registrarlo
      if (s.fallo === "corte_tras_confirmar") { log(s, "error_inyectado", "corte_tras_registrar"); return { emision: em, cortar: true }; }
      return { emision: em, cortar: false };
    },
    emisiones: ({ empresa, referencia }) => emisiones.filter((x) => x.empresa === empresa && (referencia === undefined || x.referencia === referencia)).map((x) => ({ ...x })),
    eventos: ({ empresa, sesion }) => eventos.filter((x) => x.empresa === empresa && (sesion === undefined || x.sesion === sesion)).map((x) => ({ ...x })),
    totalEmisiones: () => emisiones.length,
  };
  return n;
}
export const esEmpresaValida = (x) => RE_EMPRESA.test(x ?? "");
export const esReferenciaValida = (x) => RE_REF.test(x ?? "");
