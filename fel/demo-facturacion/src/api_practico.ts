// Funciones de la versión PRÁCTICA de la demostración: inicio de sesión, Digifact SIMULADO (certificar con cobertura, consultar, anular),
// plan / saldo / consumo de la empresa y panel de la PLATAFORMA (empresas, planes, contratos, pagos simulados y bolsón global).
// Todo usa las MISMAS funciones SQL y servicios que las pruebas. Nada sale de este equipo: «SIMULADO - SIN VALOR FISCAL».
import { DigifactProvider } from "../../proveedores/src/digifact.ts";
import { DigifactSimulador, type EscenarioAnulacion, type EscenarioDigifact } from "../../proveedores/src/digifact_simulador.ts";
import { ServicioDigifact } from "../../proveedores/src/servicio_digifact.ts";
import { ErrorBd } from "../../proveedores/src/rpc.ts";
import type { MockProvider } from "../../proveedores/src/mock.ts";
import type { BdDemo } from "./bd.ts";
import { PERSONAS, EXTRA, esMaestro } from "./mundo_practico.ts";
import { Sesiones } from "./sesiones.ts";

export class ErrorPr extends Error { constructor(public status: number, mensaje: string, public codigo = "error") { super(mensaje); } }
type Obj = Record<string, unknown>;
const uuidOk = (x: unknown): x is string => typeof x === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
const RE_MONTO = /^\d{1,12}(\.\d{1,6})?$/;
const texto = (x: unknown, min: number, max: number, campo: string): string => { if (typeof x !== "string" || x.trim().length < min || x.length > max) throw new ErrorPr(400, `${campo}: texto de ${min} a ${max} caracteres`, "entrada_invalida"); return x.trim(); };
const monto = (x: unknown, campo: string): string => { if (typeof x !== "string" || !RE_MONTO.test(x)) throw new ErrorPr(400, `${campo}: número con hasta 6 decimales`, "entrada_invalida"); return x; };

export const ESCENARIOS_DIGIFACT: { id: EscenarioDigifact; nombre: string; explicacion: string }[] = [
  { id: "exito", nombre: "Éxito", explicacion: "Digifact (simulado) certifica y responde bien." },
  { id: "rechazo", nombre: "Rechazo confirmado", explicacion: "Digifact garantiza que NO hay documento: se puede corregir. No se cobra al cliente." },
  { id: "sin_saldo", nombre: "Bolsón agotado en Digifact", explicacion: "El proveedor rechaza por falta de saldo en su lado." },
  { id: "timeout_antes", nombre: "Tiempo agotado · no procesó", explicacion: "Sin respuesta y nada se certificó. Queda «por verificar»; la reserva sigue retenida." },
  { id: "timeout_despues", nombre: "Tiempo agotado · sí certificó", explicacion: "Sin respuesta pero certificó. Al conciliar se confirma y se cobra." },
  { id: "corte_despues", nombre: "Conexión cortada tras certificar", explicacion: "La respuesta se perdió aunque Digifact certificó." },
  { id: "respuesta_ilegible", nombre: "Respuesta ilegible", explicacion: "Certificó pero la respuesta no se entiende; nunca se toma por éxito." },
  { id: "timeout_indeterminado", nombre: "Sin forma de saberlo", explicacion: "Ni consultando se puede decidir: exige conciliación manual." },
  { id: "caida", nombre: "Servicio caído", explicacion: "No es un rechazo garantizado." },
];
export const ESCENARIOS_ANULACION: { id: EscenarioAnulacion; nombre: string }[] = [
  { id: "exito", nombre: "Anulación aceptada" }, { id: "rechazo", nombre: "Anulación rechazada" }, { id: "timeout_antes", nombre: "Tiempo agotado · no procesó" },
  { id: "timeout_despues", nombre: "Tiempo agotado · sí anuló" }, { id: "indeterminado", nombre: "Sin forma de saberlo" },
];
const ESC_D = new Set(ESCENARIOS_DIGIFACT.map((e) => e.id)), ESC_A = new Set(ESCENARIOS_ANULACION.map((e) => e.id));

interface Deps { mock: MockProvider; emp: () => string; sesiones?: Sesiones }
interface CtxEmpresa { req: Request; url: URL; a: { clave: string; id: string }; ruta: string; m: string; cuerpo: () => Promise<Obj>; id: (x: string) => string;
  json: (x: unknown, s?: number) => Response; canalDe: (p: string) => Promise<string>; detalle: (id: string) => Promise<unknown>; permisos: () => Promise<string[]> }

