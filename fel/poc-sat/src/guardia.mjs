// Guardia de la prueba de viabilidad. Funciones PURAS (sin navegador): deciden qué se permite hacer.
// Principio: ante la duda, se rechaza. Esta guardia es la que garantiza que la prueba NUNCA emite, certifica ni envía.
import path from "node:path";

/** Normaliza texto: sin tildes, minúsculas, sin signos. */
export const normalizar = (t) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9ñ]+/g, " ").trim();

/** Palabras que indican emitir, certificar, enviar o cometer algo. NUNCA se hace clic en un control que las contenga. */
export const PALABRAS_PROHIBIDAS = [
  "emitir", "emitido", "emitida", "emision", "emite", "certificar", "certificacion", "certifica", "certifique", "firmar", "firma", "firme",
  "enviar", "envio", "enviado", "envia", "transmitir", "transmision", "generar", "genere", "confirmar", "confirmacion", "finalizar", "procesar",
  "registrar", "guardar", "pagar", "anular", "declarar", "presentar", "aprobar", "autorizar", "submit", "send", "issue", "sign", "certify", "save",
  "pay", "cancel", "void", "post", "publish",
  // acciones que destruyen la sesión o el borrador: nunca se pulsan
  "cerrar", "salir", "logout", "logoff", "desconectar", "eliminar", "borrar", "descartar", "delete", "remove",
];
/** Palabras ambiguas: pueden ser navegación o pueden cometer algo. Solo se permiten si una persona las aprobó en el paso (ambiguo_aprobado). */
export const PALABRAS_AMBIGUAS = ["continuar", "siguiente", "terminar", "listo", "aceptar", "ok", "si", "yes", "next", "continue", "done", "finalizado", "finish", "crear", "nuevo", "agregar", "adicionar"];

const PROH = new Set(PALABRAS_PROHIBIDAS.map(normalizar)), AMBI = new Set(PALABRAS_AMBIGUAS.map(normalizar));
const palabras = (t) => normalizar(t).split(" ").filter(Boolean);

export function textoProhibido(texto) {
  const p = palabras(texto).find((w) => PROH.has(w));
  return p ? { prohibido: true, palabra: p } : { prohibido: false, palabra: null };
}
export function textoAmbiguo(texto) {
  const p = palabras(texto).find((w) => AMBI.has(w));
  return p ? { ambiguo: true, palabra: p } : { ambiguo: false, palabra: null };
}

/**
 * Clasifica un control observado. nivel: "prohibido" | "ambiguo" | "ok".
 * Entrada: { texto, tag, type, enFormulario, rol }. «envia_formulario» = un clic puede enviar un formulario (submit implícito o explícito).
 */
export function clasificarControl(c) {
  const razones = [], textos = [c.texto, c.etiqueta, c.nombre, c.id, c.titulo, c.href].filter(Boolean);
  let nivel = "ok";
  for (const t of textos) { const r = textoProhibido(t); if (r.prohibido) { nivel = "prohibido"; razones.push(`contiene «${r.palabra}»`); break; } }
  const tipo = String(c.type ?? "").toLowerCase(), tag = String(c.tag ?? "").toLowerCase();
  const envia = (tag === "input" && (tipo === "submit" || tipo === "image")) || (tag === "button" && (tipo === "submit" || (tipo === "" && !!c.enFormulario)));
  if (envia) { if (nivel === "ok") nivel = "ambiguo"; razones.push("puede enviar un formulario"); }
  if (nivel === "ok") for (const t of textos) { const r = textoAmbiguo(t); if (r.ambiguo) { nivel = "ambiguo"; razones.push(`texto ambiguo «${r.palabra}»`); break; } }
  return { nivel, envia_formulario: envia, razones };
}

// ---------------------------------------------------------------- saneado para registros
/** Ruta apta para registrar: sin parámetros de ruta (;jsessionid=…), sin segmentos que parezcan tokens, ids largos o UUID. Nunca incluye query ni hash. */
export function sanearRuta(ruta) {
  const limpio = String(ruta ?? "").split("?")[0].split("#")[0].split("/").map((seg) => {
    const base = seg.split(";")[0];
    if (/^[A-Za-z0-9_-]{20,}$/.test(base) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(base) || /^\d{6,}$/.test(base) || base.includes("=")) return ":id";
    return base;
  }).join("/");
  return limpio.slice(0, 120);
}

