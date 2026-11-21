// Envío de facturas certificadas por correo (módulo propio de NEXA FEL; Digifact solo certifica). API real en el mismo proceso, PostgreSQL en memoria con las 28 migraciones + la PROPUESTA del historial de correos,
// proveedor de correo SIMULADO (no sale nada a la red) y, para el adaptador de Resend, un «fetch» falso. Ninguna prueba envía correos reales ni usa credenciales.
// Uso: deno test -A tests/correo_test.ts
import assert from "node:assert/strict";
import { montar, type J } from "./ayudas_receptor.ts";
import { crearBdPg, type BdDemo } from "../src/bd.ts";
import { prepararBase } from "../src/aprovisionar.ts";
import { PERSONAS } from "../src/mundo_practico.ts";
import { baseDePrueba } from "./bd_prueba.ts";
import { CorreoSimulado, ResendCorreo, type MensajeCorreo } from "../src/correo/proveedor.ts";
import { crearCorreoDesdeEntorno, listaDestinatarios } from "../src/correo/entorno.ts";
import { esc, plantillaFactura, ROTULO_PRUEBA } from "../src/correo/plantilla.ts";
import { enmascarar, formatoQuetzales } from "../src/correo/servicio.ts";

export const SQL_CORREO = new URL("../../docs/migracion-correo/20261121000100_fel_correo_envios.sql", import.meta.url);
export const aplicarCorreo = async (bd: BdDemo) => { if (bd.tipo === "pglite") await bd.db!.exec(await Deno.readTextFile(SQL_CORREO)); };   // en PostgreSQL real ya viene en la plantilla de pruebas

type Cli = Awaited<ReturnType<Awaited<ReturnType<typeof montar>>["Cli"]["prototype"]["entrar"]>>;
async function documento(ana: Cli, clave: string, certificar = true) {
  const est = (await ana.llamar("GET", "/api/estado")).json, cli = est.clientes.find((c: J) => c.nombre.startsWith("Comercial") || c.nombre.startsWith("Distribuidora")), es = est.establecimientos[0];
  const d = await ana.llamar("POST", "/api/documentos", { cliente_id: cli.id, establecimiento_id: es.id, fecha: new Date().toISOString().slice(0, 10), lineas: [{ descripcion: "Servicio de prueba", cantidad: "2", precio_unitario: "1000" }] });
  assert.equal(d.status, 200, d.texto);
  if (!certificar) return d.json.documento.id as string;
  assert.equal((await ana.llamar("POST", `/api/documentos/${d.json.documento.id}/estado`, { estado: "revisado", version: d.json.documento.version })).status, 200);
  const c = await ana.llamar("POST", `/api/documentos/${d.json.documento.id}/certificar`, { proveedor: "digifact", escenario: "exito", clave });
  assert.equal(c.status, 200, c.texto); assert.equal(c.json.documento.estado_fiscal, "certificado");
  return c.json.documento.id as string;
}
async function entorno(env: Record<string, string> = { FEL_CORREO: "simulado" }, limites = { empresa: 1000, persona: 1000 }) {
  const prov = new CorreoSimulado();
  const w = await montar(async (bd) => { await aplicarCorreo(bd); return { correo: crearCorreoDesdeEntorno((k) => env[k], bd, { proveedor: prov, limites }).servicio }; });
  return { ...w, prov };
}
const enviar = (c: Cli, id: string, cuerpo: J) => c.llamar("POST", `/api/documentos/${id}/correo`, cuerpo);
const DEST = "cliente.prueba@ejemplo.com";

Deno.test({ name: "correo: envío manual con PDF y XML íntegros, rótulo de prueba, historial y auditoría sin datos sensibles", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const { bd, Cli, prov } = await entorno(); const ana = await new Cli("ana").entrar(), pedro = await new Cli("pedro").entrar();
  const id = await documento(ana, "clave-cert-correo-0001");
  assert.equal((await ana.llamar("GET", "/api/correo/estado")).json.habilitado, true);
  const r = await enviar(ana, id, { destinatario: DEST, clave: "envio-0001-aaaa" }); assert.equal(r.status, 201, r.texto);
  assert.equal(r.json.envio.estado, "aceptado"); assert.equal(r.json.repetido, false); assert.equal(r.json.envio.destinatario, DEST); assert.equal(r.json.envio.proveedor, "simulado");
  assert.equal(prov.enviados.length, 1); const m = prov.enviados[0];
  assert.equal(m.para, DEST); assert.match(m.de, /^NEXA FEL </); assert.match(m.asunto, /^\[PRUEBA\] Factura .+ de /);
  // adjuntos: exactamente los de ESTA factura, byte por byte, sin modificar
  const arts = await bd.filas<{ tipo: string; nombre: string; contenido: Uint8Array }>("select a.tipo, a.nombre, a.contenido from public.artefactos_documento a join public.operaciones_fiscales o on o.id = a.operacion_id where a.documento_id = $1 and o.tipo = 'certificacion'", [id]);
  assert.equal(arts.length, 2); assert.equal(m.adjuntos.length, 2);
  for (const a of arts) { const x = m.adjuntos.find((y) => y.nombre === a.nombre); assert.ok(x, a.tipo); assert.deepEqual([...x.contenido], [...a.contenido], `adjunto ${a.tipo} idéntico al certificado`); }
  assert.ok(m.adjuntos.some((a) => a.mime === "application/pdf") && m.adjuntos.some((a) => a.mime === "application/xml"));
  assert.ok(m.html.includes(ROTULO_PRUEBA) && m.texto.includes(ROTULO_PRUEBA), "rótulo de documento de prueba"); assert.match(m.html, /Q 2,\d{3}\.\d{2}/, "total en quetzales");
  // historial visible para quien tiene correos.ver (incluido el lector); sin contenido ni adjuntos
  for (const c of [ana, pedro]) { const h = await c.llamar("GET", `/api/documentos/${id}/correos`); assert.equal(h.status, 200); assert.equal(h.json.envios.length, 1); assert.ok(!/contenido|sha256|re_[A-Za-z0-9]/.test(h.texto)); }
  assert.equal((await enviar(pedro, id, { destinatario: DEST, clave: "envio-0001-lector" })).status, 403, "el lector no envía");
  // auditoría: correo enmascarado, sin el contenido
  const aud = await bd.filas<{ accion: string; datos: J }>("select accion, datos from public.auditoria where accion like 'correo.%' and entidad_id = $1", [id]);
  assert.equal(aud.length, 1); assert.equal(aud[0].accion, "correo.aceptado"); assert.equal(aud[0].datos.destinatario, enmascarar(DEST)); assert.ok(!JSON.stringify(aud[0].datos).includes("cliente.prueba"));
}});