export function crearPractico(bd: BdDemo, d: Deps) {
  const sim = new DigifactSimulador({ saldoInicial: 5000 });
  const proveedor = new DigifactProvider(sim.transporte, { usuario: "SIM-USUARIO", clave: "SIM-CLAVE" });
  const servicio = new ServicioDigifact(bd.rpc, proveedor);
  const CTX = { ambiente: "simulado" as const, ahora: () => new Date() };
  const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  const leer = async (req: Request): Promise<Obj> => {
    if (req.headers.get("x-demo") !== "1") throw new ErrorPr(403, "Falta la cabecera de la demostración", "no_autorizado");
    const t = await req.text(); if (t.length > 262144) throw new ErrorPr(413, "Cuerpo demasiado grande", "entrada_invalida");
    try { const j = t ? JSON.parse(t) : {}; if (j === null || typeof j !== "object" || Array.isArray(j)) throw 0; return j as Obj; } catch { throw new ErrorPr(400, "Cuerpo no válido", "entrada_invalida"); }
  };
  const seguro = (req: Request) => new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";

  /** Aplica a consumos y cargos el resultado confirmado de las operaciones de Digifact (p. ej. tras conciliar). Seguro de repetir. */
  async function sincronizar() {
    const pend = await bd.filas<{ id: string; empresa_id: string }>("select o.id, o.empresa_id from public.operaciones_fiscales o join public.consumos c on c.operacion_id = o.id and c.empresa_id = o.empresa_id where c.estado = 'reservado' and o.estado in ('confirmada_exitosa','confirmada_fallida') and o.proveedor = 'digifact'");
    for (const p of pend) await servicio.cerrarCobertura(p.empresa_id, p.id);
  }

  async function certOp(docId: string, empresa: string) {
    const [o] = await bd.filas<{ clave_idempotencia: string }>("select clave_idempotencia from public.operaciones_fiscales where documento_id = $1 and empresa_id = $2 and tipo = 'certificacion' and estado = 'confirmada_exitosa' and proveedor = 'digifact' and ambiente = 'simulado' order by iniciada_en desc limit 1", [docId, empresa]);
    const [doc] = await bd.filas<{ autorizacion_sat: string | null }>("select autorizacion_sat from public.documentos where id = $1 and empresa_id = $2", [docId, empresa]);
    return o && doc?.autorizacion_sat ? { clave: o.clave_idempotencia, autorizacion: doc.autorizacion_sat } : null;
  }

  async function planDe(empresa: string) {
    const [cuenta] = await bd.filas<Obj>("select id, estado, cupo_mensual_unidades::text as cupo from public.cuentas_comerciales where empresa_id = $1", [empresa]);
    const contratos = await bd.filas<Obj>(`select ct.id, ct.desde, ct.hasta, pv.id as version_id, pv.version, pl.codigo, pl.nombre, pl.modalidad, pv.cuota_fija::text as cuota_fija, pv.unidades_incluidas::text as unidades_incluidas, pv.permite_sobregiro, pv.limite_sobregiro::text as limite_sobregiro
      from public.contratos_plan ct join public.plan_versiones pv on pv.id = ct.plan_version_id join public.planes pl on pl.codigo = pv.plan_codigo where ct.empresa_id = $1 order by ct.desde desc`, [empresa]);
    const vigente = contratos.find((c) => !c.hasta) ?? contratos[0] ?? null;
    const tarifas = vigente ? await bd.filas<Obj>("select evento_tipo, precio_unitario::text as precio_unitario, cargable from public.tarifas where plan_version_id = $1 order by evento_tipo", [vigente.version_id]) : [];
    const [mon] = await bd.filas<Obj>("select recargado::text, consumido::text, reservado::text, reembolsado::text, ajustado::text, sobregiro::text, (recargado + ajustado - consumido - reservado - reembolsado + sobregiro)::text as disponible from public.monedero_saldos where empresa_id = $1", [empresa]);
    const pagos = await bd.filas<Obj>("select id, monto::text as monto, referencia_pago, estado, confirmado_en from public.pagos where empresa_id = $1 order by confirmado_en desc limit 30", [empresa]);
    const consumos = await bd.filas<Obj>(`select c.id, c.evento_tipo, c.estado, c.unidades_reservadas::text as unidades_reservadas, c.unidades_consumidas::text as unidades_consumidas, c.reservado_en, c.resuelto_en, c.documento_id,
        d.numero_borrador, (select coalesce(sum(g.monto), 0)::text from public.cargos g where g.consumo_id = c.id) as cargado
      from public.consumos c left join public.documentos d on d.id = c.documento_id and d.empresa_id = c.empresa_id where c.empresa_id = $1 order by c.reservado_en desc limit 50`, [empresa]);
    const cargos = await bd.filas<Obj>("select id, concepto, naturaleza, cantidad::text as cantidad, precio_unitario::text as precio_unitario, monto::text as monto, periodo, estado, creado_en from public.cargos where empresa_id = $1 order by creado_en desc limit 50", [empresa]);
    const cobros = await bd.filas<Obj>("select id, tipo, periodo, monto_neto::text as monto_neto, referencia_documento, monto_total_documento::text as monto_total_documento, estado from public.cobros where empresa_id = $1 order by periodo desc", [empresa]);
    const [res] = await bd.filas<Obj>("select count(*) filter (where estado = 'confirmado' and evento_tipo = 'certificacion')::int as certificaciones, count(*) filter (where estado = 'reservado')::int as reservadas, coalesce(sum(unidades_consumidas) filter (where estado = 'confirmado'), 0)::text as unidades from public.consumos where empresa_id = $1", [empresa]);
    return { cuenta: cuenta ?? null, contrato: vigente, contratos, tarifas, monedero: mon ?? null, pagos, consumos, cargos, cobros, resumen: res, aviso: "Pagos y cobros SIMULADOS: no hay pasarela de pago. NEXA no calcula impuestos de sus propias facturas: guarda la referencia del documento emitido fuera de este sistema." };
  }

  return {
    sim, proveedor, servicio, sincronizar,
    async estadoExtra() { return { escenariosDigifact: ESCENARIOS_DIGIFACT, escenariosAnulacion: ESCENARIOS_ANULACION, canales: (await bd.filas<{ proveedor_id: string }>("select proveedor_id from public.empresa_canales where empresa_id = $1 and ambiente = 'simulado' and habilitado", [d.emp()])).map((c) => c.proveedor_id) }; },
    async detalleExtra(docId: string) {
      const cobertura = await bd.filas<Obj>(`select c.id, c.evento_tipo, c.estado, c.unidades_reservadas::text as reservadas, c.unidades_consumidas::text as consumidas, c.operacion_id,
          (select coalesce(sum(g.monto), 0)::text from public.cargos g where g.consumo_id = c.id) as cargado from public.consumos c where c.documento_id = $1 and c.empresa_id = $2 order by c.reservado_en`, [docId, d.emp()]);
      return { cobertura, escenarioDigifact: sim.escenarioDe(docId), anulable: !!(await certOp(docId, d.emp())) };
    },
    async certificar(a: { id: string }, docId: string, b: Obj, canal: string) {
      const esc = typeof b.escenario === "string" ? b.escenario : "exito"; if (!ESC_D.has(esc as EscenarioDigifact)) throw new ErrorPr(400, "Escenario no válido", "entrada_invalida");
      const clave = texto(b.clave, 16, 80, "Clave de idempotencia");
      sim.fijarEscenario(docId, esc as EscenarioDigifact);
      return await servicio.certificar({ actor: a.id, empresa: d.emp(), documento: docId, clave, canal });
    },

    // ---------------------------------------------------------------- sesión (no requiere sesión previa)
    async rutasSesion(req: Request, url: URL): Promise<Response | null> {
      const S = d.sesiones; if (!S || !url.pathname.startsWith("/api/sesion")) return null;
      if (req.method === "GET" && url.pathname === "/api/sesion") {
        const s = S.validar(Sesiones.idDeCookie(req));
        return json(s ? { autenticado: true, usuario: s.usuario, nombre: PERSONAS[s.usuario].nombre } : { autenticado: false, usuarios: Object.entries(PERSONAS).map(([k, u]) => ({ clave: k, nombre: u.nombre, rol: u.rol, descripcion: u.descripcion })), clave_demo: S.claveDemoPublica });
      }
      if (req.method === "POST" && url.pathname === "/api/sesion/entrar") {
        const b = await leer(req); const usuario = String(b.usuario ?? "").toLowerCase().trim();
        const r = await S.entrar(usuario in PERSONAS ? usuario : "-", String(b.clave ?? ""), b.recordar === true);
        if (r.bloqueado) return json({ codigo: "bloqueado", mensaje: "Demasiados intentos. Espera un minuto e inténtalo de nuevo." }, 429);
        if (!r.sesion) return json({ codigo: "credenciales", mensaje: "Usuario o contraseña incorrectos." }, 401);
        return new Response(JSON.stringify({ autenticado: true, usuario: r.sesion.usuario, nombre: PERSONAS[r.sesion.usuario].nombre }), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "set-cookie": Sesiones.cookie(r.sesion, seguro(req)) } });
      }
      if (req.method === "POST" && url.pathname === "/api/sesion/salir") {
        await leer(req); S.salir(Sesiones.idDeCookie(req));
        return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "set-cookie": Sesiones.cookie(null, seguro(req)) } });
      }
      throw new ErrorPr(404, "Ruta no encontrada", "no_encontrado");
    },

    // ---------------------------------------------------------------- rutas de una empresa
    async rutasEmpresa(c: CtxEmpresa): Promise<Response | null> {
      const { m, ruta, a } = c; let r: RegExpExecArray | null; const E = d.emp();
      if (m === "GET" && ruta === "/api/plan") {
        if (!(await c.permisos()).includes("facturacion.ver")) throw new ErrorPr(403, "No tienes permiso para ver el plan y el consumo", "no_autorizado");
        return c.json(await planDe(E));
      }
      if (m === "GET" && (r = /^\/api\/documentos\/([^/]+)\/consultar-proveedor$/.exec(ruta))) {   // solo lectura: pregunta a Digifact (simulado) y NO cambia nada
        const docId = c.id(r[1]); const [o] = await bd.filas<{ id: string; clave_idempotencia: string; estado: string }>("select id, clave_idempotencia, estado from public.operaciones_fiscales where documento_id = $1 and empresa_id = $2 and tipo = 'certificacion' and proveedor = 'digifact' order by iniciada_en desc limit 1", [docId, E]);
        if (!o) throw new ErrorPr(404, "Este documento no se envió a Digifact", "no_encontrado");
        const x = await proveedor.conciliar({ empresaId: E, documentoId: docId, operacionId: o.id, claveIdempotencia: o.clave_idempotencia, ambiente: "simulado" }, CTX);
        return c.json({ operacion_estado: o.estado, respuesta_del_proveedor: x.tipo === "certificado" ? { tipo: x.tipo, serie: x.serie, numero: x.numero, autorizacion: x.autorizacion } : x, nota: "Consulta de solo lectura al proveedor simulado; no modifica el documento." });
      }
      if (m === "POST" && (r = /^\/api\/documentos\/([^/]+)\/anular$/.exec(ruta))) {
        const b = await c.cuerpo(), docId = c.id(r[1]); const cert = await certOp(docId, E);
        if (!cert) throw new ErrorPr(422, "Solo se anula un documento certificado con Digifact simulado", "regla");
        const esc = typeof b.escenario === "string" ? b.escenario : "exito"; if (!ESC_A.has(esc as EscenarioAnulacion)) throw new ErrorPr(400, "Escenario de anulación no válido", "entrada_invalida");
        sim.fijarEscenarioAnulacion(docId, esc as EscenarioAnulacion);
        await servicio.anular({ actor: a.id, empresa: E, documento: docId, clave: texto(b.clave, 16, 80, "Clave de idempotencia"), motivo: texto(b.motivo, 5, 300, "Motivo"), canal: await c.canalDe("digifact"), certificacion: cert });
        return c.json(await c.detalle(docId));
      }
      if (m === "POST" && (r = /^\/api\/operaciones\/([^/]+)\/conciliar-anulacion$/.exec(ruta))) {
        if (!(await c.permisos()).includes("fiscal.conciliar")) throw new ErrorPr(403, "No tienes permiso para conciliar", "no_autorizado");
        const opId = c.id(r[1]); const [o] = await bd.filas<{ documento_id: string; clave_idempotencia: string; motivo: string | null }>("select documento_id, clave_idempotencia, motivo from public.operaciones_fiscales where id = $1 and empresa_id = $2 and tipo = 'anulacion'", [opId, E]);
        if (!o) throw new ErrorPr(404, "Anulación no encontrada", "no_encontrado"); const cert = await certOp(o.documento_id, E);
        if (!cert) throw new ErrorPr(422, "No se encontró la certificación de este documento", "regla");
        await servicio.conciliarAnulacion({ empresa: E, operacion: opId, documento: o.documento_id, clave: o.clave_idempotencia, certificacion: cert, motivo: o.motivo ?? "conciliación" });
        return c.json(await c.detalle(o.documento_id));
      }
      return null;
    },

    // ---------------------------------------------------------------- administrador de la plataforma
    async rutasMaestro(req: Request, url: URL, a: { clave: string; id: string }): Promise<Response> {
      const ruta = url.pathname, m = req.method; let r: RegExpExecArray | null; const M = a.id;
      if (m === "GET" && ruta === "/api/estado") return json({ usuario: { clave: a.clave, ...PERSONAS[a.clave] }, esMaestro: true, login: true, practico: true, permisos: [], aviso: "SIMULADO - SIN VALOR FISCAL" });
      if (m === "GET" && ruta === "/api/plataforma/resumen") {
        const empresas = await bd.filas<Obj>(`select e.id, e.nombre_comercial, e.razon_social, e.nit, e.estado,
            (select pl.nombre from public.contratos_plan ct join public.plan_versiones pv on pv.id = ct.plan_version_id join public.planes pl on pl.codigo = pv.plan_codigo where ct.empresa_id = e.id and ct.hasta is null limit 1) as plan,
            (select pl.modalidad from public.contratos_plan ct join public.plan_versiones pv on pv.id = ct.plan_version_id join public.planes pl on pl.codigo = pv.plan_codigo where ct.empresa_id = e.id and ct.hasta is null limit 1) as modalidad,
            (select (s.recargado + s.ajustado - s.consumido - s.reservado - s.reembolsado + s.sobregiro)::text from public.monedero_saldos s where s.empresa_id = e.id) as disponible,
            (select count(*)::int from public.consumos c where c.empresa_id = e.id and c.estado = 'confirmado' and c.evento_tipo = 'certificacion') as certificaciones,
            (select coalesce(sum(c.unidades_consumidas), 0)::text from public.consumos c where c.empresa_id = e.id and c.estado = 'confirmado') as unidades,
            (select coalesce(sum(g.monto), 0)::text from public.cargos g where g.empresa_id = e.id and g.estado = 'pendiente') as pendiente
          from public.empresas e order by e.nombre_comercial`);
        return json({ empresas, verificacion: await this.verificacion() });
      }
      if (m === "GET" && ruta === "/api/plataforma/planes") {
        const planes = await bd.filas<Obj>("select codigo, nombre, modalidad, activo from public.planes order by codigo");
        const versiones = await bd.filas<Obj>("select pv.id, pv.plan_codigo, pv.version, pv.vigente_desde, pv.cuota_fija::text as cuota_fija, pv.unidades_incluidas::text as unidades_incluidas, pv.permite_sobregiro, pv.limite_sobregiro::text as limite_sobregiro, (select json_agg(json_build_object('evento', t.evento_tipo, 'precio', t.precio_unitario::text, 'cargable', t.cargable) order by t.evento_tipo) from public.tarifas t where t.plan_version_id = pv.id) as tarifas from public.plan_versiones pv order by pv.plan_codigo, pv.version desc");
        return json({ planes, versiones, eventos: await bd.filas("select codigo from public.evento_tipos order by codigo") });
      }
      if (m === "POST" && ruta === "/api/plataforma/planes") {
        const b = await leer(req); const mod = String(b.modalidad); if (!["prepago", "consumo_mensual", "suscripcion"].includes(mod)) throw new ErrorPr(400, "Modalidad no válida", "entrada_invalida");
        await bd.rpc("fel_admin_plan_crear", { p_actor: M, p_codigo: texto(b.codigo, 3, 40, "Código"), p_nombre: texto(b.nombre, 3, 80, "Nombre"), p_modalidad: mod }); return json({ ok: true });
      }
      if (m === "POST" && (r = /^\/api\/plataforma\/planes\/([a-z][a-z0-9_]{2,39})\/versiones$/.exec(ruta))) {
        const b = await leer(req); const tarifas = Array.isArray(b.tarifas) ? b.tarifas : []; if (tarifas.length < 1) throw new ErrorPr(400, "Indica al menos una tarifa", "entrada_invalida");
        const t = tarifas.map((x) => { const o = x as Obj; return { evento: texto(o.evento, 1, 40, "Evento"), precio: monto(String(o.precio ?? "0"), "Precio"), cargable: o.cargable === true }; });
        const v = await bd.rpc("fel_admin_plan_version_crear", { p_actor: M, p_plan: r[1], p_desde: typeof b.desde === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.desde) ? b.desde : new Date().toISOString().slice(0, 10), p_cuota_fija: monto(String(b.cuota_fija ?? "0"), "Cuota fija"),
          p_unidades_incluidas: monto(String(b.unidades_incluidas ?? "0"), "Unidades incluidas"), p_permite_sobregiro: b.permite_sobregiro === true, p_limite_sobregiro: monto(String(b.limite_sobregiro ?? "0"), "Límite de sobregiro"), p_tarifas: t });
        return json(v);
      }
      if (m === "POST" && ruta === "/api/plataforma/contratos") {
        const b = await leer(req); if (!uuidOk(b.empresa) || !uuidOk(b.plan_version)) throw new ErrorPr(400, "Empresa o versión de plan no válidas", "entrada_invalida");
        await bd.rpc("fel_admin_contrato_asignar", { p_actor: M, p_empresa: b.empresa, p_plan_version: b.plan_version, p_desde: typeof b.desde === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.desde) ? b.desde : new Date().toISOString().slice(0, 10) }); return json({ ok: true });
      }
      if (m === "POST" && ruta === "/api/plataforma/pagos") {
        const b = await leer(req); if (!uuidOk(b.empresa)) throw new ErrorPr(400, "Empresa no válida", "entrada_invalida");
        await bd.rpc("fel_admin_pago_simulado_registrar", { p_actor: M, p_empresa: b.empresa, p_monto: monto(String(b.monto ?? ""), "Monto"), p_referencia: texto(b.referencia, 1, 120, "Referencia"), p_clave: texto(b.clave, 16, 80, "Clave de idempotencia") }); return json({ ok: true });
      }
      if (m === "POST" && ruta === "/api/plataforma/cuentas") {
        const b = await leer(req); if (!uuidOk(b.empresa)) throw new ErrorPr(400, "Empresa no válida", "entrada_invalida"); const est = String(b.estado);
        if (!["activa", "suspendida", "cerrada"].includes(est)) throw new ErrorPr(400, "Estado no válido", "entrada_invalida");
        const cupo = b.cupo === null || b.cupo === "" || b.cupo === undefined ? null : monto(String(b.cupo), "Cupo");
        await bd.rpc("fel_admin_cuenta_comercial_ajustar", { p_actor: M, p_empresa: b.empresa, p_estado: est, p_cupo: cupo, p_motivo: texto(b.motivo, 5, 300, "Motivo") }); return json({ ok: true });
      }
      if (m === "POST" && ruta === "/api/plataforma/cobros/generar") {
        const b = await leer(req); if (!uuidOk(b.empresa)) throw new ErrorPr(400, "Empresa no válida", "entrada_invalida");
        return json(await bd.rpc("fel_admin_cobro_generar", { p_actor: M, p_empresa: b.empresa, p_periodo: typeof b.periodo === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.periodo) ? b.periodo : new Date().toISOString().slice(0, 10) }));
      }
      if (m === "POST" && ruta === "/api/plataforma/cobros/emitir") {
        const b = await leer(req); if (!uuidOk(b.cobro)) throw new ErrorPr(400, "Cobro no válido", "entrada_invalida");
        return json(await bd.rpc("fel_admin_cobro_emitir", { p_actor: M, p_cobro: b.cobro, p_referencia: texto(b.referencia, 3, 120, "Referencia del documento"), p_monto_total: monto(String(b.monto_total ?? ""), "Total del documento") }));
      }
      if (m === "GET" && (r = /^\/api\/plataforma\/empresas\/([^/]+)\/plan$/.exec(ruta))) { if (!uuidOk(r[1])) throw new ErrorPr(400, "Empresa no válida", "entrada_invalida"); return json(await planDe(r[1])); }
      if (m === "POST" && (r = /^\/api\/plataforma\/empresas\/([^/]+)\/estado$/.exec(ruta))) {
        const b = await leer(req); if (!uuidOk(r[1])) throw new ErrorPr(400, "Empresa no válida", "entrada_invalida");
        await bd.rpc("fel_admin_empresa_estado", { p_actor: M, p_empresa: r[1], p_estado: String(b.estado), p_motivo: texto(b.motivo, 5, 300, "Motivo") }); return json({ ok: true });
      }
      if (m === "POST" && ruta === "/api/plataforma/empresas") {
        const b = await leer(req); const usuario = texto(b.propietario_usuario, 3, 20, "Usuario del propietario").toLowerCase(); if (!/^[a-z][a-z0-9_]{2,19}$/.test(usuario)) throw new ErrorPr(400, "Usuario: letras minúsculas, números o guion bajo (3 a 20)", "entrada_invalida");
        if (usuario in PERSONAS) throw new ErrorPr(409, "Ese usuario ya existe", "conflicto"); const clave = texto(b.propietario_clave, 8, 80, "Contraseña del propietario");
        const [reg] = await bd.filas<{ id: string }>("select id from public.regimenes_fiscales where codigo = $1", [typeof b.regimen === "string" ? b.regimen : "general"]); if (!reg) throw new ErrorPr(422, "Régimen no encontrado", "regla");
        const empresa = await bd.rpc("fel_admin_empresa_crear", { p_actor: M, p_nombre_comercial: texto(b.nombre_comercial, 1, 120, "Nombre comercial"), p_razon_social: texto(b.razon_social, 1, 200, "Razón social"), p_nit: texto(b.nit, 3, 20, "NIT"), p_regimen_id: reg.id }) as string;
        await bd.rpc("fel_admin_empresa_estado", { p_actor: M, p_empresa: empresa, p_estado: "habilitada", p_motivo: "Alta de la empresa en la demostración" });
        const uid = crypto.randomUUID(), nombre = texto(b.propietario_nombre, 3, 80, "Nombre del propietario");
        await bd.db.query("insert into auth.users (id, email) values ($1, $2)", [uid, `${usuario}@demo.example`]); await bd.db.query("insert into public.perfiles (user_id) values ($1) on conflict (user_id) do nothing", [uid]);
        await bd.db.query("insert into public.miembros (empresa_id, user_id, rol) values ($1, $2, 'propietario')", [empresa, uid]);
        for (const p of ["mock", "digifact"]) await bd.filas("select public.fel_op_canal_configurar($1, $2, null, $3, 'simulado', true)", [uid, empresa, p]);
        PERSONAS[usuario] = { id: uid, nombre, rol: "propietario", descripcion: `Propietario de ${texto(b.nombre_comercial, 1, 120, "Nombre comercial")}`, empresa };
        await d.sesiones?.registrar(usuario, clave);
        return json({ empresa, usuario, aviso: "Empresa habilitada con canal simulado y Digifact simulado. Asígnale un plan y registra un pago simulado para que pueda certificar." });
      }
      if (m === "GET" && ruta === "/api/plataforma/bolson") {
        const cuentas = await bd.filas<Obj>("select c.id, c.proveedor_id, c.ambiente, c.referencia_externa, c.estado, s.comprado::text as comprado, s.consumido::text as consumido, s.reservado::text as reservado, s.ajustado::text as ajustado, (s.comprado + s.ajustado - s.consumido - s.reservado)::text as disponible from public.bolson_cuentas c join public.bolson_saldos s on s.cuenta_id = c.id order by c.creada_en");
        const lotes = await bd.filas<Obj>("select l.id, l.cuenta_id, l.unidades::text as unidades, l.costo_total::text as costo_total, l.referencia_proveedor, l.registrado_en from public.bolson_lotes l order by l.registrado_en desc limit 20");
        const porEmpresa = await bd.filas<Obj>("select e.id, e.nombre_comercial, count(*) filter (where c.estado = 'confirmado')::int as confirmados, count(*) filter (where c.estado = 'reservado')::int as reservados, count(*) filter (where c.estado = 'liberado')::int as liberados, coalesce(sum(c.unidades_consumidas) filter (where c.estado = 'confirmado'), 0)::text as unidades from public.empresas e left join public.consumos c on c.empresa_id = e.id group by e.id, e.nombre_comercial order by e.nombre_comercial");
        const reglas = await bd.filas<Obj>("select r.cuenta_id, r.evento_tipo, r.consume, r.unidades::text as unidades from public.bolson_reglas_consumo r where r.vigente_hasta is null order by r.evento_tipo");
        const alertas = await bd.filas<Obj>("select a.id, a.tipo, a.detalle, a.creada_en, a.resuelta_en, e.nombre_comercial from public.bolson_alertas a left join public.empresas e on e.id = a.empresa_id order by a.creada_en desc limit 20");
        return json({ cuentas, lotes, porEmpresa, reglas, alertas, simulador: { saldo_reportado: sim.saldo, certificaciones: sim.certificados.length, llamadas: sim.llamadas.length }, verificacion: await this.verificacion() });
      }
      if (m === "POST" && ruta === "/api/plataforma/bolson/lotes") {
        const b = await leer(req); if (!uuidOk(b.cuenta)) throw new ErrorPr(400, "Cuenta no válida", "entrada_invalida");
        await bd.rpc("fel_admin_bolson_lote_registrar", { p_actor: M, p_cuenta: b.cuenta, p_unidades: monto(String(b.unidades ?? ""), "Unidades"), p_costo_total: monto(String(b.costo_total ?? "0"), "Costo total"), p_referencia: texto(b.referencia, 1, 120, "Referencia del proveedor") });
        sim.saldo += Number(b.unidades); return json({ ok: true });
      }
      if (m === "POST" && (r = /^\/api\/plataforma\/bolson\/alertas\/([^/]+)\/resolver$/.exec(ruta))) {
        const b = await leer(req); if (!uuidOk(r[1])) throw new ErrorPr(400, "Alerta no válida", "entrada_invalida");
        await bd.rpc("fel_admin_bolson_alerta_resolver", { p_actor: M, p_alerta: r[1], p_nota: texto(b.nota, 3, 300, "Nota") }); return json({ ok: true });
      }
      if (m === "GET" && ruta === "/api/plataforma/bolson/conciliaciones") {
        const extractos = await bd.filas<Obj>("select x.id, x.periodo_desde, x.periodo_hasta, x.saldo_final::text as saldo_final, x.importado_en, (select count(*)::int from public.bolson_extracto_lineas l where l.extracto_id = x.id) as lineas, c.id as conciliacion_id from public.bolson_extractos x left join public.bolson_conciliaciones c on c.extracto_id = x.id order by x.importado_en desc limit 20");
        const conciliaciones = await bd.filas<Obj>("select id, extracto_id, estado, propuesta_por, propuesta_en, decidida_por, decidida_en, nota, resumen from public.bolson_conciliaciones order by propuesta_en desc limit 20");
        const partidas = await bd.filas<Obj>(`select p.id, p.conciliacion_id, p.clasificacion, p.referencia, p.unidades_extracto::text as unidades_extracto, p.unidades_nexa::text as unidades_nexa, p.diferencia::text as diferencia, e.nombre_comercial,
            r.accion, r.motivo as resolucion_motivo, r.unidades::text as resolucion_unidades, re.nombre_comercial as resolucion_empresa
          from public.bolson_conciliacion_partidas p left join public.empresas e on e.id = p.empresa_id left join public.bolson_partida_resoluciones r on r.partida_id = p.id left join public.empresas re on re.id = r.empresa_id
          order by p.clasificacion = 'coincide', p.referencia`);
        return json({ extractos, conciliaciones, partidas, yo: M, nombres: Object.fromEntries(Object.values(PERSONAS).map((u) => [u.id, u.nombre])), empresas: await bd.filas("select id, nombre_comercial from public.empresas order by nombre_comercial") });
      }
      if (m === "POST" && ruta === "/api/plataforma/bolson/extractos/importar") {
        const b = await leer(req); const cuenta = uuidOk(b.cuenta) ? b.cuenta : null; if (!cuenta) throw new ErrorPr(400, "Cuenta no válida", "entrada_invalida");
        const hoy = new Date(), ayer = new Date(hoy.getTime() - 86_400_000), f = (x: Date) => x.toISOString().slice(0, 10);
        return json(await servicio.importarExtracto({ actor: M, cuenta, desde: f(ayer), hasta: f(hoy), saldoFinal: sim.saldo }));
      }
      if (m === "POST" && ruta === "/api/plataforma/bolson/conciliaciones/proponer") { const b = await leer(req); if (!uuidOk(b.extracto)) throw new ErrorPr(400, "Extracto no válido", "entrada_invalida"); return json(await bd.rpc("fel_admin_bolson_conciliar_proponer", { p_actor: M, p_extracto: b.extracto })); }
      if (m === "POST" && (r = /^\/api\/plataforma\/bolson\/conciliaciones\/([^/]+)\/decidir$/.exec(ruta))) {
        const b = await leer(req); if (!uuidOk(r[1])) throw new ErrorPr(400, "Conciliación no válida", "entrada_invalida");
        return json(await bd.rpc("fel_admin_bolson_conciliar_decidir", { p_actor: M, p_conciliacion: r[1], p_aprobar: b.aprobar === true, p_nota: texto(b.nota, 5, 300, "Nota") }));
      }
      if (m === "POST" && (r = /^\/api\/plataforma\/bolson\/partidas\/([^/]+)\/resolver$/.exec(ruta))) {
        const b = await leer(req); if (!uuidOk(r[1])) throw new ErrorPr(400, "Partida no válida", "entrada_invalida");
        return json(await bd.rpc("fel_admin_bolson_partida_resolver", { p_actor: M, p_partida: r[1], p_accion: String(b.accion), p_empresa: uuidOk(b.empresa) ? b.empresa : null, p_motivo: texto(b.motivo, 10, 300, "Motivo") }));
      }
      if (m === "POST" && ruta === "/api/plataforma/bolson/simulador") {   // controles de la DEMOSTRACIÓN: reproducen lo que en la realidad hace el proveedor por su cuenta
        const b = await leer(req);
        if (b.accion === "consumo_ajeno") sim.inyectarConsumoAjeno(`AJENO-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, "1.000000");
        else if (b.accion === "omitir_ultimo") { const ult = [...sim.consumos].reverse().find((c) => c.evento === "CERTIFICACION"); if (!ult) throw new ErrorPr(422, "No hay consumos que omitir", "regla"); sim.omitirConsumo(ult.referencia); }
        else throw new ErrorPr(400, "Acción no válida", "entrada_invalida");
        return json({ ok: true });
      }
      if (m === "POST" && ruta === "/api/plataforma/bolson/revisar") { await leer(req); await bd.rpc("fel_sys_bolson_revisar", {}); return json({ verificacion: await this.verificacion() }); }
      throw new ErrorPr(403, "Esta función no está disponible para el administrador de la plataforma", "no_autorizado");
    },
    async verificacion() {
      const s = await bd.filas<{ ok: boolean }>("select ok from public.fel_sys_verificar_saldos()"), w = await bd.filas<{ ok: boolean }>("select ok from public.fel_sys_verificar_monederos()");
      return { comprobaciones: s.length + w.length, fallos: [...s, ...w].filter((x) => !x.ok).length };
    },
  };
}
export { ErrorBd, EXTRA, esMaestro };
