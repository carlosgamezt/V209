// PRUEBA DE HUMO de la demostración publicada (la ejecuta quien despliega, contra la dirección privada real o contra la cadena local):
//   FEL_DEMO_URL=https://<nombre>.pages.dev FEL_DEMO_CLAVES='ana=…,…' [FEL_DEMO_MFA_SEMILLAS='maestro=…'] deno run -A nube/prueba_humo.ts
// Recorre: protecciones externas, inicio de sesión (y MFA del administrador), factura con varios ítems, certificación SIMULADA, PDF de demostración, cierre de sesión, nuevo inicio y persistencia.
// No imprime contraseñas, códigos ni cookies. Solo crea datos simulados de la demostración.
import { codigo } from "../src/totp.ts";
const url = (Deno.env.get("FEL_DEMO_URL") ?? "").replace(/\/$/, ""); if (!url) { console.error("Falta FEL_DEMO_URL."); Deno.exit(1); }
const pares = (s?: string) => Object.fromEntries((s ?? "").split(",").filter(Boolean).map((x) => { const i = x.indexOf("="); return [x.slice(0, i), x.slice(i + 1)]; }));
const claves = pares(Deno.env.get("FEL_DEMO_CLAVES")), semillas = pares(Deno.env.get("FEL_DEMO_MFA_SEMILLAS"));
if (!claves.ana) { console.error("Falta la contraseña de «ana» en FEL_DEMO_CLAVES."); Deno.exit(1); }
const fallos: string[] = []; const ok = (c: boolean, m: string) => { console.log(`${c ? "OK   " : "FALLO"} ${m}`); if (!c) fallos.push(m); };
type J = Record<string, any>; // deno-lint-ignore no-explicit-any
class Cli { cookie = "";
  async ll(m: string, ruta: string, cuerpo?: unknown) { const r = await fetch(url + ruta, { method: m, redirect: "manual", headers: { "x-demo": "1", "content-type": "application/json", ...(this.cookie ? { cookie: this.cookie } : {}) }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
    const sc = r.headers.get("set-cookie"); if (sc) this.cookie = sc.split(";")[0]; const buf = new Uint8Array(await r.arrayBuffer()); let json: J = {}; try { json = JSON.parse(new TextDecoder().decode(buf)); } catch { /* binario */ } return { status: r.status, json, r, buf }; } }

// 1) protecciones visibles desde fuera
const c0 = new Cli(); const s0 = await c0.ll("GET", "/api/sesion"); ok(s0.status === 200 && s0.json.autenticado === false, "la API responde y no hay sesión");
ok((s0.json.clave_demo ?? null) === null, "no se ofrece ninguna contraseña pública");
ok(!!s0.r.headers.get("strict-transport-security") || url.startsWith("http://"), "HSTS presente (HTTPS)");
ok(s0.r.headers.get("access-control-allow-origin") === null, "sin CORS abierto");
ok((await c0.ll("GET", "/api/estado")).status === 401, "sin sesión no hay datos");
ok((await new Cli().ll("POST", "/api/sesion/entrar", { usuario: "ana", clave: "demo1234" })).status === 401, "la contraseña pública no sirve");
const robots = await fetch(url + "/robots.txt"); ok(robots.status === 200 && /Disallow: \//.test(await robots.text()), "robots.txt impide la indexación");

// 2) recorrido de una persona de empresa
const ana = new Cli(); const ent = await ana.ll("POST", "/api/sesion/entrar", { usuario: "ana", clave: claves.ana }); ok(ent.status === 200, "ana inicia sesión");
const sc = ent.r.headers.get("set-cookie") ?? ""; ok(/HttpOnly/i.test(sc) && /SameSite=Strict/i.test(sc) && (/Secure/i.test(sc) || url.startsWith("http://")), "cookie HttpOnly + SameSite=Strict + Secure");
const est = (await ana.ll("GET", "/api/estado")).json; ok(!!est.clientes?.length && !!est.establecimientos?.length, "datos de la empresa visibles");
const d = await ana.ll("POST", "/api/documentos", { cliente_id: est.clientes[0].id, establecimiento_id: est.establecimientos[0].id, fecha: new Date().toISOString().slice(0, 10), lineas: [{ descripcion: "Prueba de humo A", cantidad: "2", precio_unitario: "100.00" }, { descripcion: "Prueba de humo B", cantidad: "1", precio_unitario: "50.00" }] });
ok(d.status === 200, "factura con varios ítems creada"); const id = d.json.documento?.id;
if (id) {
  await ana.ll("POST", `/api/documentos/${id}/estado`, { estado: "revisado", version: d.json.documento.version });
  const cert = await ana.ll("POST", `/api/documentos/${id}/certificar`, { proveedor: "digifact", escenario: "exito", clave: `humo-${crypto.randomUUID().slice(0, 18)}` }); ok(cert.json.documento?.estado_fiscal === "certificado", "certificación SIMULADA");
  const pdf = await ana.ll("GET", `/api/documentos/${id}/pdf-demo`); ok(pdf.status === 200 && new TextDecoder().decode(pdf.buf.slice(0, 4)) === "%PDF", "PDF de demostración descargable");
  ok(/NO FISCAL|SIMULADO/i.test(new TextDecoder("latin1").decode(pdf.buf)), "el PDF está marcado como NO FISCAL");
  await ana.ll("POST", "/api/sesion/salir", {}); ok((await ana.ll("GET", "/api/estado")).status === 401, "al cerrar sesión se pierde el acceso");
  const ana2 = new Cli(); await ana2.ll("POST", "/api/sesion/entrar", { usuario: "ana", clave: claves.ana });
  const otra = await ana2.ll("GET", `/api/documentos/${id}`); ok(otra.json.documento?.estado_fiscal === "certificado", "PERSISTENCIA: tras volver a entrar, la factura certificada sigue ahí");
  ok(((await ana2.ll("GET", "/api/plan")).json.consumos ?? []).length >= 1, "el consumo y el monedero quedaron registrados");
  await ana2.ll("POST", "/api/sesion/salir", {});
}
// 3) administrador de la plataforma con MFA (si se dieron las semillas)
if (claves.maestro && semillas.maestro) {
  const m = new Cli(); const sin = await m.ll("POST", "/api/sesion/entrar", { usuario: "maestro", clave: claves.maestro }); ok(sin.json.codigo === "mfa_requerido", "el administrador exige el segundo factor");
  ok((await m.ll("POST", "/api/sesion/entrar", { usuario: "maestro", clave: claves.maestro, codigo: "000000" })).status === 401, "un código MFA incorrecto se rechaza");
  const bien = await m.ll("POST", "/api/sesion/entrar", { usuario: "maestro", clave: claves.maestro, codigo: await codigo(semillas.maestro) }); ok(bien.status === 200, "el administrador entra con su código");
  ok((await m.ll("GET", "/api/plataforma/resumen")).status === 200, "el administrador ve la plataforma"); await m.ll("POST", "/api/sesion/salir", {});
}
if (fallos.length) { console.error(`\n${fallos.length} comprobación(es) fallaron:`, fallos); Deno.exit(1); }
console.log("\nPRUEBA DE HUMO OK");
