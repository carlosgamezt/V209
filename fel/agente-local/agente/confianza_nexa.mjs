// CONFIANZA en las respuestas de NEXA: claves públicas de verificación (incrustadas + anunciadas), rotación y comprobación de cada respuesta.
// Una respuesta solo se acepta si: la firma Ed25519 es válida con una clave confiable y vigente, la marca de tiempo es reciente, el nonce es el de ESTA petición,
// el estado HTTP y el cuerpo son los firmados. Sin eso no se obedece nada (ni una orden ni un «revocado»).
// Distribución: el agente trae claves incrustadas (las fijará el instalador firmado, 8c); NEXA anuncia claves nuevas firmadas por una clave ya confiable («nexa-clave-v1») y puede
// revocar claves con una clave INCRUSTADA («nexa-revoca-v1»). Diseño: fel/docs/agente-transporte-remoto.md.
import { createHash, createPublicKey, verify } from "node:crypto";

/** Claves incrustadas en el agente: [{ kid, publica (32 bytes en base64url), desde, hasta|null }]. Vacío hasta el instalador (8c): entonces solo se admiten las de la configuración. */
export const CLAVES_NEXA_INCRUSTADAS = [];
export const DOMINIO_RESPUESTA = "nexa-respuesta-v1", DOMINIO_ANUNCIO = "nexa-clave-v1", DOMINIO_REVOCA = "nexa-revoca-v1";
export const TOLERANCIA_RESPUESTA_MS = 120_000;
const PREFIJO_DER = Buffer.from("302a300506032b6570032100", "hex");
const RE_B64U = /^[A-Za-z0-9_-]+$/, RE_KID = /^[A-Za-z0-9_-]{1,32}$/, RE_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;
const b64u = (s) => (typeof s === "string" && RE_B64U.test(s) ? Buffer.from(s, "base64url") : null);

export class ErrorRespuesta extends Error { constructor(codigo, mensaje) { super(mensaje ?? codigo); this.codigo = codigo; } }

function llavePublica(publica) { const raw = b64u(publica); if (!raw || raw.length !== 32) return null; try { return createPublicKey({ key: Buffer.concat([PREFIJO_DER, raw]), format: "der", type: "spki" }); } catch { return null; } }
function verificarEd25519(publica, mensaje, firmaB64u) {
  try { const k = llavePublica(publica), f = b64u(firmaB64u); if (!k || !f || f.length !== 64) return false; return verify(null, Buffer.from(mensaje), k, f); } catch { return false; }
}
const fechaOk = (t) => typeof t === "string" && RE_TS.test(t) && !Number.isNaN(Date.parse(t));