Deno.test({ name: "correo: duplicados — la misma solicitud no envía dos veces; un segundo envío al mismo destinatario exige reenviar", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const { bd, Cli, prov } = await entorno(); const ana = await new Cli("ana").entrar();
  const id = await documento(ana, "clave-cert-correo-0002");
  const a = await enviar(ana, id, { destinatario: DEST, clave: "envio-0002-aaaa" }); assert.equal(a.status, 201);
  const b = await enviar(ana, id, { destinatario: DEST, clave: "envio-0002-aaaa" }); assert.equal(b.status, 200, b.texto); assert.equal(b.json.repetido, true); assert.equal(b.json.envio.id, a.json.envio.id);
  assert.equal(prov.enviados.length, 1, "doble clic / reintento del navegador: un solo correo");
  const c = await enviar(ana, id, { destinatario: DEST.toUpperCase(), clave: "envio-0002-bbbb" }); assert.equal(c.status, 409); assert.equal(c.json.codigo, "ya_enviado"); assert.equal(prov.enviados.length, 1);
  assert.equal((await enviar(ana, id, { destinatario: DEST, clave: "envio-0002-aaaa" })).json.repetido, true);
  assert.equal((await enviar(ana, id, { destinatario: "otro@ejemplo.com", clave: "envio-0002-aaaa" })).json.codigo, "clave_en_uso", "la misma clave no sirve para otro destinatario");
  // dos solicitudes simultáneas con la misma clave: un solo envío
  const id2 = await documento(ana, "clave-cert-correo-0003");
  const [x, y] = await Promise.all([enviar(ana, id2, { destinatario: DEST, clave: "envio-0003-aaaa" }), enviar(ana, id2, { destinatario: DEST, clave: "envio-0003-aaaa" })]);
  assert.deepEqual([x.status, y.status].sort(), [200, 201]); assert.equal(prov.enviados.length, 2, "una sola salida para las dos solicitudes simultáneas");
  assert.equal(Number((await bd.filas<{ n: string }>("select count(*)::text as n from public.envios_correo where documento_id = $1", [id2]))[0].n), 1);
}});

Deno.test({ name: "correo: reenvío con permiso, confirmación escrita y envío previo; tope diario", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const { Cli, prov } = await entorno(); const ana = await new Cli("ana").entrar(), marta = await new Cli("marta").entrar();
  const id = await documento(ana, "clave-cert-correo-0004");
  const sinPrevio = await enviar(ana, id, { destinatario: DEST, clave: "reenvio-0004-a", reenvio: true, confirmacion: "REENVIAR" }); assert.equal(sinPrevio.status, 409); assert.equal(sinPrevio.json.codigo, "sin_envio_previo");
  assert.equal((await enviar(ana, id, { destinatario: DEST, clave: "envio-0004-aaaa" })).status, 201);
  assert.equal((await enviar(ana, id, { destinatario: DEST, clave: "reenvio-0004-b", reenvio: true })).json.codigo, "confirmacion_requerida");
  assert.equal((await enviar(ana, id, { destinatario: DEST, clave: "reenvio-0004-c", reenvio: true, confirmacion: "reenviar" })).status, 400, "la palabra se escribe exacta");
  assert.equal((await enviar(marta, id, { destinatario: DEST, clave: "reenvio-0004-d", reenvio: true, confirmacion: "REENVIAR" })).status, 403, "la emisora envía pero no reenvía");
  assert.equal(prov.enviados.length, 1, "nada de lo anterior envió");
  const ok = await enviar(ana, id, { destinatario: DEST, clave: "reenvio-0004-e", reenvio: true, confirmacion: "REENVIAR" }); assert.equal(ok.status, 201, ok.texto); assert.equal(ok.json.envio.origen, "reenvio"); assert.equal(prov.enviados.length, 2);
  assert.equal((await ana.llamar("GET", `/api/documentos/${id}/correos`)).json.envios.length, 2, "historial con los dos intentos");
  for (let i = 0; i < 4; i++) assert.equal((await enviar(ana, id, { destinatario: DEST, clave: `reenvio-0004-t${i}x`, reenvio: true, confirmacion: "REENVIAR" })).status, 201);
  const tope = await enviar(ana, id, { destinatario: DEST, clave: "reenvio-0004-tope", reenvio: true, confirmacion: "REENVIAR" }); assert.ok(tope.status === 429, tope.texto); assert.ok(["limite_reenvios", "demasiados_envios"].includes(tope.json.codigo));
}});

