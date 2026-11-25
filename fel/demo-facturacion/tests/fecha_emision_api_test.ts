// Fecha de emisión por la API REAL de la demostración (PostgreSQL real en memoria, reloj del SERVIDOR inyectado, certificador SIMULADO; nada toca la red ni Digifact real).
// Comprueba: hoy y 1–5 días atrás se aceptan; 6 días atrás, el futuro y lo que no es una fecha se rechazan EN EL SERVIDOR (manipulación directa de la API incluida); la fecha por defecto es la de Guatemala (nunca UTC);
// un borrador que vence no se cambia solo y no se revisa ni certifica; los cambios de fecha quedan en la auditoría; un documento certificado no cambia de fecha; y el PDF y el detalle muestran la fecha elegida.
// Uso: deno test -A tests/fecha_emision_api_test.ts
import assert from "node:assert/strict";
import { montar, type J } from "./ayudas_receptor.ts";

const gt = (fechaHora: string) => new Date(`${fechaHora}-06:00`);

Deno.test({ name: "fecha de emisión por la API: ventana de 5 días, zona de Guatemala, validación en el servidor, auditoría e inmutabilidad", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  let reloj = gt("2026-11-25T10:00:00");   // 25/11/2026, 10:00 en Guatemala
  const { bd, Cli } = await montar({ ahora: () => reloj });
  const ana = await new Cli("ana").entrar(), pedro = await new Cli("pedro").entrar();
  const est = (await ana.llamar("GET", "/api/estado")).json, cli = est.clientes.find((c: J) => c.nombre.startsWith("Comercial") || c.nombre.startsWith("Distribuidora")), es = est.establecimientos[0];
  const cuerpo = (extra: J = {}) => ({ cliente_id: cli.id, establecimiento_id: es.id, lineas: [{ descripcion: "Servicio de prueba", cantidad: "2", precio_unitario: "50" }], ...extra });
  const crear = (extra: J = {}) => ana.llamar("POST", "/api/documentos", cuerpo(extra));
  const guardada = async (id: string) => (await bd.filas<{ f: string }>("select fecha_emision_prevista::text as f from public.documentos where id = $1", [id]))[0].f;
  const auditoria = async (id: string) => await bd.filas<{ accion: string; datos: J }>("select accion, datos from public.auditoria where entidad = 'documento' and entidad_id = $1 and accion like 'documento.fecha_emision%' order by id", [id]);

  // ---- la ventana la publica el SERVIDOR (el reloj del dispositivo no cuenta)
  assert.deepEqual((await ana.llamar("GET", "/api/fecha-emision")).json, { hoy: "2026-11-25", minima: "2026-11-20", maxDias: 5 });
  assert.equal((await new Cli("ana").llamar("GET", "/api/fecha-emision")).status, 401, "sin sesión no hay acceso");

  // ---- hoy y de 1 a 5 días atrás: aceptadas y guardadas tal cual
  for (let n = 0; n <= 5; n++) {
    const f = `2026-11-${25 - n}`, r = await crear({ fecha: f }); assert.equal(r.status, 200, `${n} días atrás: ${r.texto}`);
    assert.equal(await guardada(r.json.documento.id), f); assert.equal(String(r.json.documento.fecha_emision_prevista).slice(0, 10), f);
  }
  // ---- 6 días atrás, el futuro y lo que no es una fecha: se rechazan en el servidor, también por una petición directa (sin interfaz); no se crea nada
  const antes = Number((await bd.filas<{ n: string }>("select count(*)::text as n from public.documentos"))[0].n);
  for (const [fecha, texto] of [["2026-11-19", /anterior al 20\/11\/2026/], ["2026-11-26", /no puede ser futura/], ["2027-01-01", /no puede ser futura/], ["2026-02-31", /no existe/], ["25/11/2026", /formato/], ["2026-11-5", /formato/], ["hoy", /formato/], [20261125, /formato/], [{ a: 1 }, /formato/]] as const) {
    const r = await crear({ fecha }); assert.equal(r.status, 422, `${JSON.stringify(fecha)}: ${r.texto}`); assert.match(r.texto, texto); assert.equal(r.json.codigo, "fecha_emision");
  }
  assert.equal(Number((await bd.filas<{ n: string }>("select count(*)::text as n from public.documentos"))[0].n), antes, "ninguna petición rechazada dejó un documento");

  // ---- sin fecha: la de hoy EN GUATEMALA según el servidor (a las 22:30 de Guatemala UTC ya es el día siguiente)
  reloj = gt("2026-11-24T22:30:00");
  assert.equal((await ana.llamar("GET", "/api/fecha-emision")).json.hoy, "2026-11-24");
  const sinFecha = await crear(); assert.equal(sinFecha.status, 200); assert.equal(await guardada(sinFecha.json.documento.id), "2026-11-24", "no es la fecha UTC (25)");
  assert.equal((await crear({ fecha: "2026-11-25" })).status, 422, "con UTC, mañana habría parecido hoy");
  assert.equal((await crear({ fecha: "2026-11-24" })).status, 200);

  // ---- borrador cuya fecha vence: NO se cambia sola; se puede seguir editando otra cosa, pero no revisarlo ni certificarlo hasta elegir otra fecha
  reloj = gt("2026-11-24T23:50:00");
  const d = await crear({ fecha: "2026-11-19" }); assert.equal(d.status, 200, "5 días atrás a las 23:50 del 24/11");
  const id = d.json.documento.id as string; let version = d.json.documento.version as number;
  reloj = gt("2026-11-25T00:10:00");   // pasó la medianoche: la fecha ya tiene 6 días
  const obs = await ana.llamar("POST", "/api/documentos", cuerpo({ id, version, fecha: "2026-11-19", observaciones: "solo cambio la observación" })); assert.equal(obs.status, 200, "la misma fecha no se vuelve a juzgar al guardar otra cosa"); version = obs.json.documento.version;
  assert.equal(await guardada(id), "2026-11-19", "la fecha no se cambió sola");
  const rev = await ana.llamar("POST", `/api/documentos/${id}/estado`, { estado: "revisado", version }); assert.equal(rev.status, 422); assert.equal(rev.json.codigo, "fecha_emision"); assert.match(rev.texto, /Elige otra fecha/);
  const cert = await ana.llamar("POST", `/api/documentos/${id}/certificar`, { proveedor: "digifact", clave: "clave-fecha-vencida-001" }); assert.equal(cert.status, 422); assert.equal(cert.json.codigo, "fecha_emision");
  assert.equal((await bd.filas<{ n: string }>("select count(*)::text as n from public.operaciones_fiscales where documento_id = $1", [id]))[0].n, "0", "no se creó ninguna operación fiscal");
  assert.equal((await ana.llamar("POST", "/api/documentos", cuerpo({ id, version, fecha: "2026-11-18" }))).status, 422, "cambiar a otra fecha fuera del plazo también se rechaza");
  const ok = await ana.llamar("POST", "/api/documentos", cuerpo({ id, version, fecha: "2026-11-21" })); assert.equal(ok.status, 200, ok.texto); version = ok.json.documento.version;
  assert.equal(await guardada(id), "2026-11-21");
  // ---- AUDITORÍA: fijada al crear (distinta de hoy) y cambiada después; con anterior, nueva y días atrás
  const aud = await auditoria(id); assert.deepEqual(aud.map((a) => a.accion), ["documento.fecha_emision_fijada", "documento.fecha_emision_cambiada"]);
  assert.equal(aud[0].datos.nueva, "2026-11-19"); assert.equal(aud[0].datos.anterior, null);
  assert.deepEqual([aud[1].datos.anterior, aud[1].datos.nueva, aud[1].datos.dias_atras, aud[1].datos.mes_anterior, aud[1].datos.hoy_servidor], ["2026-11-19", "2026-11-21", 4, false, "2026-11-25"]);
  assert.equal((await auditoria(sinFecha.json.documento.id)).length, 0, "una fecha igual a hoy no genera ruido en la auditoría");
  // ---- ahora sí se revisa, y el PDF y el detalle muestran LA FECHA ELEGIDA (la de emisión), no la de hoy ni la de creación
  const r2 = await ana.llamar("POST", `/api/documentos/${id}/estado`, { estado: "revisado", version }); assert.equal(r2.status, 200, r2.texto);
  const detalle = (await ana.llamar("GET", `/api/documentos/${id}`)).json.documento; assert.equal(String(detalle.fecha_emision_prevista).slice(0, 10), "2026-11-21");
  const [{ creado }] = await bd.filas<{ creado: string }>("select creado_en::date::text as creado from public.documentos where id = $1", [id]); assert.notEqual(creado, "2026-11-21", "la fecha de CREACIÓN es otra cosa que la de emisión elegida");
  const pdf = await ana.llamar("GET", `/api/documentos/${id}/pdf-demo`); assert.equal(pdf.status, 200); assert.ok(pdf.texto.includes("Fecha: 21/11/2026"), `el PDF lleva la fecha de emisión elegida: ${JSON.stringify(pdf.texto.match(/\(Fecha[^)]*\)/g))} · ${pdf.texto.length}`);

  // ---- certificar (SIMULADO) con la fecha vigente: queda certificado; después la fecha ya NO se puede cambiar (ni por la API ni por la base)
  const c = await ana.llamar("POST", `/api/documentos/${id}/certificar`, { proveedor: "digifact", escenario: "exito", clave: "clave-fecha-vigente-0001" }); assert.equal(c.status, 200, c.texto); assert.equal(c.json.documento.estado_fiscal, "certificado");
  assert.equal(String(c.json.documento.fecha_emision_prevista).slice(0, 10), "2026-11-21", "certificar no cambia la fecha de emisión");
  const cambia = await ana.llamar("POST", "/api/documentos", cuerpo({ id, version: c.json.documento.version, fecha: "2026-11-23" })); assert.ok(cambia.status >= 400, `un certificado no se edita: ${cambia.texto}`);
  await assert.rejects(bd.filas("update public.documentos set fecha_emision_prevista = '2026-11-23' where id = $1", [id]), "la base también lo impide");
  assert.equal(await guardada(id), "2026-11-21");
  assert.equal(String(c.json.documento.certificacion_verificada_en ?? "").length > 0, true, "la fecha de certificación es OTRA columna (la asigna el certificador/proceso, no el usuario)");
  const pdfC = await ana.llamar("GET", `/api/documentos/${id}/pdf-demo`); assert.ok(pdfC.texto.includes("Fecha: 21/11/2026"), "certificado: el PDF sigue llevando la fecha de emisión elegida");

  // ---- certificar un documento YA certificado no se juzga de nuevo por la fecha (la reutilización es idempotente) aunque hoy ya esté fuera del plazo
  reloj = gt("2026-12-30T10:00:00");
  const otra = await ana.llamar("POST", `/api/documentos/${id}/certificar`, { proveedor: "digifact", escenario: "exito", clave: "clave-fecha-vigente-0001" }); assert.notEqual(otra.status, 422, `ya certificado: ${otra.texto}`);

  // ---- permisos: el lector no crea documentos aunque mande una fecha válida
  reloj = gt("2026-11-25T10:00:00");
  assert.ok([401, 403].includes((await pedro.llamar("POST", "/api/documentos", cuerpo({ fecha: "2026-11-25" }))).status), "el lector no crea");
}});

