// MATRIZ de PDF y tickets por la API real (PostgreSQL real en memoria, sin red): para cada tipo (FACT, NCRE, NDEB, RECI) y cada estado (borrador, revisado, certificado simulado,
// certificado en TEST, anulado) se pide la hoja carta y el ticket de 80 mm y se comprueba: PDF válido, tamaño de página (carta 612×792; ticket de 226 pt de ancho), rótulos de
// ambiente («sin valor fiscal»; PRUEBA frente a SIMULADO), serie, número y UUID del documento certificado, importes, referencia de las notas, marca ANULADO, permisos y aislamiento.
// Uso: deno test -A tests/pdf_matriz_api_test.ts
import assert from "node:assert/strict";
import { crearBd } from "../src/bd_memoria.ts";
import { prepararBase } from "../src/aprovisionar.ts";
import { crearApi } from "../src/api.ts";
import { Sesiones } from "../src/sesiones.ts";
import { AlmacenMemoria } from "../src/almacen.ts";
import { PERSONAS, CLAVE_DEMO } from "../src/mundo_practico.ts";

type J = Record<string, any>; // deno-lint-ignore no-explicit-any
const UUID_TEST = "62496FB5-75B4-4C75-83FA-DFBEF92DE92D";

/** Texto de un PDF generado por pdf_demo.ts: sus cadenas viajan sin comprimir en los operadores «(…) Tj». */
function textoPdf(b: Uint8Array): string { const s = new TextDecoder("latin1").decode(b); return [...s.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)].map((m) => m[1].replace(/\\([0-7]{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8))).replace(/\\([()\\])/g, "$1")).join("\n"); }
function mediaBox(b: Uint8Array): [number, number] { const m = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(new TextDecoder("latin1").decode(b)); assert.ok(m, "el PDF declara su tamaño de página"); return [Number(m![1]), Number(m![2])]; }