Deno.test({ name: "correo: reglas — sin correo, dirección inválida, no certificada, anulada, otra empresa y errores del proveedor", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const { bd, Cli, prov } = await entorno(); const ana = await new Cli("ana").entrar(), sofia = await new Cli("sofia").entrar();
  const id = await documento(ana, "clave-cert-correo-0005");
  const filas = async (doc: string) => Number((await bd.filas<{ n: string }>("select count(*)::text as n from public.envios_correo where documento_id = $1", [doc]))[0].n);
  // sin destinatario escrito se usa el correo guardado del receptor; si el receptor no tiene correo, se pide uno
  const [{ email }] = await bd.filas<{ email: string | null }>("select c.email from public.clientes c join public.documentos d on d.cliente_id = c.id and d.empresa_id = c.empresa_id where d.id = $1", [id]); assert.ok(email, "el receptor de la demostración trae un correo guardado");
  const conGuardado = await enviar(ana, id, { clave: "envio-0005-guardado" }); assert.equal(conGuardado.status, 201, conGuardado.texto); assert.equal(prov.enviados.at(-1)!.para, email, "usa el correo guardado del receptor"); prov.enviados.length = 0;
  const idSin = await documento(ana, "clave-cert-correo-0005b"); await bd.ejecutar("update public.clientes set email = null where id = (select cliente_id from public.documentos where id = $1)", [idSin]);
  const sin = await enviar(ana, idSin, { clave: "envio-0005-aaaa" }); assert.equal(sin.status, 400); assert.equal(sin.json.codigo, "sin_correo"); assert.equal(await filas(idSin), 0);
  for (const mal of ["no-es-correo", "a@b", "x y@ejemplo.com", "a@@ejemplo.com", "<script>@ejemplo.com", "uno@ejemplo.com,dos@ejemplo.com", "a".repeat(300) + "@ejemplo.com"]) { const r = await enviar(ana, id, { destinatario: mal, clave: "envio-0005-bbbb" }); assert.equal(r.status, 400, mal.slice(0, 20)); assert.equal(r.json.codigo, "correo_invalido"); }
  assert.equal(await filas(id), 1, "las direcciones inválidas no crearon filas (solo el envío al correo guardado)"); assert.equal(prov.enviados.length, 0);
  // no certificada (borrador) y anulada
  const borrador = await documento(ana, "x", false); const b = await enviar(ana, borrador, { destinatario: DEST, clave: "envio-0005-cccc" }); assert.equal(b.status, 409); assert.equal(b.json.codigo, "no_certificada");
  const anu = await ana.llamar("POST", `/api/documentos/${id}/anular`, { confirmacion: "ANULAR", motivo: "Anulación de prueba del correo", clave: "clave-anula-correo-0005" }); assert.equal(anu.status, 200, anu.texto);
  const a = await enviar(ana, id, { destinatario: DEST, clave: "envio-0005-dddd" }); assert.equal(a.status, 409); assert.equal(a.json.codigo, "no_certificada"); assert.match(a.json.mensaje, /anulada/);
  assert.equal(prov.enviados.length, 0, "ni borradores ni anuladas salen");
  // otra empresa: ni ve ni envía ni lista
  const id2 = await documento(ana, "clave-cert-correo-0006"); assert.equal((await enviar(ana, id2, { destinatario: DEST, clave: "envio-0006-aaaa" })).status, 201);
  const aj = await enviar(sofia, id2, { destinatario: DEST, clave: "envio-0006-sofia" }); assert.equal(aj.status, 404); assert.equal(aj.json.codigo, "no_encontrado");
  assert.deepEqual((await sofia.llamar("GET", `/api/documentos/${id2}/correos`)).json.envios, [], "otra empresa no ve el historial");
  assert.equal(prov.enviados.length, 1);
  // errores del proveedor: rechazado y fallido se registran; el reintento con la MISMA clave termina bien y no duplica
  const id3 = await documento(ana, "clave-cert-correo-0007");
  prov.siguiente = { estado: "rechazado", codigo: "validation_error" }; const rz = await enviar(ana, id3, { destinatario: DEST, clave: "envio-0007-aaaa" });
  assert.equal(rz.status, 201); assert.equal(rz.json.envio.estado, "rechazado"); assert.equal(rz.json.envio.error_codigo, "validation_error");
  prov.siguiente = { estado: "fallido", codigo: "tiempo_agotado" }; const fl = await enviar(ana, id3, { destinatario: DEST, clave: "envio-0007-bbbb" }); assert.equal(fl.json.envio.estado, "fallido");
  const rei = await enviar(ana, id3, { destinatario: DEST, clave: "envio-0007-bbbb" }); assert.equal(rei.status, 201); assert.equal(rei.json.envio.estado, "aceptado"); assert.equal(rei.json.envio.id, fl.json.envio.id, "se retoma el mismo envío");
  assert.equal(await filas(id3), 2); assert.equal(prov.enviados.length, 2);
  // tras un fallo, aunque la pantalla genere OTRA clave (recarga), se retoma el mismo envío: no se duplica
  const id4 = await documento(ana, "clave-cert-correo-0012"); prov.siguiente = { estado: "fallido", codigo: "red" }; const f4 = await enviar(ana, id4, { destinatario: DEST, clave: "envio-0012-aaaa" }); assert.equal(f4.json.envio.estado, "fallido");
  const r4 = await enviar(ana, id4, { destinatario: DEST, clave: "envio-0012-otra" }); assert.equal(r4.json.envio.estado, "aceptado"); assert.equal(r4.json.envio.id, f4.json.envio.id); assert.equal(await filas(id4), 1); assert.equal(prov.enviados.length, 3);
  const aud = await bd.filas<{ accion: string }>("select accion from public.auditoria where accion like 'correo.%' and entidad_id = $1 order by id", [id3]); assert.deepEqual(aud.map((x) => x.accion), ["correo.rechazado", "correo.fallido", "correo.aceptado"]);
}});

