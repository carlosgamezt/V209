// Servicio de envío de facturas certificadas por correo (envío manual, reenvío y envío automático). Digifact NO interviene: solo certificó; aquí se usan los PDF/XML que ya están guardados.
// Reglas (todas se comprueban EN EL SERVIDOR; la pantalla solo las refleja):
//   · solo una factura CERTIFICADA (no borrador, pendiente, por verificar, rechazada, anulada ni con anulación solicitada) y con XML y PDF íntegros (hash comprobado);
//   · la factura se busca SIEMPRE por (id, empresa de la sesión): una persona de otra empresa recibe «no encontrado»;
//   · permiso `correos.enviar` (o `correos.reenviar` + confirmación escrita «REENVIAR» + un envío previo aceptado); el envío automático lo decide la configuración, no una persona;
//   · destinatarios: en TEST solo los autorizados por el servidor (lista cerrada); sin lista, nada sale;
//   · duplicados: la MISMA solicitud (misma clave) no envía dos veces —ni aquí ni en el proveedor, que recibe la misma clave de idempotencia— y un segundo envío al mismo destinatario exige el REENVÍO (la base lo garantiza con un índice único);
//   · límites de frecuencia por empresa y por persona, y tope de reenvíos por factura;
//   · el resultado se guarda ANTES y DESPUÉS de hablar con el proveedor; los adjuntos no se copian a ningún lado; la auditoría lleva el correo enmascarado, nunca el contenido ni claves.
import type { BdDemo } from "../bd.ts";
import { LimiteTasaPg } from "../limite_pg.ts";
import { plantillaFactura } from "./plantilla.ts";
import type { MensajeCorreo, ProveedorCorreo, ResultadoEnvio } from "./proveedor.ts";

type Obj = Record<string, unknown>;
export class ErrorCorreo extends Error { constructor(public status: number, public codigo: string, mensaje: string) { super(mensaje); } }

export const PALABRA_REENVIO = "REENVIAR";
export const RE_CORREO = /^[^\s@<>,;]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;
export const MAX_REENVIOS_POR_DOCUMENTO_DIA = 5;
export const LIMITE_EMPRESA_POR_MIN = 30, LIMITE_PERSONA_POR_MIN = 10;

export interface ConfigCorreo {
  /** «NEXA FEL <facturas@dominio-verificado>» (remitente en un dominio verificado en el proveedor). */
  remitente: string;
  /** ¿Puede recibir este destinatario? En TEST es una lista cerrada. Con el proveedor simulado no sale nada, así que se permite cualquiera. */
  destinatarioPermitido: (correo: string) => boolean;
  /** Envío automático tras certificar: apagado por defecto. */
  automatico: boolean;
  /** Solo para pruebas: otros topes por minuto. */
  limites?: { empresa: number; persona: number };
  /** Tope de envíos por empresa y por día (ventana fija de 24 h) que SÍ llegan al proveedor: freno de seguridad de la etapa de pruebas reales. Sin valor = sin tope (proveedor simulado). */
  topeDiario?: number;
}
export interface CtxCorreo { empresaId: string; actorId: string; permisos: string[] }
export interface PeticionEnvio {
  documentoId: string;
  /** Adjuntar también el XML fiscal (por defecto NO: solo el PDF). El XML se conserva siempre internamente, se adjunte o no. */
  adjuntarXml?: boolean;
  /** Si no se indica, se usa el correo guardado del receptor. */
  destinatario?: string;
  /** Clave de la solicitud (la genera la pantalla por cada intento deliberado; repetirla NO envía otra vez). */
  clave: string;
  reenvio?: boolean; confirmacion?: string;
  origen?: "manual" | "automatico";
}
export interface EnvioPublico { id: string; destinatario: string; origen: string; estado: string; proveedor: string; error_codigo: string | null; creado_en: string; resuelto_en: string | null }
export interface ResultadoServicio { envio: EnvioPublico; repetido: boolean }

