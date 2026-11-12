// SIMULADOR LOCAL de Digifact (D3). Un «servidor» en memoria detrás de un Transporte: sin red, sin credenciales reales, sin valor fiscal. Todo lo que produce lleva «SIMULADO - SIN VALOR FISCAL»
// y las autorizaciones llevan el prefijo «SIM-» (la base rechaza una autorización simulada fuera del ambiente simulado y viceversa).
// Reproduce lo difícil: que el servidor certifique aunque el cliente no vea la respuesta, rechazos, falta de saldo, token vencido, respuestas ilegibles, anulaciones y un registro de consumo
// del bolsón que la conciliación puede contrastar (incluidas diferencias inyectadas a propósito).
import type { PeticionHttp, RespuestaHttp, Transporte } from "./digifact.ts";
import { aBase64 } from "./digifact.ts";

export type EscenarioDigifact =
  | "exito" | "rechazo" | "sin_saldo" | "timeout_antes" | "timeout_despues" | "corte_despues" | "respuesta_ilegible"
  | "codigo_desconocido_certificado" | "codigo_desconocido_no_certificado" | "timeout_indeterminado" | "limite_tasa" | "caida";
export type EscenarioAnulacion = "exito" | "rechazo" | "timeout_antes" | "timeout_despues" | "indeterminado";
export interface CertificadoDigifact { referencia: string; documentoId: string; serie: string; numero: string; autorizacion: string; fecha: string; xml: Uint8Array; pdf: Uint8Array; anulado?: { fecha: string; motivo: string } }
export interface LineaConsumo { referencia: string; evento: "CERTIFICACION" | "ANULACION" | "AJENO"; unidades: string; fecha: string }
export class TiempoAgotado extends Error { constructor() { super("simulado: tiempo agotado"); this.name = "TiempoAgotado"; } }
export class CorteDeRed extends Error { constructor() { super("simulado: conexión cortada"); this.name = "CorteDeRed"; } }