Deno.test({ name: "correo propio: si Digifact ya recibió la orden de enviar el correo al certificar, NEXA no envía otro (sin duplicados entre los dos caminos)", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const { bd, Cli, prov } = await entorno(); const ana = await new Cli("ana").entrar(); const id = await documento(ana, "clave-cert-correo-0020"); const id2 = await documento(ana, "clave-cert-correo-0021");
  const [emp] = await bd.filas<{ empresa_id: string }>("select empresa_id from public.documentos where id = $1", [id]);
  await bd.filas("select public.fel_auditar($1, $2, 'digifact_test.correo_solicitado', 'documento', $3, '{\"destinatario\":\"c***@ejemplo.com\"}'::jsonb)", [emp.empresa_id, PERSONAS.ana.id, id]);
  const r = await enviar(ana, id, { destinatario: DEST, clave: "envio-0020-aaaa" }); assert.equal(r.status, 409); assert.equal(r.json.codigo, "lo_envia_digifact"); assert.equal(prov.enviados.length, 0);
  assert.equal((await enviar(ana, id2, { destinatario: DEST, clave: "envio-0021-aaaa" })).status, 201, "otro documento sin orden a Digifact sí se puede enviar");
}});

Deno.test({ name: "correo: límites de frecuencia por persona", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  // El límite usa una VENTANA FIJA de 60 s alineada al reloj: si el minuto cambia en mitad de la prueba el contador vuelve a cero y la prueba fallaría sin defecto real. Se espera al siguiente minuto si quedan menos de 10 s.
  { const resto = 60_000 - (Date.now() % 60_000); if (resto < 10_000) await new Promise((r) => setTimeout(r, resto + 250)); }
  const { Cli, prov } = await entorno(undefined, { empresa: 1000, persona: 10 }); const marta = await new Cli("marta").entrar();
  let ultimo = 0, n429 = 0; for (let i = 0; i < 13; i++) { const r = await marta.llamar("POST", `/api/documentos/00000000-0000-4000-8000-00000000000${i % 9}/correo`, { destinatario: DEST, clave: `envio-limite-${i}xx` }); ultimo = r.status; if (r.status === 429) { n429++; assert.equal(r.json.codigo, "demasiados_envios"); } }
  assert.ok(n429 >= 1 && ultimo === 429, "tras varios intentos seguidos se limita"); assert.equal(prov.enviados.length, 0);
}});

Deno.test({ name: "correo: sin la tabla del historial (28 migraciones) o sin configurar, el módulo queda no disponible sin errores", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const prov = new CorreoSimulado();
  const w = await montar(async (bd) => ({ correo: crearCorreoDesdeEntorno(() => "simulado", bd, { proveedor: prov }).servicio }));   // sin aplicar la propuesta
  const ana = await new w.Cli("ana").entrar(); const id = await documento(ana, "clave-cert-correo-0008");
  assert.equal((await ana.llamar("GET", "/api/correo/estado")).json.habilitado, false); const r = await enviar(ana, id, { destinatario: DEST, clave: "envio-0008-aaaa" }); assert.equal(r.status, 503); assert.equal(r.json.codigo, "correo_no_habilitado");
  const sin = await montar(); const a2 = await new sin.Cli("ana").entrar(); const e = await a2.llamar("GET", "/api/correo/estado"); assert.equal(e.status, 200); assert.equal(e.json.habilitado, false);
  assert.equal((await enviar(a2, await documento(a2, "clave-cert-correo-0009"), { destinatario: DEST, clave: "envio-0009-aaaa" })).status, 503); assert.equal(prov.enviados.length, 0);
}});

Deno.test({ name: "correo: la base protege el historial (solo cambia el resultado, sin borrados, sin saltos de estado, sin duplicados)", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const { bd, Cli } = await entorno(); const ana = await new Cli("ana").entrar(); const id = await documento(ana, "clave-cert-correo-0010");
  const r = await enviar(ana, id, { destinatario: DEST, clave: "envio-0010-aaaa" }); const eid = r.json.envio.id as string;
  const falla = async (sql: string, patron: RegExp) => { await assert.rejects(() => bd.ejecutar(sql, [eid]), patron); };
  await falla("update public.envios_correo set destinatario = 'otro@ejemplo.com' where id = $1", /FEL_APPEND_ONLY/); await falla("delete from public.envios_correo where id = $1", /FEL_APPEND_ONLY/);
  await falla("update public.envios_correo set estado = 'solicitado', resuelto_en = null where id = $1", /FEL_ESTADO_INVALIDO/);   // aceptado → solicitado no existe
  await falla("update public.envios_correo set estado = 'rechazado' where id = $1", /FEL_ESTADO_INVALIDO/);
  await bd.ejecutar("update public.envios_correo set estado = 'entregado' where id = $1", [eid]);   // aceptado → entregado sí (lo confirmaría un webhook futuro)
  await assert.rejects(() => bd.ejecutar("insert into public.envios_correo (empresa_id, documento_id, operacion_id, destinatario, origen, proveedor, clave_idempotencia, estado, resuelto_en) select empresa_id, documento_id, operacion_id, 'cliente.prueba@EJEMPLO.com', 'manual', 'simulado', 'otra-clave-0011', 'aceptado', now() from public.envios_correo where id = $1", [eid]), /duplicate|unique|envios_correo_uno_por_destinatario/i);
  await assert.rejects(() => bd.ejecutar("insert into public.envios_correo (empresa_id, documento_id, operacion_id, destinatario, origen, proveedor, clave_idempotencia) select empresa_id, documento_id, operacion_id, 'no-es-correo', 'manual', 'simulado', 'otra-clave-0012' from public.envios_correo where id = $1", [eid]), /check|destinatario/i);
}});