Deno.test({ name: "fecha de emisión: cambio de mes y de año con el reloj del servidor", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  let reloj = gt("2026-12-02T09:00:00");
  const { bd, Cli } = await montar({ ahora: () => reloj });
  const ana = await new Cli("ana").entrar();
  const est = (await ana.llamar("GET", "/api/estado")).json, cli = est.clientes.find((c: J) => c.nombre.startsWith("Comercial") || c.nombre.startsWith("Distribuidora")), es = est.establecimientos[0];
  const crear = (fecha: string) => ana.llamar("POST", "/api/documentos", { cliente_id: cli.id, establecimiento_id: es.id, fecha, lineas: [{ descripcion: "Servicio", cantidad: "1", precio_unitario: "10" }] });
  assert.equal((await crear("2026-11-27")).status, 200, "cambio de mes: 5 días atrás"); assert.equal((await crear("2026-11-26")).status, 422);
  const a = await crear("2026-11-30"); assert.equal(a.status, 200);
  const aud = await bd.filas<{ datos: J }>("select datos from public.auditoria where entidad_id = $1 and accion = 'documento.fecha_emision_fijada'", [a.json.documento.id]); assert.equal(aud[0].datos.mes_anterior, true, "se deja constancia de que es de un mes anterior");
  reloj = gt("2027-01-03T09:00:00");
  assert.equal((await crear("2026-12-29")).status, 200, "cambio de año: 5 días atrás"); assert.equal((await crear("2026-12-28")).status, 422); assert.equal((await crear("2026-12-31")).status, 200);
  assert.equal((await ana.llamar("GET", "/api/fecha-emision")).json.minima, "2026-12-29");
}});
