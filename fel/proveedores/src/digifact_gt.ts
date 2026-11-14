// Cliente de la API REST de Digifact Guatemala (NUC). Documentación oficial leída el 14/11/2026: https://documentacion.digifact.com/gt/api.md (V2.0.6; TEST corre V2.4.0).
// Aquí solo existen los servicios y campos que esa documentación describe; lo que NO dice queda marcado «pendiente» en fel/docs/digifact/integracion-pendiente.md.
// REGLAS DE SEGURIDAD
//  · Solo se ejecuta en el SERVIDOR. La contraseña se pide con una función (nunca queda en un campo del objeto) y el token vive solo en memoria, dentro de este cliente.
//  · Ningún error, mensaje ni registro contiene la contraseña, el token ni cabeceras. Lo que Digifact diga en su «message» se limpia antes de mostrarse.
//  · Un solo intento por certificación: tras enviar, un fallo de red, tiempo agotado, 5xx o respuesta ilegible NO se reenvía: se devuelve «desconocido» para CONCILIAR (conciliarPorReferencia).
//    Lo único que se repite sin riesgo es el inicio de sesión y una petición que Digifact rechazó con 401 (no autorizada = no procesada), una sola vez y con token nuevo.
//  · Producción está BLOQUEADA en esta versión (hace falta autorización expresa); las credenciales de TEST nunca se usan contra el servidor productivo.
import { crearTransporteHttp } from "./transporte_http.ts";
import type { PeticionHttp, RespuestaHttp, Transporte } from "./digifact.ts";
import type { MotivoDesconocido } from "./tipos.ts";

export type TipoErrorDigifact = "autenticacion" | "no_autorizado" | "limite" | "servidor" | "solicitud" | "tiempo_agotado" | "corte_de_red" | "respuesta_invalida" | "no_permitido";
export class ErrorDigifact extends Error {
  constructor(public tipo: TipoErrorDigifact, mensaje: string, public estadoHttp?: number) { super(mensaje); this.name = "ErrorDigifact"; }
}

export const URL_BASE = { test: "https://testnucgt.digifact.com/api", produccion: "https://nucgt.digifact.com/gt.com.apinuc/api" } as const;
export type FormatoDte = "PDF" | "HTML" | "XML";

/** NIT con ceros a la izquierda hasta 12 dígitos (exigido por la documentación para el usuario y para TAXID). */
export function nit12(nit: string): string {
  const n = String(nit).trim(); if (!/^\d{1,12}$/.test(n)) throw new ErrorDigifact("solicitud", "El NIT debe tener de 1 a 12 dígitos, sin guiones");
  return n.padStart(12, "0");
}
/** Usuario de inicio de sesión: «GT.» + NIT de 12 dígitos + «.» + usuario (documentación, «Obtener Token»). */
export function usuarioLogin(nit: string, usuario: string): string { return `GT.${nit12(nit)}.${validarUsuario(usuario)}`; }
function validarUsuario(u: string): string { if (!/^[A-Za-z0-9_.-]{2,60}$/.test(u)) throw new ErrorDigifact("solicitud", "Usuario de Digifact no válido"); return u; }

export interface ConfigDigifactGt {
  nit: string; usuario: string;
  /** Devuelve la contraseña cada vez que hace falta (p. ej. desde Deno.env). Así no se guarda como propiedad del cliente. */
  obtenerClave: () => string;
  transporte: Transporte;
  ahora?: () => number;                       // ms; inyectable para pruebas
  margenRenovacionS?: number;                 // renueva el token este tiempo antes de que venza (60 s)
  vigenciaPorDefectoS?: number;               // si el token no trae «exp» (600 s); el 401 sigue siendo la señal definitiva
  /** La documentación solo dice «Token JWT»; la guía oficial lo muestra sin prefijo. «bearer» queda por si la primera llamada real lo exigiera. */
  esquemaAutorizacion?: "raw" | "bearer";
  permitirAnulacion?: boolean; permitirNotaCredito?: boolean;   // operaciones fiscales: cerradas salvo habilitación explícita
}
export interface OpcionesFabrica { ambiente: "test" | "produccion"; nit: string; usuario: string; obtenerClave: () => string; tiempoMaximoMs?: number; fetchImpl?: typeof fetch; esquemaAutorizacion?: "raw" | "bearer"; permitirAnulacion?: boolean; permitirNotaCredito?: boolean }