Deno.test("correo: el adaptador de Resend arma la solicitud correcta, clasifica los resultados y nunca expone la clave", async () => {
  const CLAVE = "re_TestClaveFalsa123456789";
  const msg = (extra: Partial<MensajeCorreo> = {}): MensajeCorreo => ({ de: "NEXA FEL <facturas@ejemplo.com>", para: DEST, asunto: "Factura A-1", html: "<p>x</p>", texto: "x", clave: "emp:clave-123456", adjuntos: [{ nombre: "A-1.pdf", mime: "application/pdf", contenido: new Uint8Array([37, 80, 68, 70]) }, { nombre: "A-1.xml", mime: "application/xml", contenido: new TextEncoder().encode("<a/>") }], ...extra });
  const vistos: { url: string; init: RequestInit }[] = []; const falso = (st: number, cuerpo: unknown): typeof fetch => (u, i) => { vistos.push({ url: String(u), init: i as RequestInit }); return Promise.resolve(new Response(JSON.stringify(cuerpo), { status: st })); };
  const ok = await new ResendCorreo({ apiKey: CLAVE, fetchImpl: falso(200, { id: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794" }) }).enviar(msg()); assert.deepEqual(ok, { estado: "aceptado", mensajeId: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794" });
  const v = vistos[0]; assert.equal(v.url, "https://api.resend.com/emails"); assert.equal(v.init.method, "POST"); const h = v.init.headers as Record<string, string>;
  assert.equal(h.authorization, `Bearer ${CLAVE}`); assert.equal(h["idempotency-key"], "emp:clave-123456");
  const cuerpo = JSON.parse(String(v.init.body)); assert.deepEqual(cuerpo.to, [DEST]); assert.equal(cuerpo.from, "NEXA FEL <facturas@ejemplo.com>"); assert.equal(cuerpo.attachments.length, 2);
  assert.equal(atob(cuerpo.attachments[0].content), "%PDF"); assert.equal(cuerpo.attachments[1].filename, "A-1.xml"); assert.ok(!JSON.stringify(cuerpo).includes(CLAVE), "la clave no viaja en el cuerpo");
  assert.deepEqual(await new ResendCorreo({ apiKey: CLAVE, fetchImpl: falso(422, { name: "validation_error", message: `contiene ${DEST} y ${CLAVE}` }) }).enviar(msg()), { estado: "rechazado", codigo: "validation_error" }, "no se reenvía el texto libre del proveedor");
  for (const st of [429, 500, 503, 409]) assert.deepEqual(await new ResendCorreo({ apiKey: CLAVE, fetchImpl: falso(st, {}) }).enviar(msg()), { estado: "fallido", codigo: `http_${st}` });
  assert.deepEqual(await new ResendCorreo({ apiKey: CLAVE, fetchImpl: falso(200, {}) }).enviar(msg()), { estado: "fallido", codigo: "respuesta_sin_identificador" });
  assert.deepEqual(await new ResendCorreo({ apiKey: CLAVE, fetchImpl: () => Promise.reject(new Error(`falló con ${CLAVE}`)) }).enviar(msg()), { estado: "fallido", codigo: "red" });
  assert.deepEqual(await new ResendCorreo({ apiKey: CLAVE, tiempoMaximoMs: 20, fetchImpl: (_u, i) => new Promise((_ok, mal) => { (i as RequestInit).signal!.addEventListener("abort", () => mal(Object.assign(new Error("x"), { name: "AbortError" }))); }) }).enviar(msg()), { estado: "fallido", codigo: "tiempo_agotado" });
  assert.deepEqual(await new ResendCorreo({ apiKey: CLAVE, fetchImpl: falso(200, { id: "x" }) }).enviar(msg({ adjuntos: [{ nombre: "g.pdf", mime: "application/pdf", contenido: new Uint8Array(11 * 1024 * 1024) }] })), { estado: "rechazado", codigo: "adjuntos_demasiado_grandes" });
  assert.throws(() => new ResendCorreo({ apiKey: "clave-sin-formato" }), (e: Error) => !e.message.includes("clave-sin-formato"));
});

Deno.test({ name: "correo: configuración del entorno — falla cerrado, lista de destinatarios de prueba y envío automático apagado por defecto", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const { bd } = await montar(); const cr = (env: Record<string, string>) => crearCorreoDesdeEntorno((k) => env[k], bd, { fetchImpl: (() => Promise.reject(new Error("sin red"))) as typeof fetch });
  assert.equal(cr({}).servicio, undefined); assert.equal(cr({ FEL_CORREO: "si" }).servicio, undefined);
  const base = { FEL_CORREO: "habilitado", FEL_CORREO_REMITENTE: "NEXA FEL <facturas@ejemplo.com>", FEL_CORREO_DESTINATARIOS: "uno@ejemplo.com, @pruebas.example.org", RESEND_API_KEY: "re_TestClaveFalsa123456789" };
  assert.ok(cr(base).servicio, "configuración completa"); assert.equal(cr(base).servicio!.automatico, false, "el envío automático está apagado por defecto"); assert.equal(cr({ ...base, FEL_CORREO_AUTOMATICO: "habilitado" }).servicio!.automatico, true);
  for (const quitar of ["FEL_CORREO_REMITENTE", "FEL_CORREO_DESTINATARIOS", "RESEND_API_KEY"]) { const e = { ...base } as Record<string, string>; delete e[quitar]; const r = cr(e); assert.equal(r.servicio, undefined, quitar); assert.ok(!r.motivo.includes("re_Test") && !r.motivo.includes("uno@ejemplo.com")); }
  assert.equal(cr({ ...base, RESEND_API_KEY: "mala" }).servicio, undefined); assert.ok(!cr({ ...base, RESEND_API_KEY: "mala-secreta" }).motivo.includes("mala-secreta"));
  assert.equal(cr({ ...base, FEL_CORREO_DESTINATARIOS: "uno@ejemplo.com, basura" }).servicio, undefined, "un elemento inválido invalida la lista"); assert.equal(cr({ ...base, FEL_CORREO_REMITENTE: "sin-arroba" }).servicio, undefined);
  for (const mal of ["0", "-1", "1001", "abc", "1.5"]) assert.equal(cr({ ...base, FEL_CORREO_TOPE_DIARIO: mal }).servicio, undefined, `tope diario ${mal} no válido`); assert.ok(cr({ ...base, FEL_CORREO_TOPE_DIARIO: "5" }).servicio, "tope diario válido");
  const lista = listaDestinatarios("Uno@Ejemplo.com, @pruebas.example.org")!; assert.ok(lista("uno@ejemplo.com") && lista("UNO@EJEMPLO.COM") && lista("cualquiera@pruebas.example.org")); assert.ok(!lista("otro@ejemplo.com") && !lista("x@evil.pruebas.example.org.com") && !lista("x@mipruebas.example.org"));
  assert.equal(listaDestinatarios(""), null); assert.equal(listaDestinatarios(undefined), null);
}});

Deno.test({ name: "correo: con proveedor real, solo salen correos a destinatarios autorizados (lista cerrada) y la solicitud lleva la clave de idempotencia", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const llamadas: { url: string; init: RequestInit }[] = [];
  const falso = ((u: string, i: RequestInit) => { llamadas.push({ url: String(u), init: i }); return Promise.resolve(new Response(JSON.stringify({ id: "msg_123" }), { status: 200 })); }) as unknown as typeof fetch;
  const w = await montar(async (bd) => { await aplicarCorreo(bd); return { correo: crearCorreoDesdeEntorno((k) => ({ FEL_CORREO: "habilitado", FEL_CORREO_REMITENTE: "NEXA FEL <facturas@ejemplo.com>", FEL_CORREO_DESTINATARIOS: "prueba@ejemplo.com", RESEND_API_KEY: "re_TestClaveFalsa123456789", FEL_CORREO_TOPE_DIARIO: "2" } as Record<string, string>)[k], bd, { fetchImpl: falso, limites: { empresa: 1000, persona: 1000 } }).servicio }; });
  const ana = await new w.Cli("ana").entrar(); const id = await documento(ana, "clave-cert-correo-0011");
  const no = await enviar(ana, id, { destinatario: "ajeno@dominio-externo.com", clave: "envio-0011-aaaa" }); assert.equal(no.status, 403); assert.equal(no.json.codigo, "destinatario_no_autorizado"); assert.equal(llamadas.length, 0, "a un destinatario no autorizado no sale nada");
  const si = await enviar(ana, id, { destinatario: "prueba@ejemplo.com", clave: "envio-0011-bbbb" }); assert.equal(si.status, 201, si.texto); assert.equal(si.json.envio.proveedor, "resend"); assert.equal(llamadas.length, 1);
  assert.ok(String((llamadas[0].init.headers as Record<string, string>)["idempotency-key"]).endsWith(":envio-0011-bbbb"));
  assert.ok(!si.texto.includes("re_TestClave") && !JSON.stringify(await ana.llamar("GET", "/api/correo/estado")).includes("re_TestClave"));
  // tope diario de la etapa de pruebas reales (aquí 2): el tercer envío que llegaría al proveedor se frena, y lo bloqueado antes (destinatario no autorizado) no cuenta
  const id2 = await documento(ana, "clave-cert-correo-0013"); const id3 = await documento(ana, "clave-cert-correo-0014");
  assert.equal((await enviar(ana, id2, { destinatario: "prueba@ejemplo.com", clave: "envio-0013-aaaa" })).status, 201); assert.equal(llamadas.length, 2);
  const tope = await enviar(ana, id3, { destinatario: "prueba@ejemplo.com", clave: "envio-0014-aaaa" }); assert.equal(tope.status, 429); assert.equal(tope.json.codigo, "tope_diario"); assert.equal(llamadas.length, 2, "con el tope alcanzado no sale nada");
  assert.equal((await enviar(ana, id3, { destinatario: "ajeno@dominio-externo.com", clave: "envio-0014-bbbb" })).json.codigo, "destinatario_no_autorizado", "las validaciones previas siguen mandando");
}});