Deno.test({ name: "matriz de PDF y tickets: tipos × estados × formatos, rótulos, datos fiscales, permisos y aislamiento", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const bd = await crearBd(); const mundo = await prepararBase(bd, { sembrar: true });
  const sesiones = new Sesiones(undefined, new AlmacenMemoria(PERSONAS)); sesiones.claveDemoPublica = CLAVE_DEMO;
  for (const k of Object.keys(PERSONAS)) await sesiones.registrar(k, CLAVE_DEMO, PERSONAS[k]);
  const api = crearApi(bd, mundo, { sesiones, practico: true });
  class Cli { cookie = ""; constructor(public usuario: string) {}
    async crudo(m: string, ruta: string, cuerpo?: unknown) {
      const r = await api(new Request("http://127.0.0.1" + ruta, { method: m, headers: { "x-demo": "1", "content-type": "application/json", ...(this.cookie ? { cookie: this.cookie } : {}) }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) }));
      const sc = r.headers.get("set-cookie"); if (sc) this.cookie = sc.split(";")[0]; return r;
    }
    async llamar(m: string, ruta: string, cuerpo?: unknown) { const r = await this.crudo(m, ruta, cuerpo); const t = await r.text(); let json: J = {}; try { json = JSON.parse(t); } catch { /* sin cuerpo */ } return { status: r.status, json }; }
    async entrar() { assert.equal((await this.llamar("POST", "/api/sesion/entrar", { usuario: this.usuario, clave: CLAVE_DEMO })).status, 200); return this; } }
  const ana = await new Cli("ana").entrar(), pedro = await new Cli("pedro").entrar(), sofia = await new Cli("sofia").entrar();
  const est = (await ana.llamar("GET", "/api/estado")).json, cli = est.clientes.find((c: J) => c.tipo_identificacion === "NIT") ?? est.clientes[0], es = est.establecimientos[0];
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala" }).format(new Date());
  const nuevo = async (precio: string, extra: J = {}) => { const r = await ana.llamar("POST", "/api/documentos", { cliente_id: cli.id, establecimiento_id: es.id, lineas: [{ descripcion: "Servicio de prueba", cantidad: "2", precio_unitario: precio }], fecha: hoy, ...extra }); assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json.documento.id as string; };
  const fiscal = async (id: string, sql: string, args: unknown[] = []) => { await bd.ejecutar("select set_config('fel.op_fiscal', 'on', false)"); await bd.ejecutar(sql, [id, ...args]); await bd.ejecutar("select set_config('fel.op_fiscal', 'off', false)"); };
  const revisar = async (id: string) => { const d = (await ana.llamar("GET", `/api/documentos/${id}`)).json.documento; assert.equal((await ana.llamar("POST", `/api/documentos/${id}/estado`, { estado: "revisado", version: d.version })).status, 200); };
  const certificar = async (id: string, serie: string, num: string, aut: string) => {
    await fiscal(id, "update public.documentos set estado_fiscal = 'pendiente_certificacion' where id = $1");
    await fiscal(id, "update public.documentos set estado_fiscal = 'certificado', serie = $2, numero_fiscal = $3, autorizacion_sat = $4, certificacion_verificada_en = now() where id = $1", [serie, num, aut]);
  };
  for (const t of ["NCRE", "NDEB"]) assert.equal((await ana.llamar("POST", "/api/tipos-documento", { tipo: t, habilitado: true })).status, 200);
  assert.equal((await ana.llamar("POST", "/api/tipos-documento", { tipo: "RECI", habilitado: true, base_habilitacion: "Base de prueba (no es una resolución real)" })).status, 200);

  const pdf = async (u: Cli, id: string, fmt: string) => { const r = await u.crudo("GET", `/api/documentos/${id}/pdf-demo?formato=${fmt}`); return { r, bytes: new Uint8Array(await r.arrayBuffer()) }; };
  const verificar = async (nombre: string, id: string, esperado: { simulado?: boolean; prueba?: boolean; serie?: string; numero?: string; uuid?: string; anulado?: boolean; titulo?: RegExp; extra?: RegExp[] }) => {
    for (const fmt of ["carta", "ticket"]) {
      const { r, bytes } = await pdf(ana, id, fmt); assert.equal(r.status, 200, `${nombre} ${fmt}`); assert.equal(r.headers.get("content-type"), "application/pdf"); assert.equal(r.headers.get("cache-control"), "no-store"); assert.equal(r.headers.get("x-content-type-options"), "nosniff");
      assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-", `${nombre} ${fmt}: cabecera PDF`); assert.ok(new TextDecoder("latin1").decode(bytes.slice(-8)).includes("%%EOF"), `${nombre} ${fmt}: PDF completo`); assert.ok(bytes.length > 1000);
      const [w, h] = mediaBox(bytes); if (fmt === "carta") { assert.equal(w, 612, `${nombre}: carta 612 pt de ancho`); assert.equal(h, 792); } else { assert.ok(Math.abs(w - 226) <= 1, `${nombre}: ticket de 80 mm (≈226 pt), medido ${w}`); assert.ok(h > 200); }
      const t = textoPdf(bytes), todo = t.toUpperCase();
      assert.match(todo, /SIN VALOR FISCAL|NO FISCAL|NO ES UNA FACTURA|NO ES UN DTE/, `${nombre} ${fmt}: rótulo de que no tiene valor fiscal`);
      if (esperado.prueba) { assert.match(todo, /PRUEBA/, `${nombre} ${fmt}: rotulado PRUEBA (Digifact TEST)`); assert.ok(!/DOCUMENTO NO FISCAL/.test(todo) || /PRUEBA/.test(todo)); }
      if (esperado.simulado) assert.match(todo, /SIMULAD|DOCUMENTO NO FISCAL/, `${nombre} ${fmt}: rotulado simulado`);
      if (esperado.serie) assert.ok(t.includes(esperado.serie), `${nombre} ${fmt}: serie ${esperado.serie}`); if (esperado.numero) assert.ok(t.includes(esperado.numero), `${nombre} ${fmt}: número ${esperado.numero}`);
      if (esperado.uuid) assert.ok(t.replace(/\s+/g, "").includes(esperado.uuid), `${nombre} ${fmt}: UUID completo (aunque se parta en líneas)`);
      if (esperado.anulado) assert.match(todo, /ANULADO/, `${nombre} ${fmt}: marca ANULADO`); else assert.ok(!/ANULADO/.test(todo), `${nombre} ${fmt}: sin marca ANULADO`);
      if (esperado.titulo) assert.match(t, esperado.titulo, `${nombre} ${fmt}: título del documento\n${t.slice(0, 900)}`);
      for (const x of esperado.extra ?? []) assert.match(t, x, `${nombre} ${fmt}: ${x}`);
      assert.match(t, /Q\s?400\.00|400\.00/, `${nombre} ${fmt}: total 2 × 200`);
    }
  };

  // ---- FACT en todos sus estados
  const fb = await nuevo("200"); await verificar("FACT borrador", fb, { simulado: true });
  const fr = await nuevo("200"); await revisar(fr); await verificar("FACT revisado", fr, { simulado: true });
  const fs = await nuevo("200"); await revisar(fs); await certificar(fs, "SIMD", "00000007", "SIM-8510EF1B-E838-9C32-EB5C-712D13D68381"); await verificar("FACT certificado simulado", fs, { simulado: true, serie: "SIMD", numero: "00000007" });
  const ft = await nuevo("200"); await revisar(ft); await certificar(ft, "62496FB5", "1974750325", UUID_TEST); await verificar("FACT certificado TEST", ft, { prueba: true, serie: "62496FB5", numero: "1974750325", uuid: UUID_TEST });
  const fa = await nuevo("200"); await revisar(fa); await certificar(fa, "62496FB5", "1974750399", "11111111-75B4-4C75-83FA-DFBEF92DE92D");
  await fiscal(fa, "update public.documentos set estado_fiscal = 'anulacion_solicitada', anulacion_solicitada_en = now() where id = $1"); await fiscal(fa, "update public.documentos set estado_fiscal = 'anulado', anulado_en = now() where id = $1");
  await verificar("FACT anulado", fa, { prueba: true, anulado: true, serie: "62496FB5", numero: "1974750399" });

  // ---- notas y recibo (el origen es la FACT certificada en TEST): título del tipo, referencia al origen, motivo y tipo de recibo
  const nc = await nuevo("200", { tipo_dte: "NCRE", documento_origen_id: ft, motivo_ajuste: "Devolución de mercadería" });
  await verificar("NCRE borrador", nc, { simulado: true, titulo: /NOTA DE CR[ÉE]DITO|Nota de cr[ée]dito/i, extra: [/62496FB5/, /1974750325/, /Devoluci[óo]n de mercader/] });
  await revisar(nc); await verificar("NCRE revisada", nc, { simulado: true, extra: [/62496FB5/] });
  const nd = await nuevo("200", { tipo_dte: "NDEB", documento_origen_id: ft, motivo_ajuste: "Cargo adicional por flete" });
  await verificar("NDEB borrador", nd, { simulado: true, titulo: /NOTA DE D[ÉE]BITO|Nota de d[ée]bito/i, extra: [/62496FB5/, /Cargo adicional/] });
  const rc = await nuevo("200", { tipo_dte: "RECI", tipo_recibo: "Colegio" });
  await verificar("RECI borrador", rc, { simulado: true, titulo: /RECIBO|Recibo/, extra: [/Colegio/] });
  // los tipos que todavía no certifican se rotulan «en pruebas» y jamás aparentan ser una factura
  for (const [id, n] of [[nc, "NCRE"], [nd, "NDEB"], [rc, "RECI"]] as const) { const t = textoPdf((await pdf(ana, id, "carta")).bytes).toUpperCase(); assert.match(t, /PRUEBAS|EN PRUEBAS|NO ES UNA FACTURA|NO ES UN DTE/, `${n}: se anuncia como tipo en pruebas`); }

  // ---- formato, permisos y aislamiento
  assert.equal((await ana.crudo("GET", `/api/documentos/${ft}/pdf-demo?formato=a4`)).status, 400, "formato no válido");
  assert.equal((await ana.crudo("GET", `/api/documentos/${ft}/pdf-demo`)).status, 200, "sin formato = carta");
  assert.equal((await pedro.crudo("GET", `/api/documentos/${ft}/pdf-demo?formato=carta`)).status, 200, "el lector puede ver el PDF (solo lectura)");
  assert.equal((await ana.crudo("GET", `/api/documentos/${crypto.randomUUID()}/pdf-demo`)).status, 404, "documento inexistente");
  const otra = await sofia.crudo("GET", `/api/documentos/${ft}/pdf-demo?formato=carta`); assert.ok([403, 404].includes(otra.status), `otra empresa no obtiene el PDF (${otra.status})`);
  assert.equal((await api(new Request(`http://127.0.0.1/api/documentos/${ft}/pdf-demo`, { headers: { "x-demo": "1" } }))).status >= 400, true, "sin sesión no hay PDF");

  // ---- inyección: el texto del usuario no rompe el PDF ni se interpreta como operadores
  const linea = (d: string) => ({ cliente_id: cli.id, establecimiento_id: es.id, fecha: hoy, lineas: [{ descripcion: d, cantidad: "1", precio_unitario: "5" }] });
  assert.equal((await ana.llamar("POST", "/api/documentos", linea("con control \u0000 NUL"))).status, 400, "los caracteres de control se rechazan en el servidor");
  const peligro = await ana.llamar("POST", "/api/documentos", linea("Mal) Tj ET BT (inyectado \\) \\( ñ á é"));
  assert.equal(peligro.status, 200, JSON.stringify(peligro.json)); const pp = await pdf(ana, peligro.json.documento.id, "carta"); assert.equal(pp.r.status, 200); assert.equal(new TextDecoder().decode(pp.bytes.slice(0, 5)), "%PDF-");
  const crudoPdf = new TextDecoder("latin1").decode(pp.bytes); assert.ok(!/\)\s*Tj\s*ET\s*BT\s*\(inyectado/.test(crudoPdf), "los paréntesis y las barras del usuario quedan escapados");
  const pt = await pdf(ana, peligro.json.documento.id, "ticket"); assert.equal(pt.r.status, 200);
} });