export function crearDigifactGt(o: OpcionesFabrica): DigifactGt {
  if (o.ambiente !== "test") throw new ErrorDigifact("no_permitido", "Producción está bloqueada en esta versión: requiere autorización expresa y credenciales productivas propias de cada emisor");
  const transporte = crearTransporteHttp({ baseUrl: URL_BASE.test, tiempoMaximoMs: o.tiempoMaximoMs ?? 30_000, maxBytesRespuesta: 20_000_000, fetchImpl: o.fetchImpl });
  return new DigifactGt({ nit: o.nit, usuario: o.usuario, obtenerClave: o.obtenerClave, transporte, esquemaAutorizacion: o.esquemaAutorizacion, permitirAnulacion: o.permitirAnulacion, permitirNotaCredito: o.permitirNotaCredito });
}

export interface ArtefactosB64 { xml?: string; html?: string; pdf?: string }
export type ResultadoCertificacionGt =
  | { tipo: "certificado"; autorizacion: string; serie: string; numero: string; fechaCertificacion: string; artefactos: ArtefactosB64; crudoSaneado: Record<string, unknown> }
  | { tipo: "rechazado_confirmado"; codigo: string; mensaje: string; crudoSaneado: Record<string, unknown> }
  | { tipo: "desconocido"; motivo: MotivoDesconocido };
export type ResultadoConsultaNit = { encontrado: true; nit: string; nombre: string } | { encontrado: false };
export type ResultadoConsultaDte = { encontrado: true; tipoDte: string; autorizacion: string; serie: string; numero: string; fechaEmision: string; nitComprador: string; total: string; xmlB64?: string } | { encontrado: false };
export type ResultadoDescarga = { encontrado: true; artefactos: ArtefactosB64 } | { encontrado: false };
export type ResultadoAnulacionGt =
  | { tipo: "anulado"; autorizacion: string; crudoSaneado: Record<string, unknown> }
  | { tipo: "rechazado_confirmado"; codigo: string; mensaje: string }
  | { tipo: "desconocido"; motivo: MotivoDesconocido };
export type EstadoAcuse = "ACEPTADO_SAT" | "PENDIENTE_SAT" | "RECHAZADO_SAT";
export interface DocumentoReporte { autorizacion: string; serie: string; numero: string; tipoDte: string; fechaCertificacion: string; referenciaInterna: string; estadoAcuse: string; anulado: boolean; total: string }
export type ResultadoConciliacionGt = { tipo: "encontrado"; documento: DocumentoReporte } | { tipo: "no_encontrado" } | { tipo: "indeterminado"; motivo: string };