/** Almacén de claves confiables. `persistencia` (opcional): { leer(): obj|null, escribir(obj) } para recordar los anuncios aceptados. */
export function crearConfianza({ incrustadas = CLAVES_NEXA_INCRUSTADAS, persistencia = null, ahora = () => new Date() } = {}) {
  const base = new Map(), anunciadas = new Map(), revocadas = new Set(); let anuncios = [], revocaciones = [];
  for (const k of incrustadas) {
    if (!RE_KID.test(k.kid) || !llavePublica(k.publica) || !fechaOk(k.desde) || (k.hasta != null && !fechaOk(k.hasta))) throw new Error("clave de NEXA incrustada no válida");
    base.set(k.kid, { kid: k.kid, publica: k.publica, desde: k.desde, hasta: k.hasta ?? null, origen: "incrustada" });
  }
  const vigente = (k, t) => !revocadas.has(k.kid) && Date.parse(k.desde) <= t.getTime() && (k.hasta === null || t.getTime() <= Date.parse(k.hasta));
  const obtener = (kid, t = ahora()) => { const k = base.get(kid) ?? anunciadas.get(kid); return k && vigente(k, t) ? k : null; };

  function aceptarRevocacion(r) {
    if (!r || !RE_KID.test(r.kid) || !RE_KID.test(r.anuncio_kid) || r.anuncio_kid === r.kid) return false;
    const firmante = base.get(r.anuncio_kid);                                           // la revocación solo la firma una clave INCRUSTADA (una clave anunciada comprometida no puede revocar a las demás)
    if (!firmante || revocadas.has(firmante.kid) || !verificarEd25519(firmante.publica, `${DOMINIO_REVOCA}\n${r.kid}`, r.firma)) return false;
    revocadas.add(r.kid); return true;
  }
  function aceptarAnuncio(a) {
    if (!a || !RE_KID.test(a.kid) || !RE_KID.test(a.anuncio_kid) || !fechaOk(a.desde) || (a.hasta != null && !fechaOk(a.hasta)) || (a.hasta != null && Date.parse(a.hasta) <= Date.parse(a.desde)) || !llavePublica(a.publica)) return false;
    if (a.hasta != null && Date.parse(a.hasta) <= ahora().getTime()) return false;       // un anuncio que ya venció no se acepta
    const existente = base.get(a.kid) ?? anunciadas.get(a.kid);
    if (existente) return existente.publica === a.publica;                              // una clave ya conocida no se cambia; repetir el mismo anuncio es inofensivo
    const firmante = obtener(a.anuncio_kid); if (!firmante) return false;               // debe firmarlo una clave que YA confiamos y que sigue vigente
    if (!verificarEd25519(firmante.publica, `${DOMINIO_ANUNCIO}\n${a.kid}\n${a.publica}\n${a.desde}\n${a.hasta ?? ""}`, a.firma)) return false;
    if (anunciadas.size >= 20) return false;
    anunciadas.set(a.kid, { kid: a.kid, publica: a.publica, desde: a.desde, hasta: a.hasta ?? null, origen: "anunciada" }); return true;
  }
  /** Procesa lo que NEXA distribuye en una respuesta. Devuelve los kid aceptados/rechazados; guarda lo aceptado. */
  function procesarDistribucion({ claves_nexa = [], revocadas: revs = [] } = {}) {
    const res = { aceptadas: [], rechazadas: [], revocadas: [] }; let cambio = false;
    // Primero los anuncios y después las revocaciones: una clave que anunció a otra mientras era de confianza no invalida lo anunciado al ser revocada
    // (si estaba comprometida, NEXA revoca también lo que anunció, explícitamente).
    for (const a of Array.isArray(claves_nexa) ? claves_nexa.slice(0, 20) : []) {
      const nueva = !anunciadas.has(a?.kid) && !base.has(a?.kid);
      if (aceptarAnuncio(a)) { if (nueva) { res.aceptadas.push(a.kid); anuncios.push(a); cambio = true; } } else res.rechazadas.push(String(a?.kid ?? "?").slice(0, 32));
    }
    for (const r of Array.isArray(revs) ? revs.slice(0, 20) : []) { if (!revocadas.has(r?.kid) && aceptarRevocacion(r)) { res.revocadas.push(r.kid); revocaciones.push(r); cambio = true; } }
    if (cambio) { try { persistencia?.escribir({ claves_nexa: anuncios, revocadas: revocaciones }); } catch { /* sin persistencia: se reaprende en la siguiente respuesta */ } }
    return res;
  }
  // restaura lo aprendido (se vuelve a VERIFICAR todo contra las claves incrustadas: un archivo manipulado no añade confianza)
  try { const p = persistencia?.leer(); if (p) { const a = p.claves_nexa ?? [], r = p.revocadas ?? []; for (let i = 0; i < 3; i++) { procesarDistribucion({ claves_nexa: a, revocadas: r }); } } } catch { /* ilegible: se ignora */ }

  return {
    obtener, procesarDistribucion,
    /** kid que declaramos conocer (para que NEXA solo anuncie lo nuevo). */
    kids: () => [...base.keys(), ...anunciadas.keys()].filter((k) => !revocadas.has(k)).slice(0, 20),
    cantidad: () => base.size + anunciadas.size, revocada: (kid) => revocadas.has(kid),
  };
}

/** Comprueba una respuesta. Lanza ErrorRespuesta con un código estable ante CUALQUIER problema (sin lanzar nunca otra cosa). */
export function verificarRespuesta({ confianza, nonce, status, headers, cuerpo, ahora = () => new Date(), toleranciaMs = TOLERANCIA_RESPUESTA_MS }) {
  const kid = headers["x-nexa-kid"], ts = headers["x-nexa-ts"], firma = headers["x-nexa-firma"];
  if (typeof kid !== "string" || typeof ts !== "string" || typeof firma !== "string") throw new ErrorRespuesta("SIN_FIRMA", "La respuesta no trae la firma de NEXA");
  if (!RE_KID.test(kid)) throw new ErrorRespuesta("FIRMA_INVALIDA", "Identificador de clave no válido");
  const clave = confianza.obtener(kid);
  if (!clave) throw new ErrorRespuesta("CLAVE_DESCONOCIDA", "La respuesta está firmada con una clave en la que no se confía (o revocada o fuera de vigencia)");
  if (!RE_TS.test(ts) || Number.isNaN(Date.parse(ts))) throw new ErrorRespuesta("FIRMA_INVALIDA", "Marca de tiempo no válida");
  const desfase = Math.abs(ahora().getTime() - Date.parse(ts)); if (desfase > toleranciaMs) throw new ErrorRespuesta("RESPUESTA_VENCIDA", "La respuesta está fuera de tiempo (vencida o del futuro)");
  const hash = createHash("sha256").update(cuerpo).digest("hex");
  if (!verificarEd25519(clave.publica, `${DOMINIO_RESPUESTA}\n${kid}\n${nonce}\n${status}\n${ts}\n${hash}`, firma)) throw new ErrorRespuesta("FIRMA_INVALIDA", "La firma de la respuesta no es válida para esta petición");
  return { kid };
}