const enc = new TextEncoder();
async function hex(t: string): Promise<string> { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(t) as unknown as BufferSource)), (b) => b.toString(16).padStart(2, "0")).join(""); }
function pdfSimulado(texto: string): Uint8Array {
  const c = `BT /F1 12 Tf 40 760 Td (${texto.replace(/[()\\]/g, "")}) Tj ET`;
  return enc.encode(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length ${c.length}>>stream\n${c}\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF`);
}
const ok = (o: unknown, estado = 200): RespuestaHttp => ({ estado, cuerpo: JSON.stringify(o) });

export interface OpcionesSimulador { usuario?: string; clave?: string; saldoInicial?: number; ahora?: () => Date; tokenVidaS?: number; escenarioPorDefecto?: EscenarioDigifact }

export class DigifactSimulador {
  readonly certificados: CertificadoDigifact[] = [];
  readonly consumos: LineaConsumo[] = [];
  /** Cada petición que llegó al «servidor» (ruta + referencia), para afirmar cuántas veces se llamó. */
  readonly llamadas: { ruta: string; referencia?: string }[] = [];
  saldo: number;
  private tokens = new Map<string, number>();
  private contador = 0;
  private escenarios: Record<string, EscenarioDigifact> = {};
  private escenariosAnulacion: Record<string, EscenarioAnulacion> = {};
  private indeterminados = new Set<string>();
  private ahora: () => Date;
  private falloLogin = false;
  constructor(private o: OpcionesSimulador = {}) { this.saldo = o.saldoInicial ?? 1000; this.ahora = o.ahora ?? (() => new Date()); }

  /** Transporte listo para inyectar en DigifactProvider. */
  readonly transporte: Transporte = (p) => this.manejar(p);

  fijarEscenario(documentoId: string, e: EscenarioDigifact) { this.escenarios[documentoId] = e; }
  escenarioDe(documentoId: string): EscenarioDigifact | null { return this.escenarios[documentoId] ?? null; }
  fijarEscenarioAnulacion(documentoId: string, e: EscenarioAnulacion) { this.escenariosAnulacion[documentoId] = e; }
  forzarFalloDeLogin(v: boolean) { this.falloLogin = v; }
  vencerTokens() { this.tokens.clear(); }
  /** Consumo que Digifact reporta y NEXA no conoce (para probar la conciliación). */
  inyectarConsumoAjeno(referencia: string, unidades = "1.000000", fecha = this.ahora().toISOString()) { this.consumos.push({ referencia, evento: "AJENO", unidades, fecha }); this.saldo -= Number(unidades); }
  /** Quita del reporte el consumo de una certificación (NEXA lo tiene y Digifact no lo informa). */
  omitirConsumo(referencia: string) { const i = this.consumos.findIndex((c) => c.referencia === referencia); if (i >= 0) this.consumos.splice(i, 1); }
  certificacionesDe(documentoId: string): number { return this.certificados.filter((c) => c.documentoId === documentoId).length; }
  porReferencia(r: string) { return this.certificados.find((c) => c.referencia === r); }

  private async certificar(ref: string, cuerpo: { datos_adicionales?: { documento_id?: string } }): Promise<CertificadoDigifact> {
    const previo = this.certificados.find((c) => c.referencia === ref); if (previo) return previo;   // idempotencia nativa por referencia
    this.contador++;
    const h = await hex(`${ref}|${this.contador}`);
    const serie = "SIMD", numero = String(this.contador).padStart(8, "0");
    const autorizacion = `SIM-${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`.toUpperCase();
    const fecha = this.ahora().toISOString();
    const xml = enc.encode(`<?xml version="1.0" encoding="UTF-8"?>\n<DTESimulado simulado="true" aviso="SIMULADO - SIN VALOR FISCAL" proveedor="digifact-simulador"><Serie>${serie}</Serie><Numero>${numero}</Numero><Autorizacion>${autorizacion}</Autorizacion><Fecha>${fecha}</Fecha></DTESimulado>`);
    const c: CertificadoDigifact = { referencia: ref, documentoId: cuerpo.datos_adicionales?.documento_id ?? "", serie, numero, autorizacion, fecha, xml, pdf: pdfSimulado(`SIMULADO - SIN VALOR FISCAL - ${serie}-${numero}`) };
    this.certificados.push(c);
    this.consumos.push({ referencia: autorizacion, evento: "CERTIFICACION", unidades: "1.000000", fecha }); this.saldo -= 1;
    return c;
  }
  private cert(c: CertificadoDigifact) { return { estado: "CERTIFICADO", serie: c.serie, numero: c.numero, autorizacion: c.autorizacion, fecha_certificacion: c.fecha, xml_b64: aBase64(c.xml), pdf_b64: aBase64(c.pdf) }; }

  async manejar(p: PeticionHttp): Promise<RespuestaHttp> {
    const url = new URL(p.ruta, "http://simulador.local");
    const ruta = url.pathname, q = url.searchParams;
    this.llamadas.push({ ruta, referencia: q.get("referencia") ?? undefined });
    if (ruta === "/api/salud") return ok({ ok: true, simulador: true });
    if (ruta === "/api/login") {
      const c = JSON.parse(p.cuerpo ?? "{}");
      if (this.falloLogin || c.usuario !== (this.o.usuario ?? "SIM-USUARIO") || c.clave !== (this.o.clave ?? "SIM-CLAVE")) return ok({ codigo: "CREDENCIALES" }, 401);
      const token = `SIMTOKEN-${(await hex(String(this.contador) + this.ahora().getTime() + this.tokens.size)).slice(0, 16)}`;
      const vida = this.o.tokenVidaS ?? 300; this.tokens.set(token, this.ahora().getTime() + vida * 1000);
      return ok({ token, expira_en_s: vida });
    }
    const auth = /^Bearer (.+)$/.exec(p.cabeceras.authorization ?? p.cabeceras.Authorization ?? "")?.[1];
    if (!auth || (this.tokens.get(auth) ?? 0) < this.ahora().getTime()) return ok({ codigo: "TOKEN_INVALIDO" }, 401);

    if (ruta === "/api/certificar") {
      const c = JSON.parse(p.cuerpo ?? "{}"); const ref = String(c.referencia), doc = String(c.datos_adicionales?.documento_id ?? "");
      const e = this.escenarios[doc] ?? this.o.escenarioPorDefecto ?? "exito";
      if (this.saldo < 1 && e === "exito" && !this.certificados.some((x) => x.referencia === ref)) return ok({ codigo: "SALDO_INSUFICIENTE" }, 402);
      switch (e) {
        case "exito": return ok(this.cert(await this.certificar(ref, c)));
        case "sin_saldo": return ok({ codigo: "SALDO_INSUFICIENTE" }, 402);
        case "rechazo": return ok({ estado: "RECHAZADO", codigo: "SIM-VAL-001", mensaje: "Rechazo simulado: el documento no cumple una validación del proveedor" }, 422);
        case "timeout_antes": throw new TiempoAgotado();
        case "timeout_despues": await this.certificar(ref, c); throw new TiempoAgotado();
        case "corte_despues": await this.certificar(ref, c); throw new CorteDeRed();
        case "respuesta_ilegible": await this.certificar(ref, c); return { estado: 200, cuerpo: "<<<no es JSON>>>" };
        case "codigo_desconocido_certificado": await this.certificar(ref, c); return ok({ estado: "ESTADO_NUEVO_DE_DIGIFACT" });
        case "codigo_desconocido_no_certificado": return ok({ estado: "ESTADO_NUEVO_DE_DIGIFACT" });
        case "timeout_indeterminado": this.indeterminados.add(ref); throw new TiempoAgotado();
        case "limite_tasa": return ok({ codigo: "LIMITE" }, 429);
        case "caida": return ok({ codigo: "NO_DISPONIBLE" }, 503);
      }
    }
    if (ruta === "/api/consultar") {
      const ref = q.get("referencia") ?? "";
      if (this.indeterminados.has(ref)) return ok({ estado: "EN_PROCESO" });
      const c = this.porReferencia(ref); if (c) return ok(this.cert(c));
      return ok({ codigo: "NO_EXISTE", procesamiento: "finalizado" }, 404);
    }
    if (ruta === "/api/documento") {
      const c = this.porReferencia(q.get("referencia") ?? ""); if (!c) return ok({ codigo: "NO_EXISTE" }, 404);
      return ok({ serie: c.serie, numero: c.numero, xml_b64: aBase64(c.xml), pdf_b64: aBase64(c.pdf) });
    }
    if (ruta === "/api/anular") {
      const c = JSON.parse(p.cuerpo ?? "{}"); const ref = String(c.referencia_certificacion), refAnu = String(c.referencia), doc = String(c.datos_adicionales?.documento_id ?? "");
      const cert = this.porReferencia(ref); if (!cert) return ok({ estado: "RECHAZADO", codigo: "NO_EXISTE_DTE", mensaje: "No existe el documento a anular" }, 422);
      const e = this.escenariosAnulacion[doc] ?? "exito";
      const aplicar = () => {
        if (!cert.anulado) { cert.anulado = { fecha: this.ahora().toISOString(), motivo: String(c.motivo ?? "") }; this.consumos.push({ referencia: `${cert.autorizacion}:ANULACION`, evento: "ANULACION", unidades: "1.000000", fecha: cert.anulado.fecha }); this.saldo -= 1; }
        this.anulacionesPorReferencia.set(refAnu, ref);
      };
      switch (e) {
        case "exito": aplicar(); return ok({ estado: "ANULADO", fecha_anulacion: cert.anulado!.fecha });
        case "rechazo": return ok({ estado: "RECHAZADO", codigo: "SIM-ANU-001", mensaje: "Rechazo simulado de la anulación" }, 422);
        case "timeout_antes": throw new TiempoAgotado();
        case "timeout_despues": aplicar(); throw new TiempoAgotado();
        case "indeterminado": this.indeterminados.add(`anu:${refAnu}`); throw new TiempoAgotado();
      }
    }
    if (ruta === "/api/consultar-anulacion") {
      const ref = q.get("referencia") ?? "";
      if (this.indeterminados.has(`anu:${ref}`)) return ok({ estado: "EN_PROCESO" });
      const cert = this.porReferencia(this.anulacionesPorReferencia.get(ref) ?? "");
      if (cert?.anulado) return ok({ estado: "ANULADO", fecha_anulacion: cert.anulado.fecha });
      return ok({ codigo: "NO_EXISTE", procesamiento: "finalizado" }, 404);
    }
    if (ruta === "/api/saldo") return ok({ unidades: this.saldo.toFixed(6) });
    if (ruta === "/api/consumos") {
      const d = q.get("desde") ?? "0000-01-01", h = q.get("hasta") ?? "9999-12-31";
      return ok({ lineas: this.consumos.filter((x) => x.fecha.slice(0, 10) >= d && x.fecha.slice(0, 10) <= h) });
    }
    return ok({ codigo: "RUTA_DESCONOCIDA" }, 404);
  }
  /** referencia de la OPERACIÓN de anulación → referencia de la certificación anulada (se llena al procesar /api/anular). */
  readonly anulacionesPorReferencia = new Map<string, string>();
}