const ESTADOS_NO_ENVIABLES: Record<string, string> = {
  ninguno: "La factura todavía no está certificada.", pendiente_certificacion: "La factura está pendiente de certificación.", por_verificar: "La certificación de la factura está por verificar.",
  rechazado: "La factura fue rechazada por el certificador.", anulado: "La factura está anulada: no se envía.", anulacion_solicitada: "La factura tiene una anulación solicitada: no se envía.",
};
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const aBytes = (v: unknown): Uint8Array<ArrayBuffer> => v instanceof Uint8Array ? new Uint8Array(v) : new Uint8Array(0);   // Buffer de postgres.js también es Uint8Array
export const enmascarar = (c: string) => { const [u, d] = c.split("@"); return `${(u ?? "").slice(0, 1)}***@${d ?? ""}`; };
const ISO = (v: unknown) => v instanceof Date ? v.toISOString() : v == null ? null : String(v);

/** «1234.5» → «Q 1,234.50» sin pasar por coma flotante. */
export function formatoQuetzales(valor: unknown, moneda = "GTQ"): string {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(valor ?? "0").trim()); if (!m) return String(valor ?? "");
  const ent = m[2].replace(/\B(?=(\d{3})+(?!\d))/g, ","), dec = ((m[3] ?? "") + "00").slice(0, 2);
  return `${moneda === "GTQ" ? "Q" : moneda} ${m[1]}${ent}.${dec}`;
}
const fechaCorta = (v: unknown) => { const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "").slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.split("-").reverse().join("/") : "—"; };

export class ServicioCorreo {
  readonly #limEmpresa: LimiteTasaPg; readonly #limPersona: LimiteTasaPg; readonly #limDia: LimiteTasaPg | null;
  constructor(private bd: BdDemo, private proveedor: ProveedorCorreo, private cfg: ConfigCorreo) {
    this.#limEmpresa = new LimiteTasaPg(bd, cfg.limites?.empresa ?? LIMITE_EMPRESA_POR_MIN, 60_000); this.#limPersona = new LimiteTasaPg(bd, cfg.limites?.persona ?? LIMITE_PERSONA_POR_MIN, 60_000);
    this.#limDia = cfg.topeDiario ? new LimiteTasaPg(bd, cfg.topeDiario, 86_400_000) : null;
  }
  get proveedorNombre() { return this.proveedor.nombre; }
  get automatico() { return this.cfg.automatico; }
  /** ¿Existe la tabla del historial? En un Supabase con solo las 28 migraciones no existe: el módulo queda no disponible, sin errores. */
  async disponible(): Promise<boolean> { const [r] = await this.bd.filas<{ t: string | null }>("select to_regclass('public.envios_correo')::text as t"); return !!r?.t; }

  async historial(ctx: CtxCorreo, documentoId: string): Promise<EnvioPublico[]> {
    if (!ctx.permisos.includes("correos.ver")) throw new ErrorCorreo(403, "no_autorizado", "No tienes permiso para ver los envíos por correo.");
    const filas = await this.bd.filas<Obj>("select id, destinatario, origen, estado, proveedor, error_codigo, creado_en, resuelto_en from public.envios_correo where empresa_id = $1 and documento_id = $2 order by creado_en desc, id limit 50", [ctx.empresaId, documentoId]);
    return filas.map((f) => ({ id: String(f.id), destinatario: String(f.destinatario), origen: String(f.origen), estado: String(f.estado), proveedor: String(f.proveedor), error_codigo: f.error_codigo ? String(f.error_codigo) : null, creado_en: ISO(f.creado_en)!, resuelto_en: ISO(f.resuelto_en) }));
  }