function base64Url(s: string): string { return atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")); }
/** Lee el «exp» (segundos) de un JWT SIN verificarlo (solo para saber cuándo renovar). */
function expDeJwt(t: string): number | null {
  try { const p = JSON.parse(base64Url(t.split(".")[1] ?? "")); return typeof p.exp === "number" ? p.exp : null; } catch { return null; }
}
const num = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const FECHA_DIA = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;

export class DigifactGt {
  #token: string | null = null; #expira = 0; #pendiente: Promise<string> | null = null;
  #enVuelo = new Set<string>();
  #ahora: () => number; #margen: number; #vigencia: number; #esquema: "raw" | "bearer";
  /** Cuántos inicios de sesión se han hecho (para pruebas y para vigilar que no haya tormentas de autenticación). */
  logins = 0;
  constructor(private c: ConfigDigifactGt) {
    nit12(c.nit); validarUsuario(c.usuario);
    this.#ahora = c.ahora ?? Date.now; this.#margen = c.margenRenovacionS ?? 60; this.#vigencia = c.vigenciaPorDefectoS ?? 600; this.#esquema = c.esquemaAutorizacion ?? "raw";
  }

  /** Texto de Digifact sin secretos (se quita cualquier aparición de la contraseña o del token) y acotado. */
  #limpio(t: unknown): string {
    let s = typeof t === "string" ? t : ""; if (!s) return "";
    for (const secreto of [this.#token ?? "", this.#claveSegura()]) if (secreto.length >= 4) s = s.split(secreto).join("***");
    return s.replace(/[\r\n\t]+/g, " ").slice(0, 300);
  }
  #claveSegura(): string { try { return this.c.obtenerClave(); } catch { return ""; } }
  #errorTransporte(e: unknown): ErrorDigifact {
    return e instanceof Error && e.name === "TiempoAgotado" ? new ErrorDigifact("tiempo_agotado", "Digifact no respondió a tiempo") : new ErrorDigifact("corte_de_red", "No se pudo contactar a Digifact");
  }
  #porEstado(r: RespuestaHttp, contexto: string): ErrorDigifact {
    const e = r.estado;
    if (e === 401) return new ErrorDigifact("no_autorizado", `${contexto}: Digifact respondió 401 (no autorizado)`, e);
    if (e === 403) return new ErrorDigifact("no_autorizado", `${contexto}: Digifact respondió 403 (sin permiso)`, e);
    if (e === 429) return new ErrorDigifact("limite", `${contexto}: demasiadas solicitudes (429); espera antes de volver a intentar`, e);
    if (e >= 500) return new ErrorDigifact("servidor", `${contexto}: error del servidor de Digifact (${e})`, e);
    return new ErrorDigifact("solicitud", `${contexto}: Digifact rechazó la solicitud (${e})`, e);
  }

  /** Token vigente. Una sola autenticación a la vez aunque lleguen muchas solicitudes juntas. */
  token(): Promise<string> {
    if (this.#token && this.#ahora() < this.#expira - this.#margen * 1000) return Promise.resolve(this.#token);
    return this.#autenticar();
  }
  /** Renueva SOLO si el token rechazado sigue siendo el actual (si otra solicitud ya lo renovó, se reutiliza el nuevo). */
  #renovar(rechazado: string): Promise<string> {
    if (this.#token && this.#token !== rechazado) return Promise.resolve(this.#token);
    this.#token = null; return this.#autenticar();
  }
  #autenticar(): Promise<string> {
    if (this.#pendiente) return this.#pendiente;
    this.#pendiente = (async () => {
      try {
        this.logins++;
        let r: RespuestaHttp;
        try {
          r = await this.c.transporte({ metodo: "POST", ruta: "/login/get_token", cabeceras: { "content-type": "application/json" }, cuerpo: JSON.stringify({ Username: usuarioLogin(this.c.nit, this.c.usuario), Password: this.c.obtenerClave() }) });
        } catch (e) { throw this.#errorTransporte(e); }
        if (r.estado === 401 || r.estado === 403) throw new ErrorDigifact("autenticacion", "Digifact rechazó el usuario o la contraseña", r.estado);
        if (r.estado !== 200) throw this.#porEstado(r, "Inicio de sesión");
        let j: { token?: unknown } | null = null; try { j = JSON.parse(r.cuerpo); } catch { /* respuesta ilegible */ }
        if (!j || typeof j.token !== "string" || j.token.length < 10) throw new ErrorDigifact("respuesta_invalida", "La respuesta de inicio de sesión no trae un token");
        const exp = expDeJwt(j.token);
        this.#token = j.token; this.#expira = exp !== null ? exp * 1000 : this.#ahora() + this.#vigencia * 1000;
        return j.token;
      } finally { this.#pendiente = null; }
    })();
    return this.#pendiente;
  }
  /** Estado de la sesión sin exponer el token (para el script de prueba). */
  estadoSesion(): { activa: boolean; venceEnS: number | null } { return this.#token ? { activa: true, venceEnS: Math.round((this.#expira - this.#ahora()) / 1000) } : { activa: false, venceEnS: null }; }

  #cabeceras(tk: string, json: boolean): Record<string, string> {
    return { authorization: this.#esquema === "bearer" ? `Bearer ${tk}` : tk, ...(json ? { "content-type": "application/json" } : {}) };
  }
  async #enviar(p: Omit<PeticionHttp, "cabeceras">, json: boolean, tk: string): Promise<RespuestaHttp> {
    return await this.c.transporte({ ...p, cabeceras: this.#cabeceras(tk, json) });
  }
  /** Solicitud autenticada. Un 401 (o un código 401 en el cuerpo) significa «no procesada»: se renueva el token y se repite UNA vez. Los fallos de red se propagan sin repetir. */
  async #llamar(p: Omit<PeticionHttp, "cabeceras">, json: boolean): Promise<RespuestaHttp> {
    const tk = await this.token();
    const r = await this.#enviar(p, json, tk);
    if (r.estado === 401) { const nuevo = await this.#renovar(tk); return await this.#enviar(p, json, nuevo); }
    return r;
  }

  /* ------------------------------ certificación (POST /v2/transform/nuc_json) ------------------------------ */
  /** Envía UNA vez. «referencia» (la referencia interna del documento) impide dos envíos simultáneos del mismo documento en este proceso. */
  async certificar(nuc: Record<string, unknown>, o: { referencia: string; formatos?: FormatoDte[] }): Promise<ResultadoCertificacionGt> {
    if (!UUID.test(o.referencia)) throw new ErrorDigifact("solicitud", "La referencia interna debe ser un GUID de 36 caracteres");
    if (this.#enVuelo.has(o.referencia)) throw new ErrorDigifact("no_permitido", "Ya hay un envío en curso de este documento: no se duplica");
    this.#enVuelo.add(o.referencia);
    try { return await this.#certificar(nuc, o.formatos ?? ["XML", "PDF"]); } finally { this.#enVuelo.delete(o.referencia); }
  }
  async #certificar(nuc: Record<string, unknown>, formatos: FormatoDte[]): Promise<ResultadoCertificacionGt> {
    await this.token();   // si la autenticación falla, NADA se envió: el error se propaga como tal (no es «desconocido»)
    const q = new URLSearchParams({ TAXID: nit12(this.c.nit), FORMAT: formatos.join("|"), USERNAME: this.c.usuario });
    let r: RespuestaHttp;
    try { r = await this.#llamar({ metodo: "POST", ruta: `/v2/transform/nuc_json?${q}`, cuerpo: JSON.stringify(nuc) }, true); }
    catch (e) {
      if (e instanceof ErrorDigifact) throw e;      // 401 persistente tras renovar: no se procesó
      return { tipo: "desconocido", motivo: e instanceof Error && e.name === "TiempoAgotado" ? "timeout" : "corte" };
    }
    return this.#leerCertificacion(r);
  }
  #leerCertificacion(r: RespuestaHttp): ResultadoCertificacionGt {
    if (r.estado === 401 || r.estado === 403) throw this.#porEstado(r, "Certificación");   // rechazada antes de procesar
    if (r.estado >= 500) return { tipo: "desconocido", motivo: "limite_o_caida" };
    if (r.estado === 429) return { tipo: "desconocido", motivo: "limite_o_caida" };
    let j: Record<string, unknown> | null = null; try { j = JSON.parse(r.cuerpo); } catch { /* ilegible */ }
    if (!j || typeof j !== "object") {
      if (r.estado >= 400) return { tipo: "rechazado_confirmado", codigo: String(r.estado), mensaje: this.#limpio(r.cuerpo) || "Digifact rechazó la solicitud", crudoSaneado: { estadoHttp: r.estado } };
      return { tipo: "desconocido", motivo: "respuesta_ilegible" };
    }
    const codigo = num(j.code), crudo = this.#saneado(j);
    if (codigo === "1" && r.estado === 200) {
      const aut = num(j.authNumber), serie = num(j.batch), numero = num(j.serial), fecha = num(j.enrolledTimeStamp);
      if (!UUID.test(aut) || !serie || !numero) return { tipo: "desconocido", motivo: "respuesta_ilegible" };   // «éxito» sin datos fiscales completos NO es éxito
      return { tipo: "certificado", autorizacion: aut.toUpperCase(), serie, numero, fechaCertificacion: fecha, artefactos: this.#artefactos(j, "responseData"), crudoSaneado: crudo };
    }
    if (codigo === "" ) return { tipo: "desconocido", motivo: "codigo_no_mapeado" };
    if (codigo === "401") throw new ErrorDigifact("no_autorizado", "Certificación: Digifact respondió código 401", 401);
    if (codigo === "500") return { tipo: "desconocido", motivo: "limite_o_caida" };
    return { tipo: "rechazado_confirmado", codigo, mensaje: this.#limpio(num(j.message) || num(j.description)) || "Digifact rechazó el documento", crudoSaneado: crudo };
  }
  #saneado(j: Record<string, unknown>): Record<string, unknown> {
    const o: Record<string, unknown> = {};
    for (const k of ["code", "message", "description", "authNumber", "batch", "serial", "issuedTimeStamp", "enrolledTimeStamp", "taxID", "receiverTaxID", "totalAmount"]) if (j[k] !== undefined) o[k] = typeof j[k] === "string" ? this.#limpio(j[k]) : j[k];
    return o;   // nunca los *base64* completos ni el token
  }
  #artefactos(j: Record<string, unknown>, pref: string): ArtefactosB64 {
    const g = (n: number) => { const v = j[`${pref}${n}`] ?? j[`${pref[0].toUpperCase()}${pref.slice(1)}${n}`]; return typeof v === "string" && v.length ? v : undefined; };
    return { xml: g(1), html: g(2), pdf: g(3) };
  }

  /* ------------------------------ consultas (GET /Shared) ------------------------------ */
  async #shared(data1: string, data2: string): Promise<{ r: RespuestaHttp; j: Record<string, unknown> | null }> {
    const q = new URLSearchParams({ COUNTRY: "GT", TAXID: nit12(this.c.nit), DATA1: data1, DATA2: data2, USERNAME: this.c.usuario });
    let r: RespuestaHttp;
    try { r = await this.#llamar({ metodo: "GET", ruta: `/Shared?${q}` }, false); } catch (e) { throw e instanceof ErrorDigifact ? e : this.#errorTransporte(e); }
    if (r.estado !== 200) throw this.#porEstado(r, "Consulta");
    let j: Record<string, unknown> | null = null; try { j = JSON.parse(r.cuerpo); } catch { /* ilegible */ }
    if (!j || typeof j !== "object") throw new ErrorDigifact("respuesta_invalida", "La consulta devolvió una respuesta ilegible");
    return { r, j };
  }
  static #filas(j: Record<string, unknown>): Record<string, unknown>[] { const x = j.RESPONSE; return Array.isArray(x) ? x.filter((f): f is Record<string, unknown> => !!f && typeof f === "object") : []; }

  /** SHARED_GETINFONITcom: razón social de un contribuyente. */
  async consultarNit(nitConsultado: string): Promise<ResultadoConsultaNit> {
    const n = String(nitConsultado).trim().toUpperCase(); if (!/^\d{1,11}[0-9K]$/.test(n)) throw new ErrorDigifact("solicitud", "NIT a consultar no válido");
    const { j } = await this.#shared("SHARED_GETINFONITcom", `NIT|${n}`);
    const f = DigifactGt.#filas(j!)[0];
    return f && num(f.NOMBRE) ? { encontrado: true, nit: num(f.NIT) || n, nombre: this.#limpio(num(f.NOMBRE)) } : { encontrado: false };
  }
  /** SHARED_GETDTEINFO: datos de un DTE por su número de autorización. */
  async consultarDte(autorizacion: string): Promise<ResultadoConsultaDte> {
    if (!UUID.test(autorizacion)) throw new ErrorDigifact("solicitud", "La autorización debe ser un GUID de 36 caracteres");
    const { j } = await this.#shared("SHARED_GETDTEINFO", `AUTHNUMBER|${autorizacion.toUpperCase()}`);
    const f = DigifactGt.#filas(j!)[0];
    if (!f || !num(f.GUID)) return { encontrado: false };
    return { encontrado: true, tipoDte: num(f.TIPO_DTE), autorizacion: num(f.GUID).toUpperCase(), serie: num(f.SERIE), numero: num(f.NUMERO), fechaEmision: num(f.FECHA_DE_EMISION), nitComprador: num(f.NIT_COMPRADOR), total: num(f.TOTAL), xmlB64: typeof f.DTE === "string" && f.DTE ? f.DTE : undefined };
  }
  /**
   * CONCILIACIÓN por referencia interna con el reporte diario de acuses (SHARED_GETREPORTDAILYACUSES; la guía oficial dice que por ahora solo existe en TEST).
   * «no_encontrado» NO prueba que no se certificó (puede haber demora): el orquestador debe esperar y repetir la consulta antes de permitir un reenvío.
   */
  async conciliarPorReferencia(fecha: string, referenciaInterna: string, establecimiento?: number): Promise<ResultadoConciliacionGt> {
    if (!FECHA_DIA.test(fecha)) throw new ErrorDigifact("solicitud", "La fecha debe ser AAAA-MM-DD");
    if (!UUID.test(referenciaInterna)) throw new ErrorDigifact("solicitud", "La referencia interna debe ser un GUID de 36 caracteres");
    const filtros = `FECHA|${fecha}` + (establecimiento !== undefined ? `|ESTABLECIMIENTO|${Math.trunc(establecimiento)}` : "");
    let j: Record<string, unknown> | null;
    try { ({ j } = await this.#shared("SHARED_GETREPORTDAILYACUSES", filtros)); }
    catch (e) { return { tipo: "indeterminado", motivo: e instanceof ErrorDigifact ? e.message : "fallo desconocido" }; }
    const meta = Array.isArray(j!.REQUEST_DATA) ? (j!.REQUEST_DATA as Record<string, unknown>[])[0] : undefined;
    const filas = DigifactGt.#filas(j!);
    if (!filas.length) return num(meta?.Respuesta) === "0" ? { tipo: "no_encontrado" } : { tipo: "indeterminado", motivo: "el reporte vino sin filas ni respuesta clara" };
    const hallada = filas.find((f) => num(f.REFERENCIA_INTERNA).toUpperCase() === referenciaInterna.toUpperCase());
    if (!hallada) return { tipo: "no_encontrado" };
    return { tipo: "encontrado", documento: { autorizacion: num(hallada.GUID).toUpperCase(), serie: num(hallada.SERIE), numero: num(hallada.NUMERO), tipoDte: num(hallada.TIPO_DTE), fechaCertificacion: num(hallada.FECHA_DE_CERTIFICACION), referenciaInterna: num(hallada.REFERENCIA_INTERNA), estadoAcuse: num(hallada.ACUSE_RECEPCION_ESTADO), anulado: num(hallada.ESTATUS).toUpperCase() === "ANULADO", total: num(hallada.TOTAL) } };
  }

  /* ------------------------------ descarga (GET /GetDocument) ------------------------------ */
  async obtenerDocumento(autorizacion: string, formatos: FormatoDte[] = ["XML", "PDF"]): Promise<ResultadoDescarga> {
    if (!UUID.test(autorizacion)) throw new ErrorDigifact("solicitud", "La autorización debe ser un GUID de 36 caracteres");
    const q = new URLSearchParams({ AUTHNUMBER: autorizacion.toUpperCase(), TAXID: nit12(this.c.nit), FORMAT: formatos.join("|"), USERNAME: this.c.usuario });
    let r: RespuestaHttp;
    try { r = await this.#llamar({ metodo: "GET", ruta: `/GetDocument?${q}` }, false); } catch (e) { throw e instanceof ErrorDigifact ? e : this.#errorTransporte(e); }
    if (r.estado !== 200) throw this.#porEstado(r, "Descarga");
    let j: Record<string, unknown> | null = null; try { j = JSON.parse(r.cuerpo); } catch { /* ilegible */ }
    if (!j) throw new ErrorDigifact("respuesta_invalida", "La descarga devolvió una respuesta ilegible");
    const f = DigifactGt.#filas(j)[0];
    return f ? { encontrado: true, artefactos: this.#artefactos(f, "responseData") } : { encontrado: false };
  }

  /* ------------------------------ operaciones fiscales protegidas ------------------------------ */
  /** POST /CancelFelGT. Cerrada salvo habilitación explícita Y confirmación literal «ANULAR». */
  async anular(a: { autorizacion: string; nitReceptor: string; fechaEmision: string; motivo: string; confirmacion: string }): Promise<ResultadoAnulacionGt> {
    if (!this.c.permitirAnulacion) throw new ErrorDigifact("no_permitido", "La anulación no está habilitada");
    if (a.confirmacion !== "ANULAR") throw new ErrorDigifact("no_permitido", "Falta la confirmación explícita (escribe ANULAR)");
    if (!UUID.test(a.autorizacion)) throw new ErrorDigifact("solicitud", "La autorización debe ser un GUID de 36 caracteres");
    if (!/^(CF|\d{1,13}|\d{1,11}K)$/i.test(a.nitReceptor)) throw new ErrorDigifact("solicitud", "NIT del receptor no válido (usa CF para Consumidor Final)");
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(a.fechaEmision)) throw new ErrorDigifact("solicitud", "La fecha de emisión debe ser AAAA-MM-DDThh:mm:ss");
    if (a.motivo.trim().length < 3 || a.motivo.length > 200) throw new ErrorDigifact("solicitud", "El motivo debe tener de 3 a 200 caracteres");
    await this.token();
    let r: RespuestaHttp;
    try { r = await this.#llamar({ metodo: "POST", ruta: "/CancelFelGT", cuerpo: JSON.stringify({ Taxid: String(Number(this.c.nit)), Autorizacion: a.autorizacion.toUpperCase(), IdReceptor: a.nitReceptor.toUpperCase(), FechaEmisionDocumentoAnular: a.fechaEmision, MotivoAnulacion: a.motivo.trim(), Username: this.c.usuario }) }, true); }
    catch (e) { if (e instanceof ErrorDigifact) throw e; return { tipo: "desconocido", motivo: e instanceof Error && e.name === "TiempoAgotado" ? "timeout" : "corte" }; }
    if (r.estado >= 500 || r.estado === 429) return { tipo: "desconocido", motivo: "limite_o_caida" };
    if (r.estado === 401 || r.estado === 403) throw this.#porEstado(r, "Anulación");
    let j: Record<string, unknown> | null = null; try { j = JSON.parse(r.cuerpo); } catch { /* ilegible */ }
    if (!j) return r.estado >= 400 ? { tipo: "rechazado_confirmado", codigo: String(r.estado), mensaje: "Digifact rechazó la solicitud" } : { tipo: "desconocido", motivo: "respuesta_ilegible" };
    const codigo = num(j.Codigo ?? j.code);
    if (codigo === "1" && r.estado === 200) return { tipo: "anulado", autorizacion: num(j.Autorizacion).toUpperCase() || a.autorizacion.toUpperCase(), crudoSaneado: { Codigo: codigo, Mensaje: this.#limpio(num(j.Mensaje)) } };
    if (codigo === "") return { tipo: "desconocido", motivo: "codigo_no_mapeado" };
    return { tipo: "rechazado_confirmado", codigo, mensaje: this.#limpio(num(j.Mensaje ?? j.message)) || "Digifact rechazó la anulación" };
  }
  /** POST /cert/ncredtotal (nota de crédito TOTAL). Cerrada salvo habilitación explícita Y confirmación literal «NOTA-CREDITO-TOTAL». */
  async notaCreditoTotal(n: { autorizacion: string; fechaEmision: string; motivo: string; referenciaInterna?: string; formatos?: FormatoDte[]; confirmacion: string }): Promise<ResultadoCertificacionGt> {
    if (!this.c.permitirNotaCredito) throw new ErrorDigifact("no_permitido", "La nota de crédito no está habilitada");
    if (n.confirmacion !== "NOTA-CREDITO-TOTAL") throw new ErrorDigifact("no_permitido", "Falta la confirmación explícita (escribe NOTA-CREDITO-TOTAL)");
    if (!UUID.test(n.autorizacion)) throw new ErrorDigifact("solicitud", "La autorización debe ser un GUID de 36 caracteres");
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(n.fechaEmision)) throw new ErrorDigifact("solicitud", "La fecha debe ser AAAA-MM-DD hh:mm:ss");
    if (n.motivo.trim().length < 3 || n.motivo.length > 50) throw new ErrorDigifact("solicitud", "El motivo debe tener de 3 a 50 caracteres");
    if (n.referenciaInterna !== undefined && !/^[A-Za-z0-9._-]{1,60}$/.test(n.referenciaInterna)) throw new ErrorDigifact("solicitud", "Referencia interna no válida");
    await this.token();
    const formatos = (n.formatos ?? ["XML", "PDF"]).map((f) => f.toLowerCase()).join("|");
    let r: RespuestaHttp;
    try { r = await this.#llamar({ metodo: "POST", ruta: "/cert/ncredtotal", cuerpo: JSON.stringify({ Staxid: String(Number(this.c.nit)), Authnumber: n.autorizacion.toUpperCase(), FechaEmision: n.fechaEmision, MotivoAjuste: n.motivo.trim(), Formatos: formatos, Username: this.c.usuario, ...(n.referenciaInterna ? { ReferenciaInterna: n.referenciaInterna } : {}) }) }, true); }
    catch (e) { if (e instanceof ErrorDigifact) throw e; return { tipo: "desconocido", motivo: e instanceof Error && e.name === "TiempoAgotado" ? "timeout" : "corte" }; }
    return this.#leerCertificacion(r);
  }
}