// ---------------------------------------------------------------- hosts y rutas
/** Patrón de host: exacto («portal.ejemplo.gt») o con un solo comodín inicial («*.ejemplo.gt», con al menos dos etiquetas después). */
export function patronHostValido(p) {
  if (typeof p !== "string") return false;
  const s = p.trim().toLowerCase();
  if (s.includes("/") || s.includes(":") || s.includes(" ") || s.includes("@")) return false;
  if (s.startsWith("*.")) return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s.slice(2));
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(s) && s !== "*";
}
export function hostPermitido(host, patrones) {
  const h = String(host ?? "").toLowerCase();
  return (patrones ?? []).some((p) => { const s = String(p).toLowerCase(); return s.startsWith("*.") ? h.endsWith(s.slice(1)) && h.length > s.length - 1 : h === s; });
}
export const esLoopback = (h) => ["127.0.0.1", "localhost", "[::1]", "::1"].includes(String(h).toLowerCase());

/** El endpoint de depuración de Chrome SOLO puede ser local: cualquier otro equipo controlaría tu navegador con tu sesión. */
export function validarEndpointCdp(url) {
  let u; try { u = new URL(url); } catch { return { ok: false, razon: "no es una URL" }; }
  if (!/^(http|ws)s?:$/.test(u.protocol)) return { ok: false, razon: "protocolo no válido" };
  if (!esLoopback(u.hostname)) return { ok: false, razon: "el puerto de depuración debe ser local (127.0.0.1/localhost)" };
  return { ok: true };
}
/** El perfil de Chrome (cookies de sesión) nunca debe quedar dentro del repositorio. */
export function rutaDentroDe(ruta, raiz) {
  const r = path.resolve(ruta), b = path.resolve(raiz), rel = path.relative(b, r);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

// ---------------------------------------------------------------- red: solo lectura
export const METODOS_LECTURA = new Set(["GET", "HEAD", "OPTIONS"]);
/**
 * Política de red: se bloquea TODA petición que no sea de lectura (POST, PUT, PATCH, DELETE…) salvo las que una persona permitió
 * explícitamente en «permitir_post» ({metodo, host, ruta_prefijo}) y cuya ruta no contenga palabras de emisión.
 */
export function evaluarSolicitud({ metodo, url }, politica = {}) {
  const m = String(metodo ?? "").toUpperCase();
  if (METODOS_LECTURA.has(m)) return { permitir: true, razon: "lectura" };
  let u; try { u = new URL(url); } catch { return { permitir: false, razon: "URL no válida" }; }
  if (u.protocol === "data:" || u.protocol === "blob:") return { permitir: true, razon: "local" };
  const regla = (politica.permitir_post ?? []).find((r) => r.metodo?.toUpperCase() === m && r.host?.toLowerCase() === u.hostname.toLowerCase() && u.pathname.startsWith(r.ruta_prefijo ?? "/\u0000"));
  if (!regla) return { permitir: false, razon: `${m} bloqueado (la prueba solo lee; no envía nada al portal)` };
  if (textoProhibido(u.pathname.replace(/[/_-]+/g, " ")).prohibido || /(emit|certific|firm|envi|dte|factura|anul)/i.test(u.pathname)) return { permitir: false, razon: "la ruta parece de emisión: no se puede permitir" };
  return { permitir: true, razon: "permitido explícitamente" };
}

// ---------------------------------------------------------------- validación del mapeo (plan)
export const TIPOS_PASO = ["manual", "esperar_visible", "llenar", "seleccionar", "marcar", "clic_seguro", "leer", "detener"];
export const ESTRATEGIAS = ["etiqueta", "rol", "id", "nombre", "marcador", "texto"];
const necesitaLocalizador = new Set(["esperar_visible", "llenar", "seleccionar", "marcar", "clic_seguro", "leer"]);
const necesitaDato = new Set(["llenar", "seleccionar", "marcar", "leer"]);

/** opciones.local = true solo para la autoprueba con la página de ejemplo (permite no verificado y host local). */
export function validarMapeo(m, { local = false } = {}) {
  const errores = [], avisos = [];
  const e = (s) => errores.push(s);
  if (!m || typeof m !== "object") return { ok: false, errores: ["el mapeo no es un objeto"], avisos };
  if (m.version !== 1) e("version debe ser 1");
  if (!Array.isArray(m.dominios_permitidos) || !m.dominios_permitidos.length) e("dominios_permitidos está vacío: escribe los dominios REALES que observaste (la prueba no los adivina)");
  else for (const p of m.dominios_permitidos) { if (!patronHostValido(p)) e(`dominio no válido: «${p}»`); if (!local && esLoopback(p)) e("un dominio local solo se permite en la autoprueba"); }
  for (const r of m.permitir_post ?? []) {
    if (!r || !r.metodo || !r.host || !r.ruta_prefijo) e("permitir_post: cada regla necesita metodo, host y ruta_prefijo");
    else if (textoProhibido(String(r.ruta_prefijo).replace(/[/_-]+/g, " ")).prohibido || /(emit|certific|firm|envi|dte|factura|anul)/i.test(r.ruta_prefijo)) e(`permitir_post: la ruta «${r.ruta_prefijo}» parece de emisión`);
  }
  if (!Array.isArray(m.pasos) || !m.pasos.length) { e("no hay pasos"); return { ok: false, errores, avisos }; }
  validarSesion(m.sesion, { local, e, avisos });
  const ids = new Set();
  m.pasos.forEach((p, i) => {
    const ctx = `paso ${i + 1}${p?.id ? ` (${p.id})` : ""}`;
    if (!p || typeof p !== "object") return e(`${ctx}: no es un objeto`);
    if (!p.id || ids.has(p.id)) e(`${ctx}: id vacío o repetido`); ids.add(p.id);
    if (!TIPOS_PASO.includes(p.tipo)) return e(`${ctx}: tipo «${p.tipo}» no permitido (permitidos: ${TIPOS_PASO.join(", ")})`);
    if (p.tipo === "manual" && !p.instruccion) e(`${ctx}: falta la instrucción para la persona`);
    if (necesitaLocalizador.has(p.tipo)) {
      const l = p.localizador;
      if (!l || !ESTRATEGIAS.includes(l.estrategia) || !String(l.valor ?? "").trim()) e(`${ctx}: localizador incompleto (estrategia: ${ESTRATEGIAS.join("|")} y valor)`);
      else if (l.estrategia === "rol" && !l.rol) e(`${ctx}: la estrategia «rol» necesita el campo rol`);
      if (!local && p.verificado !== true) e(`${ctx}: verificado no es true — un localizador no confirmado por una persona contra el portal real no se ejecuta`);
      if (l?.estrategia === "texto" && p.tipo !== "clic_seguro" && p.tipo !== "esperar_visible") e(`${ctx}: la estrategia «texto» solo sirve para clic_seguro o esperar_visible`);
    }
    if (p.idempotente != null && typeof p.idempotente !== "boolean") e(`${ctx}: idempotente debe ser true o false`);
    if (necesitaDato.has(p.tipo) && !(typeof p.dato === "string" && p.dato.trim())) e(`${ctx}: falta «dato» (ruta en el archivo de datos ficticios, p. ej. cliente.nombre)`);
    if (p.tipo === "clic_seguro") {
      const r = textoProhibido([p.localizador?.valor, p.localizador?.nombre, p.motivo].join(" "));
      if (r.prohibido) e(`${ctx}: el clic apunta a algo con «${r.palabra}»: PROHIBIDO (la prueba no emite, certifica ni envía)`);
      if (!p.motivo) e(`${ctx}: clic_seguro necesita «motivo» (para qué se hace clic, p. ej. abrir la pestaña Detalle)`);
    }
  });
  const ult = m.pasos[m.pasos.length - 1];
  if (ult?.tipo !== "detener") e("el último paso debe ser de tipo «detener» (parada obligatoria antes de emitir)");
  if (m.pasos.filter((p) => p?.tipo === "detener").length !== 1) e("debe haber exactamente un paso «detener», y al final");
  if (m.pasos.some((p) => p?.verificado === false)) avisos.push("hay pasos con verificado=false");
  return { ok: errores.length === 0, errores, avisos };
}

/** Claves permitidas de «sesion». Todo lo demás se rechaza (en particular cualquier cosa tipo keepalive/ping/refrescar). */
export const CLAVES_SESION = ["hosts_login", "rutas_login", "indicadores_sesion_activa", "indicadores_login", "campo_clave_visible", "intervalo_ms", "espera_max_ms", "reanudar_instruccion"];
function validarSesion(se, { local, e, avisos }) {
  if (se == null) { avisos.push("sin «sesion»: no se detectará el cierre de sesión por indicadores (solo señales genéricas)"); return; }
  if (typeof se !== "object" || Array.isArray(se)) return e("sesion debe ser un objeto");
  for (const k of Object.keys(se)) if (!CLAVES_SESION.includes(k)) e(`sesion.${k}: clave no permitida (permitidas: ${CLAVES_SESION.join(", ")}). No se admiten mecanismos para mantener viva la sesión.`);
  for (const h of se.hosts_login ?? []) if (!patronHostValido(h)) e(`sesion.hosts_login: dominio no válido «${h}»`);
  for (const r of se.rutas_login ?? []) if (typeof r !== "string" || !r.startsWith("/")) e(`sesion.rutas_login: la ruta debe empezar con «/»`);
  for (const lista of ["indicadores_sesion_activa", "indicadores_login"]) for (const [i, ind] of (se[lista] ?? []).entries()) {
    const l = ind?.localizador;
    if (!l || !ESTRATEGIAS.includes(l.estrategia) || !String(l.valor ?? "").trim()) e(`sesion.${lista}[${i}]: localizador incompleto`);
    else if (l.estrategia === "rol" && !l.rol) e(`sesion.${lista}[${i}]: la estrategia «rol» necesita rol`);
    if (!local && ind?.verificado !== true) e(`sesion.${lista}[${i}]: verificado no es true (un indicador no confirmado contra el portal real no se usa)`);
  }
  for (const k of ["intervalo_ms", "espera_max_ms"]) if (se[k] != null && !(Number.isInteger(se[k]) && se[k] > 0)) e(`sesion.${k} debe ser un entero positivo`);
  if (se.intervalo_ms != null && se.intervalo_ms < 1000) e("sesion.intervalo_ms: mínimo 1000 (solo lecturas pasivas, sin sondeos agresivos)");
  if (se.espera_max_ms != null && se.espera_max_ms > 4 * 3600 * 1000) e("sesion.espera_max_ms: máximo 4 horas");
  if (se.reanudar_instruccion != null && typeof se.reanudar_instruccion !== "string") e("sesion.reanudar_instruccion debe ser texto");
}

// ---------------------------------------------------------------- datos ficticios
const camino = (o, ruta) => String(ruta).split(".").reduce((a, k) => (a == null ? undefined : a[k]), o);
export const valorDe = camino;
/**
 * Los datos deben ser claramente ficticios: ficticio=true, nombres y descripciones con «PRUEBA», NIT solo «CF» o declarados por la persona.
 * Nunca se usan NIT ni nombres de terceros reales.
 */
export function validarDatos(d) {
  const errores = [], e = (s) => errores.push(s);
  if (!d || typeof d !== "object") return { ok: false, errores: ["los datos no son un objeto"] };
  if (d.ficticio !== true) e("falta «ficticio»: true (confirma que son datos inventados)");
  const nits = new Set(["CF", ...(Array.isArray(d.nits_de_prueba_declarados) ? d.nits_de_prueba_declarados.map(String) : [])]);
  const visitar = (o, ruta) => {
    if (o && typeof o === "object") return Object.entries(o).forEach(([k, v]) => visitar(v, ruta ? `${ruta}.${k}` : k));
    const clave = ruta.split(".").pop().toLowerCase();
    if (/(^|_)nit($|_)/.test(clave) && !nits.has(String(o))) e(`${ruta}: NIT no permitido (usa «CF» o decláralo en nits_de_prueba_declarados, siendo tuyo o de prueba)`);
    if (/(nombre|descripcion|razon)/.test(clave) && !/PRUEBA/.test(String(o))) e(`${ruta}: debe contener la palabra PRUEBA`);
  };
  visitar(d, "");
  return { ok: errores.length === 0, errores };
}

// ---------------------------------------------------------------- aislamiento entre empresas
/** Dos empresas no pueden compartir puerto de depuración, perfil de Chrome ni carpeta de registros. */
export function validarAislamiento(empresas) {
  const errores = [], vistos = { alias: new Map(), cdp: new Map(), perfil: new Map(), registros: new Map() };
  const marca = (mapa, clave, alias, etiqueta) => { if (!clave) return; if (mapa.has(clave)) errores.push(`«${alias}» y «${mapa.get(clave)}» comparten ${etiqueta}`); else mapa.set(clave, alias); };
  for (const e of empresas) {
    if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(String(e.alias ?? ""))) errores.push(`alias no válido: «${e.alias}» (minúsculas, números y guiones)`);
    marca(vistos.alias, e.alias, e.alias, "el alias");
    marca(vistos.cdp, e.cdp ? new URL(e.cdp).port : null, e.alias, "el puerto de depuración");
    marca(vistos.perfil, e.perfil_dir ? path.resolve(e.perfil_dir) : null, e.alias, "el perfil de Chrome");
    marca(vistos.registros, e.registros_dir ? path.resolve(e.registros_dir) : null, e.alias, "la carpeta de registros");
  }
  return { ok: errores.length === 0, errores };
}