Deno.test("correo: plantilla — marca NEXA FEL, nombre del emisor, datos de la factura, rótulo de prueba, escapado, sin imágenes externas y adaptable", () => {
  const d = { emisor: "Tienda <b>\"Luna\"</b> & Co", receptor: "Ana <script>alert(1)</script>", serie: "ABC123", numero: "4567", fecha: "21/11/2026", total: "Q 1,234.50", autorizacion: "A1B2C3D4-0000-1111-2222-333344445555", prueba: true, adjuntos: ["ABC123-4567.pdf", "ABC123-4567.xml"] };
  const r = plantillaFactura(d);
  assert.match(r.asunto, /^\[PRUEBA\] Factura ABC123-4567 de Tienda/); assert.ok(r.html.includes("NEXA&nbsp;FEL")); assert.ok(r.html.includes(ROTULO_PRUEBA)); assert.ok(r.html.includes("Q 1,234.50") && r.html.includes("21/11/2026") && r.html.includes("ABC123-4567.xml"));
  assert.ok(!r.html.includes("<script") && !r.html.includes('<b>"Luna"') && r.html.includes("&lt;script&gt;"), "todo dato variable se escapa");
  assert.ok(!/<img|src=|url\(|@import|<link/i.test(r.html), "sin imágenes ni recursos externos"); assert.ok(r.html.includes('name="viewport"') && /max-width:600px/.test(r.html) && /role="presentation"/.test(r.html), "maqueta de tablas, fluida");
  assert.ok(r.texto.includes(ROTULO_PRUEBA) && r.texto.includes("Total: Q 1,234.50"));
  const sinPrueba = plantillaFactura({ ...d, prueba: false }); assert.ok(!sinPrueba.html.includes(ROTULO_PRUEBA) && !sinPrueba.asunto.startsWith("[PRUEBA]"));
  const inj = plantillaFactura({ ...d, emisor: "Emisor\r\nBcc: robo@ejemplo.com" }); assert.ok(!/[\r\n]/.test(inj.asunto), "el asunto no admite saltos de línea (inyección de cabeceras)");
  assert.equal(esc(`<>&"'`), "&lt;&gt;&amp;&quot;&#39;"); assert.equal(formatoQuetzales("1234.5"), "Q 1,234.50"); assert.equal(formatoQuetzales("0"), "Q 0.00"); assert.equal(formatoQuetzales("1000000.129"), "Q 1,000,000.12"); assert.equal(enmascarar("abc@dom.com"), "a***@dom.com");
});

Deno.test({ name: "correo (PostgreSQL REAL): envío, duplicados simultáneos, reenvío, aislamiento y protecciones de la base", ignore: !Deno.env.get("FEL_TEST_PG_ADMIN"), sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const b = await baseDePrueba(); const bd = crearBdPg(b.url!); const prov = new CorreoSimulado();
  try {
    await prepararBase(bd, { sembrar: true });
    const w = await montar(async (x) => ({ correo: crearCorreoDesdeEntorno((k) => ({ FEL_CORREO: "simulado" } as Record<string, string>)[k], x, { proveedor: prov, limites: { empresa: 1000, persona: 1000 } }).servicio }), bd);
    const ana = await new w.Cli("ana").entrar(), sofia = await new w.Cli("sofia").entrar(), marta = await new w.Cli("marta").entrar();
    const id = await documento(ana, "clave-cert-correo-pg-01");
    const a = await enviar(ana, id, { destinatario: DEST, clave: "envio-pg-0001-a" }); assert.equal(a.status, 201, a.texto); assert.equal(a.json.envio.estado, "aceptado"); assert.equal(prov.enviados.length, 1);
    assert.equal((await enviar(ana, id, { destinatario: DEST, clave: "envio-pg-0001-a" })).json.repetido, true);
    assert.equal((await enviar(ana, id, { destinatario: DEST, clave: "envio-pg-0001-b" })).json.codigo, "ya_enviado");
    const id2 = await documento(ana, "clave-cert-correo-pg-02");
    const rs = await Promise.all([1, 2, 3, 4].map(() => enviar(ana, id2, { destinatario: DEST, clave: "envio-pg-0002-a" })));
    assert.ok(rs.every((r) => r.status === 200 || r.status === 201), JSON.stringify(rs.map((r) => r.status))); assert.equal(prov.enviados.length, 2, "cuatro solicitudes simultáneas con la misma clave: una sola salida");
    const otras = await Promise.all([1, 2, 3].map((i) => enviar(ana, id2, { destinatario: DEST, clave: `envio-pg-0002-x${i}` }))); assert.ok(otras.every((r) => r.status === 409 && r.json.codigo === "ya_enviado"), "con claves distintas el índice único de la base impide el duplicado"); assert.equal(prov.enviados.length, 2);
    assert.equal((await enviar(marta, id, { destinatario: DEST, clave: "reenvio-pg-1", reenvio: true, confirmacion: "REENVIAR" })).status, 403);
    assert.equal((await enviar(ana, id, { destinatario: DEST, clave: "reenvio-pg-2", reenvio: true, confirmacion: "REENVIAR" })).status, 201); assert.equal(prov.enviados.length, 3);
    assert.equal((await enviar(sofia, id, { destinatario: DEST, clave: "envio-pg-sofia-1" })).status, 404); assert.deepEqual((await sofia.llamar("GET", `/api/documentos/${id}/correos`)).json.envios, []);
    const eid = a.json.envio.id as string;
    // ---- RLS y privilegios desde los roles de la app (authenticated/anon), con la sesión de cada persona: solo se LEE lo de la propia empresa y nunca se escribe
    const como = (userId: string, sql: string, rol = "authenticated") => bd.transaccion!(async (tx) => {
      await tx.ejecutar(`set local role ${rol}`); await tx.filas("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: rol })]); return await tx.filas<Record<string, unknown>>(sql);
    });
    const filasVisibles = async (u: string) => Number((await como(u, `select count(*)::int as n from public.envios_correo`))[0].n);
    const total = Number((await bd.filas<{ n: number }>("select count(*)::int as n from public.envios_correo"))[0].n); assert.equal(total, 3, "hay 3 envíos de la empresa de Ana (dos primeros envíos y un reenvío)");
    assert.equal(await filasVisibles(PERSONAS.ana.id), total, "Ana (propietaria) ve todos los envíos de su empresa");
    assert.equal(await filasVisibles(PERSONAS.pedro.id), total, "Pedro (lector, tiene correos.ver) ve el historial de SU empresa");
    assert.equal(await filasVisibles(PERSONAS.sofia.id), 0, "Sofía (otra empresa) no ve ningún envío ajeno");
    for (const [sql, quien] of [["insert into public.envios_correo (empresa_id) values (gen_random_uuid())", "insertar"], ["update public.envios_correo set estado = 'rechazado'", "actualizar"], ["delete from public.envios_correo", "borrar"]] as const)
      await assert.rejects(() => como(PERSONAS.ana.id, sql), /permission denied/i, `authenticated no puede ${quien}`);
    await assert.rejects(() => como(PERSONAS.ana.id, "select 1 from public.envios_correo", "anon"), /permission denied/i, "anon no puede ni leer");
    const [{ rls }] = await bd.filas<{ rls: boolean }>("select relrowsecurity as rls from pg_class where oid = 'public.envios_correo'::regclass"); assert.equal(rls, true, "RLS activado");
    const perm = await bd.filas<{ rol: string; permiso: string }>("select rol, permiso from public.rol_permisos where permiso like 'correos.%' order by rol, permiso");
    assert.deepEqual(perm.map((x) => `${x.rol}:${x.permiso}`), ["administrador:correos.enviar", "administrador:correos.reenviar", "administrador:correos.ver", "emisor:correos.enviar", "emisor:correos.ver", "lector:correos.ver", "propietario:correos.enviar", "propietario:correos.reenviar", "propietario:correos.ver"], "permisos por rol");
    for (const [sql, re] of [["update public.envios_correo set destinatario = 'x@ejemplo.com' where id = $1", /FEL_APPEND_ONLY/], ["delete from public.envios_correo where id = $1", /FEL_APPEND_ONLY/], ["update public.envios_correo set estado = 'rechazado' where id = $1", /FEL_ESTADO_INVALIDO/]] as const) await assert.rejects(() => bd.ejecutar(sql, [eid]), re);
  } finally { await bd.cerrar(); await b.limpiar(); }
}});

Deno.test({ name: "correo automático: apagado por defecto; con el interruptor y la casilla se envía al certificar; un fallo del correo no afecta la certificación; sin duplicados", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const certificarAuto = async (c: Cli, clave: string, enviar: boolean | undefined) => {
    const est = (await c.llamar("GET", "/api/estado")).json, cli = est.clientes.find((x: J) => x.nombre.startsWith("Comercial") || x.nombre.startsWith("Distribuidora")), es = est.establecimientos[0];
    const d = await c.llamar("POST", "/api/documentos", { cliente_id: cli.id, establecimiento_id: es.id, fecha: new Date().toISOString().slice(0, 10), lineas: [{ descripcion: "Servicio", cantidad: "1", precio_unitario: "500" }] });
    await c.llamar("POST", `/api/documentos/${d.json.documento.id}/estado`, { estado: "revisado", version: d.json.documento.version });
    const r = await c.llamar("POST", `/api/documentos/${d.json.documento.id}/certificar`, { proveedor: "digifact", escenario: "exito", clave, ...(enviar === undefined ? {} : { enviar_correo: enviar }) });
    return { id: d.json.documento.id as string, r };
  };
  // 1) interruptor APAGADO: aunque la petición lo pida, no se envía nada
  { const { Cli, prov } = await entorno(); const ana = await new Cli("ana").entrar(); assert.equal((await ana.llamar("GET", "/api/correo/estado")).json.automatico, false);
    const x = await certificarAuto(ana, "clave-auto-0001-aaaaa", true); assert.equal(x.r.json.documento.estado_fiscal, "certificado"); assert.equal(x.r.json.correo_auto, null); assert.equal(prov.enviados.length, 0, "apagado por defecto: nada sale"); }
  // 2) interruptor ENCENDIDO
  const { bd, Cli, prov } = await entorno({ FEL_CORREO: "simulado", FEL_CORREO_AUTOMATICO: "habilitado" }); const ana = await new Cli("ana").entrar(), pedro = await new Cli("pedro").entrar();
  assert.equal((await ana.llamar("GET", "/api/correo/estado")).json.automatico, true);
  const sinPedir = await certificarAuto(ana, "clave-auto-0002-aaaaa", undefined); assert.equal(sinPedir.r.json.correo_auto, null); assert.equal(prov.enviados.length, 0, "sin la casilla no se envía");
  const a = await certificarAuto(ana, "clave-auto-0003-aaaaa", true); assert.equal(a.r.status, 200, a.r.texto); assert.equal(a.r.json.correo_auto.estado, "aceptado"); assert.equal(prov.enviados.length, 1);
  const h = (await ana.llamar("GET", `/api/documentos/${a.id}/correos`)).json.envios; assert.equal(h.length, 1); assert.equal(h[0].origen, "automatico");
  assert.equal(prov.enviados[0].adjuntos.length, 2, "adjunta el PDF y el XML certificados");
  // repetir la misma certificación (misma clave de idempotencia) no vuelve a enviar
  const rep = await ana.llamar("POST", `/api/documentos/${a.id}/certificar`, { proveedor: "digifact", escenario: "exito", clave: "clave-auto-0003-aaaaa", enviar_correo: true }); assert.equal(rep.status, 200); assert.equal(prov.enviados.length, 1, "sin duplicados");
  assert.equal((await pedro.llamar("POST", `/api/documentos/${a.id}/certificar`, { proveedor: "digifact", clave: "clave-auto-0003-bbbbb", enviar_correo: true })).status >= 400, true, "el lector no certifica ni dispara correos");
  // un fallo del correo NO afecta la certificación
  prov.siguiente = { estado: "fallido", codigo: "tiempo_agotado" }; const f = await certificarAuto(ana, "clave-auto-0004-aaaaa", true); assert.equal(f.r.json.documento.estado_fiscal, "certificado"); assert.equal(f.r.json.correo_auto.estado, "fallido");
  // receptor sin correo guardado: certifica igual y avisa
  const s = await certificarAuto(ana, "clave-auto-0005-aaaaa", false); await bd.ejecutar("update public.clientes set email = null where id = (select cliente_id from public.documentos where id = $1)", [s.id]);
  const s2 = await certificarAuto(ana, "clave-auto-0006-aaaaa", true); assert.equal(s2.r.json.documento.estado_fiscal, "certificado"); assert.equal(s2.r.json.correo_auto.error, "sin_correo");
}});