  async enviar(ctx: CtxCorreo, p: PeticionEnvio): Promise<ResultadoServicio> {
    const origen = p.origen ?? "manual", reenvio = !!p.reenvio;
    if (!(await this.disponible())) throw new ErrorCorreo(503, "correo_no_disponible", "El envío por correo no está disponible en esta base de datos.");
    // 1) permisos y confirmaciones (antes de tocar nada)
    if (origen === "manual") {
      if (!ctx.permisos.includes(reenvio ? "correos.reenviar" : "correos.enviar")) throw new ErrorCorreo(403, "no_autorizado", reenvio ? "No tienes permiso para reenviar facturas por correo." : "No tienes permiso para enviar facturas por correo.");
      if (reenvio && p.confirmacion !== PALABRA_REENVIO) throw new ErrorCorreo(400, "confirmacion_requerida", `Para reenviar escribe ${PALABRA_REENVIO}.`);
    }
    if (typeof p.clave !== "string" || p.clave.length < 8 || p.clave.length > 120 || !/^[A-Za-z0-9_.:-]+$/.test(p.clave)) throw new ErrorCorreo(400, "entrada_invalida", "Falta la clave de la solicitud.");
    // 2) límites de frecuencia (empresa y persona)
    const le = await this.#limEmpresa.permitir(`correo:e:${ctx.empresaId}`), lp = await this.#limPersona.permitir(`correo:p:${ctx.actorId}`);
    if (!le.ok || !lp.ok) throw new ErrorCorreo(429, "demasiados_envios", `Demasiados envíos seguidos. Intenta de nuevo en ${Math.max(le.reintentarEnS, lp.reintentarEnS)} s.`);
    // 3) la factura, SIEMPRE de la empresa de la sesión
    const [d] = await this.bd.filas<Obj>(`select d.id, d.estado_fiscal, d.serie, d.numero_fiscal, d.autorizacion_sat, d.fecha_emision_prevista::text as fecha_emision_prevista, coalesce(d.total, d.base_imponible)::text as total, d.moneda,
        c.nombre as cliente_nombre, c.email as cliente_email, e.nombre_comercial, e.razon_social
      from public.documentos d join public.empresas e on e.id = d.empresa_id left join public.clientes c on c.id = d.cliente_id and c.empresa_id = d.empresa_id where d.id = $1 and d.empresa_id = $2`, [p.documentoId, ctx.empresaId]);
    if (!d) throw new ErrorCorreo(404, "no_encontrado", "Documento no encontrado.");
    if (d.estado_fiscal !== "certificado") throw new ErrorCorreo(409, "no_certificada", ESTADOS_NO_ENVIABLES[String(d.estado_fiscal)] ?? "La factura no está certificada.");
    const [op] = await this.bd.filas<{ id: string }>("select id from public.operaciones_fiscales where documento_id = $1 and empresa_id = $2 and tipo = 'certificacion' and estado = 'confirmada_exitosa' order by iniciada_en desc limit 1", [p.documentoId, ctx.empresaId]);
    if (!op) throw new ErrorCorreo(409, "sin_certificacion", "La factura no tiene una certificación confirmada.");
    // 3b) si Digifact ya recibió la orden de enviar el correo de esta factura al certificar, NEXA NO envía otro (evita el duplicado entre los dos caminos)
    const [dg] = await this.bd.filas<{ n: number }>("select count(*)::int as n from public.auditoria where empresa_id = $1 and entidad = 'documento' and entidad_id = $2 and accion = 'digifact_test.correo_solicitado'", [ctx.empresaId, p.documentoId]);
    if (dg?.n) throw new ErrorCorreo(409, "lo_envia_digifact", "Digifact ya recibió la orden de enviar esta factura por correo al certificarla: no se envía otra vez desde NEXA.");
    // 4) destinatario
    const destinatario = String(p.destinatario ?? d.cliente_email ?? "").trim();
    if (!destinatario) throw new ErrorCorreo(400, "sin_correo", "El receptor no tiene correo electrónico: escribe uno para enviar la factura.");
    if (!RE_CORREO.test(destinatario) || destinatario.length > 254) throw new ErrorCorreo(400, "correo_invalido", "El correo electrónico no es válido.");
    if (!this.cfg.destinatarioPermitido(destinatario.toLowerCase())) throw new ErrorCorreo(403, "destinatario_no_autorizado", "En el ambiente de pruebas solo se puede enviar a los correos autorizados.");
    // 5) solicitud repetida (misma clave): no se envía otra vez
    let [previa] = await this.bd.filas<Obj>("select id, destinatario, origen, estado, proveedor, error_codigo, creado_en, resuelto_en, documento_id, clave_idempotencia from public.envios_correo where empresa_id = $1 and clave_idempotencia = $2", [ctx.empresaId, p.clave]);
    if (previa && (previa.documento_id !== p.documentoId || String(previa.destinatario).toLowerCase() !== destinatario.toLowerCase())) throw new ErrorCorreo(409, "clave_en_uso", "Esa clave ya se usó para otro envío.");
    if (previa && previa.estado !== "fallido") return { envio: this.#publico(previa), repetido: true };
    // un envío FALLIDO (resultado incierto: pudo haber salido) al mismo destinatario se RETOMA con su propia clave aunque la pantalla genere otra (p. ej. tras recargar): el proveedor deduplica por esa clave
    if (!previa) { [previa] = await this.bd.filas<Obj>("select id, destinatario, origen, estado, proveedor, error_codigo, creado_en, resuelto_en, documento_id, clave_idempotencia from public.envios_correo where empresa_id = $1 and documento_id = $2 and lower(destinatario) = lower($3) and estado = 'fallido' and (origen = 'reenvio') = $4 order by creado_en desc limit 1", [ctx.empresaId, p.documentoId, destinatario, reenvio]); }
    // 6) reenvío: exige un envío previo aceptado y tiene tope diario por factura
    if (reenvio) {
      const [{ n: ok }] = await this.bd.filas<{ n: number }>("select count(*)::int as n from public.envios_correo where empresa_id = $1 and documento_id = $2 and estado in ('aceptado','entregado')", [ctx.empresaId, p.documentoId]);
      if (!ok) throw new ErrorCorreo(409, "sin_envio_previo", "Esta factura todavía no se ha enviado: usa «Enviar por correo».");
      const [{ n: hoy }] = await this.bd.filas<{ n: number }>("select count(*)::int as n from public.envios_correo where empresa_id = $1 and documento_id = $2 and origen = 'reenvio' and creado_en > now() - interval '24 hours'", [ctx.empresaId, p.documentoId]);
      if (hoy >= MAX_REENVIOS_POR_DOCUMENTO_DIA) throw new ErrorCorreo(429, "limite_reenvios", `Se alcanzó el máximo de ${MAX_REENVIOS_POR_DOCUMENTO_DIA} reenvíos por factura en 24 horas.`);
    }
    // 7) adjuntos: el XML y el PDF de ESA certificación, íntegros
    const arts = await this.bd.filas<Obj>("select tipo, nombre, mime, sha256, contenido from public.artefactos_documento where documento_id = $1 and empresa_id = $2 and operacion_id = $3", [p.documentoId, ctx.empresaId, op.id]);
    const xml = arts.find((a) => a.tipo === "xml"), pdf = arts.find((a) => a.tipo === "pdf");
    const conXml = p.adjuntarXml === true;   // por defecto solo el PDF; con el interruptor, PDF + XML
    if (!pdf || (conXml && !xml)) throw new ErrorCorreo(409, "sin_adjuntos", conXml ? "La factura no tiene el XML y el PDF certificados guardados." : "La factura no tiene el PDF certificado guardado.");
    const adjuntos = [];
    for (const a of conXml ? [pdf, xml!] : [pdf]) {
      const bytes = aBytes(a.contenido); if (!bytes.length || hex(await crypto.subtle.digest("SHA-256", bytes)) !== a.sha256) throw new ErrorCorreo(409, "adjunto_alterado", "Un archivo certificado no coincide con su huella: no se envía.");
      adjuntos.push({ nombre: String(a.nombre), mime: String(a.mime), contenido: bytes });
    }
    // 7b) tope diario de la etapa de pruebas reales: cuenta solo lo que llegaría al proveedor (ya validado todo lo anterior)
    if (this.#limDia) { const d = await this.#limDia.permitir(`correo:d:${ctx.empresaId}`); if (!d.ok) throw new ErrorCorreo(429, "tope_diario", `Se alcanzó el tope diario de envíos de prueba (${this.cfg.topeDiario}). Se reinicia en unas horas.`); }
    // 8) se registra la solicitud ANTES de hablar con el proveedor (o se retoma el intento fallido de la misma clave)
    let envioId: string;
    if (previa) {   // misma clave y estado «fallido»: reintento SEGURO, el proveedor deduplica por la clave
      await this.bd.ejecutar("update public.envios_correo set estado = 'solicitado', error_codigo = null, resuelto_en = null where id = $1 and empresa_id = $2", [previa.id, ctx.empresaId]); envioId = String(previa.id);
    } else {
      const ins = await this.bd.filas<{ id: string }>(`insert into public.envios_correo (empresa_id, documento_id, operacion_id, destinatario, origen, proveedor, clave_idempotencia, solicitado_por)
        values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict do nothing returning id`, [ctx.empresaId, p.documentoId, op.id, destinatario, reenvio ? "reenvio" : origen, this.proveedor.nombre, p.clave, origen === "automatico" ? null : ctx.actorId]);
      if (!ins[0]) {   // otra solicitud del mismo documento y destinatario ya está en curso o aceptada (o la misma clave llegó a la vez)
        const [igual] = await this.bd.filas<Obj>("select id, destinatario, origen, estado, proveedor, error_codigo, creado_en, resuelto_en from public.envios_correo where empresa_id = $1 and clave_idempotencia = $2", [ctx.empresaId, p.clave]);
        if (igual) return { envio: this.#publico(igual), repetido: true };
        throw new ErrorCorreo(409, "ya_enviado", "Esta factura ya se envió a ese correo. Si quieres enviarla otra vez, usa «Reenviar».");
      }
      envioId = ins[0].id;
    }
    // 9) el correo
    const datos = { emisor: String(d.nombre_comercial || d.razon_social || ""), receptor: String(d.cliente_nombre ?? ""), serie: String(d.serie ?? ""), numero: String(d.numero_fiscal ?? ""), fecha: fechaCorta(d.fecha_emision_prevista),
      total: formatoQuetzales(d.total, String(d.moneda ?? "GTQ")), autorizacion: d.autorizacion_sat ? String(d.autorizacion_sat) : undefined, prueba: true, adjuntos: adjuntos.map((a) => a.nombre) };
    const r = plantillaFactura(datos);
    const msg: MensajeCorreo = { de: this.cfg.remitente, para: destinatario, asunto: r.asunto, html: r.html, texto: r.texto, adjuntos, clave: `${ctx.empresaId}:${String(previa?.clave_idempotencia ?? p.clave)}`, etiquetas: { app: "nexa-fel", origen: reenvio ? "reenvio" : origen } };
    let res: ResultadoEnvio; try { res = await this.proveedor.enviar(msg); } catch { res = { estado: "fallido", codigo: "error_interno" }; }
    // 10) resultado y auditoría (sin contenido ni claves)
    await this.bd.ejecutar("update public.envios_correo set estado = $3, proveedor_mensaje_id = $4, error_codigo = $5, resuelto_en = now() where id = $1 and empresa_id = $2",
      [envioId, ctx.empresaId, res.estado, res.estado === "aceptado" ? res.mensajeId : null, res.estado === "aceptado" ? null : res.codigo]);
    try { await this.bd.rpc("fel_auditar", { p_empresa: ctx.empresaId, p_actor: ctx.actorId, p_accion: `correo.${res.estado}`, p_entidad: "documento", p_entidad_id: p.documentoId, p_origen: "fel-correo", p_datos: JSON.stringify({ envio: envioId, origen: reenvio ? "reenvio" : origen, proveedor: this.proveedor.nombre, destinatario: enmascarar(destinatario), ...(res.estado === "aceptado" ? {} : { codigo: res.codigo }) }) }); } catch { /* la auditoría no debe ocultar el resultado del envío */ }
    const [fin] = await this.bd.filas<Obj>("select id, destinatario, origen, estado, proveedor, error_codigo, creado_en, resuelto_en from public.envios_correo where id = $1 and empresa_id = $2", [envioId, ctx.empresaId]);
    return { envio: this.#publico(fin), repetido: false };
  }

  #publico(f: Obj): EnvioPublico { return { id: String(f.id), destinatario: String(f.destinatario), origen: String(f.origen), estado: String(f.estado), proveedor: String(f.proveedor), error_codigo: f.error_codigo ? String(f.error_codigo) : null, creado_en: ISO(f.creado_en)!, resuelto_en: ISO(f.resuelto_en) }; }
}
