// Historial de documentos PAGINADO Y FILTRADO EN EL SERVIDOR (API real en el mismo proceso, PostgreSQL real en memoria, sin red).
// Comprueba: 25 por página, total y páginas, categorías (emitidos / borradores / anulados / pendientes), filtros (texto, serie, número, UUID, NIT, tipo, estado, fechas),
// parámetros hostiles ignorados o acotados, aislamiento entre empresas, y que sin «pagina» la lista antigua (arreglo) sigue igual.
// Uso: deno test -A tests/lista_paginada_api_test.ts
import assert from "node:assert/strict";
import { crearBd } from "../src/bd_memoria.ts";
import { prepararBase } from "../src/aprovisionar.ts";
import { crearApi } from "../src/api.ts";
import { Sesiones } from "../src/sesiones.ts";
import { AlmacenMemoria } from "../src/almacen.ts";
import { PERSONAS, CLAVE_DEMO } from "../src/mundo_practico.ts";

type J = Record<string, any>; // deno-lint-ignore no-explicit-any
const AUT = "62496FB5-75B4-4C75-83FA-DFBEF92DE92D";

Deno.test({ name: "historial paginado en el servidor: páginas, categorías, filtros, parámetros hostiles y aislamiento", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const bd = await crearBd(); const mundo = await prepararBase(bd, { sembrar: true });
  const sesiones = new Sesiones(undefined, new AlmacenMemoria(PERSONAS)); sesiones.claveDemoPublica = CLAVE_DEMO;
  for (const k of Object.keys(PERSONAS)) await sesiones.registrar(k, CLAVE_DEMO, PERSONAS[k]);
  const api = crearApi(bd, mundo, { sesiones, practico: true });
  class Cli { cookie = ""; constructor(public usuario: string) {}
    async llamar(m: string, ruta: string, cuerpo?: unknown) {
      const r = await api(new Request("http://127.0.0.1" + ruta, { method: m, headers: { "x-demo": "1", "content-type": "application/json", ...(this.cookie ? { cookie: this.cookie } : {}) }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) }));
      const sc = r.headers.get("set-cookie"); if (sc) this.cookie = sc.split(";")[0];
      const t = await r.text(); let json: J = {}; try { json = JSON.parse(t); } catch { /* sin cuerpo */ }
      return { status: r.status, json };
    }
    async entrar() { assert.equal((await this.llamar("POST", "/api/sesion/entrar", { usuario: this.usuario, clave: CLAVE_DEMO })).status, 200); return this; } }
  const ana = await new Cli("ana").entrar(), sofia = await new Cli("sofia").entrar();
  const est = (await ana.llamar("GET", "/api/estado")).json, cli = est.clientes.find((c: J) => c.tipo_identificacion === "NIT") ?? est.clientes[0], es = est.establecimientos[0];
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala" }).format(new Date());
  const nuevo = async (precio: string) => (await ana.llamar("POST", "/api/documentos", { cliente_id: cli.id, establecimiento_id: es.id, lineas: [{ descripcion: "Servicio", cantidad: "1", precio_unitario: precio }], fecha: hoy })).json.documento.id as string;
  const ids: string[] = []; for (let i = 1; i <= 30; i++) ids.push(await nuevo(String(10 + i)));   // 30 borradores
  // 6 certificados (serie/número/UUID distintos), 1 anulado, 1 por verificar
  const fiscal = async (id: string, sql: string, args: unknown[] = []) => { await bd.ejecutar("select set_config('fel.op_fiscal', 'on', false)"); await bd.ejecutar(sql, [id, ...args]); await bd.ejecutar("select set_config('fel.op_fiscal', 'off', false)"); };
  const certificar = async (id: string, serie: string, num: string, aut: string) => {
    await fiscal(id, "update public.documentos set estado_preparacion = 'revisado' where id = $1"); await fiscal(id, "update public.documentos set estado_fiscal = 'pendiente_certificacion' where id = $1");
    await fiscal(id, "update public.documentos set estado_fiscal = 'certificado', serie = $2, numero_fiscal = $3, autorizacion_sat = $4, certificacion_verificada_en = now() where id = $1", [serie, num, aut]);
  };
  for (let i = 0; i < 6; i++) await certificar(ids[i], "SERIE" + String(i).padStart(2, "0"), String(1000 + i), i === 0 ? AUT : `0000000${i}-75B4-4C75-83FA-DFBEF92DE92D`);
  await fiscal(ids[6], "update public.documentos set estado_preparacion = 'revisado' where id = $1"); await fiscal(ids[6], "update public.documentos set estado_fiscal = 'pendiente_certificacion' where id = $1"); await fiscal(ids[6], "update public.documentos set estado_fiscal = 'por_verificar' where id = $1");
  const L = async (q: string, u: Cli = ana) => { const r = await u.llamar("GET", "/api/documentos?pagina=1" + (q ? "&" + q : "")); assert.equal(r.status, 200, q + " " + JSON.stringify(r.json)); return r.json; };

  // páginas de 25
  let r = await L("categoria=borradores");
  assert.equal(r.tam, 25); assert.equal(r.total, 23, "30 − 6 certificados − 1 por verificar = 23 borradores"); assert.equal(r.items.length, 23);
  const base = r.total; 
  r = await L("categoria=todos"); assert.equal(r.items.length, 25); assert.ok(r.total >= 30); assert.equal(r.paginas, Math.ceil(r.total / 25));
  const p2 = (await ana.llamar("GET", "/api/documentos?pagina=2&categoria=todos")).json; assert.equal(p2.pagina, 2); assert.equal(p2.items.length, r.total - 25);
  assert.equal(new Set([...r.items, ...p2.items].map((d: J) => d.id)).size, r.total, "las páginas no repiten ni omiten documentos");
  assert.equal((await ana.llamar("GET", "/api/documentos?pagina=999&categoria=todos")).json.pagina, r.paginas, "una página fuera de rango se acota a la última");
  assert.equal((await L("tam=5")).items.length, 5); assert.equal((await L("tam=100000")).tam, 100, "el tamaño máximo es 100"); assert.equal((await L("tam=0")).tam, 1);
  // categorías y conteos
  const e = await L("categoria=emitidos"); assert.equal(e.total, 6); assert.ok(e.items.every((d: J) => d.estado_fiscal === "certificado")); assert.equal(e.conteos.emitidos, 6);
  const pe = await L("categoria=pendientes"); assert.ok(pe.items.some((d: J) => d.id === ids[6] && d.estado_fiscal === "por_verificar"), "lo pendiente de verificar nunca queda oculto"); assert.ok(pe.conteos.pendientes >= 1);
  assert.equal((await L("categoria=anulados")).total, 0);
  // filtros: texto (serie, número fiscal, UUID, BR), NIT, tipo, estado, fechas
  assert.equal((await L("categoria=emitidos&q=SERIE03")).total, 1); assert.equal((await L("q=1004")).items[0].numero_fiscal, "1004");
  assert.equal((await L("q=" + AUT.toLowerCase())).total, 1, "búsqueda por UUID sin distinguir mayúsculas"); assert.equal((await L("q=" + AUT.slice(0, 8))).total, 1);
  const br = (await L("categoria=todos&tam=100")).items.find((d: J) => d.id === ids[2]).numero_borrador; assert.equal((await L("q=BR-" + String(br).padStart(4, "0"))).items[0].id, ids[2]);
  assert.ok((await L("nit=" + String(cli.numero_identificacion).slice(0, 3))).total >= 30); assert.equal((await L("nit=ZZZ999")).total, 0);
  assert.ok((await L("tipo=FACT")).total >= 30); assert.equal((await L("tipo=NCRE")).total, 0);
  assert.equal((await L("estado=certificado")).total, 6); assert.equal((await L("estado=por_verificar")).total, 1);
  assert.ok((await L(`desde=${hoy}&hasta=${hoy}`)).total >= 30); assert.equal((await L("desde=2000-01-01&hasta=2000-01-02")).total, 0);
  // parámetros hostiles: se ignoran o se acotan; el servidor no falla ni ejecuta nada
  for (const q of ["q=%27%3B%20drop%20table%20public.documentos%3B--", "q=%25%25%25", "q=_", "estado=x%27%20or%201%3D1", "tipo=FACT%27--", "categoria=todos%27", "desde=no-es-fecha", "nit=%27%20or%20%271%27%3D%271", "pagina=-3", "tam=abc"]) {
    const j = await L(q); assert.ok(Array.isArray(j.items) && Number.isInteger(j.total), q);
  }
  assert.equal((await L("q=%25%25%25")).total, 0, "los comodines del texto buscado se tratan como texto"); assert.ok((await L("categoria=todos")).total >= 30, "la tabla sigue íntegra");
  // aislamiento: otra empresa no ve nada de esta; sin sesión no hay acceso
  const o = await L("categoria=todos&q=SERIE", sofia); assert.equal(o.total, 0); assert.equal(o.conteos.emitidos, 0);
  const sin = await api(new Request("http://127.0.0.1/api/documentos?pagina=1", { headers: { "x-demo": "1" } })); assert.ok(sin.status === 401 || sin.status === 403);
  // compatibilidad: sin «pagina» sigue devolviendo el arreglo completo (lo usa el indicador de pendientes)
  assert.ok(Array.isArray((await ana.llamar("GET", "/api/documentos")).json));
} });
