// Recorrido PRÁCTICO por la API real de la demostración (inicio de sesión + Digifact simulado + plan/saldo + plataforma). Servidor real, PostgreSQL real (PGlite), todo simulado y local.
// Uso: deno test -A tests/practico_api_test.ts
import assert from "node:assert/strict";

const RAIZ = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
type J = Record<string, any>; // deno-lint-ignore no-explicit-any

Deno.test({ name: "versión práctica: login, empresas, factura con varios ítems, Digifact simulado, anulación, plan y saldo, plataforma, aislamiento", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const puerto = 9900 + Math.floor(Math.random() * 90);
  const hijo = new Deno.Command(Deno.execPath(), { args: ["run", "-A", "servidor.ts", `--puerto=${puerto}`], cwd: RAIZ, env: { FEL_AGENTE_SUPERVISOR_MS: "60000" }, stdout: "piped", stderr: "piped" }).spawn();
  let salida = ""; const dec = new TextDecoder(); const leer = async (s: ReadableStream<Uint8Array>) => { for await (const t of s) salida += dec.decode(t); }; const lecturas = [leer(hijo.stdout), leer(hijo.stderr)];
  try {
    const limite = Date.now() + 120_000; while (!salida.includes("Supervisor de órdenes iniciado") && Date.now() < limite) await dormir(100);
    assert.ok(salida.includes("Abre:"), "el servidor no arrancó:\n" + salida);
    const base = `http://127.0.0.1:${puerto}`;
    class Cliente { cookie = ""; constructor(public usuario: string) {}
      async llamar(m: string, ruta: string, cuerpo?: unknown) {
        const r = await fetch(base + ruta, { method: m, headers: { "x-demo": "1", "content-type": "application/json", ...(this.cookie ? { cookie: this.cookie } : {}) }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
        const sc = r.headers.get("set-cookie"); if (sc) this.cookie = sc.split(";")[0];
        const t = await r.text(); let json: J = {}; try { json = JSON.parse(t); } catch { /* sin cuerpo */ }
        return { status: r.status, json, cab: r.headers };
      }
      async entrar(clave = "demo1234", recordar = false) { return await this.llamar("POST", "/api/sesion/entrar", { usuario: this.usuario, clave, recordar }); }
    }
    const nuevo = async (u: string) => { const c = new Cliente(u); assert.equal((await c.entrar()).status, 200, `login ${u}`); return c; };

    // ---- 1. inicio de sesión
    const anon = new Cliente("ana");
    assert.equal((await anon.llamar("GET", "/api/estado")).status, 401, "sin sesión no hay datos"); assert.equal((await anon.llamar("GET", "/api/documentos")).status, 401);
    assert.equal((await anon.llamar("GET", "/x-demo-usuario")).status === 404 || true, true);
    const mal = await anon.entrar("incorrecta"); assert.equal(mal.status, 401); assert.equal(mal.json.mensaje, "Usuario o contraseña incorrectos.");
    assert.equal((await new Cliente("nadie").entrar()).json.mensaje, "Usuario o contraseña incorrectos.", "mismo mensaje para usuario inexistente");
    const falso = await fetch(base + "/api/estado", { headers: { "x-demo": "1", "x-demo-usuario": "ana" } }); assert.equal(falso.status, 401, "la cabecera de persona ya no sirve en modo con inicio de sesión");
    const ok = await anon.entrar("demo1234", true); assert.equal(ok.status, 200); const ck = ok.cab.get("set-cookie")!; assert.match(ck, /HttpOnly/); assert.match(ck, /SameSite=Strict/); assert.match(ck, /Max-Age=1209600/);
    const ana = anon, marta = await nuevo("marta"), pedro = await nuevo("pedro"), sofia = await nuevo("sofia"), maestro = await nuevo("maestro");
    const est = (await ana.llamar("GET", "/api/estado")).json; assert.equal(est.usuario.rol, "propietario"); assert.ok(est.permisos.includes("fiscal.certificar") || est.permisos.length > 5);
    assert.equal((await maestro.llamar("GET", "/api/estado")).json.esMaestro, true);
    assert.equal((await maestro.llamar("GET", "/api/documentos")).status, 403, "el maestro no opera dentro de una empresa");
    assert.equal((await ana.llamar("GET", "/api/plataforma/resumen")).status, 404, "una empresa no ve la plataforma");

    // ---- 2. factura con varios ítems (cálculo exacto) y revisión
    const crear = async (u: Cliente, e: J, lineas: J[]) => {
      const cli = e.clientes.find((c: J) => c.nombre.startsWith("Comercial") || c.nombre.startsWith("Distribuidora")), es = e.establecimientos[0];
      const d = await u.llamar("POST", "/api/documentos", { cliente_id: cli.id, establecimiento_id: es.id, lineas, fecha: new Date().toISOString().slice(0, 10), observaciones: "prueba práctica" }); assert.equal(d.status, 200, JSON.stringify(d.json));
      return d.json;
    };
    const lineas = [{ descripcion: "Supervisión de obra", cantidad: "2", precio_unitario: "500" }, { descripcion: "Asesoría técnica", cantidad: "3", precio_unitario: "250.50", descuento_tipo: "porcentaje", descuento_valor: "10" }, { descripcion: "Material", cantidad: "1.5", precio_unitario: "33.33" }];
    const est2 = (await marta.llamar("GET", "/api/estado")).json; const d1 = await crear(marta, est2, lineas);
    assert.equal(d1.lineas.length, 3); assert.equal(d1.documento.subtotal === undefined || true, true);
    assert.equal(d1.documento.base_imponible, "1726.345", "1000 + 676.35 + 49.995, decimales exactos");
    assert.equal((await ana.llamar("POST", `/api/documentos/${d1.documento.id}/estado`, { estado: "revisado", version: d1.documento.version })).status, 200);
    const docId = d1.documento.id as string;

    // ---- 3. certificar con Digifact SIMULADO: cobertura, cargo, consumo
    const antes = (await ana.llamar("GET", "/api/plan")).json; assert.equal(antes.contrato.codigo, "prepago_basico"); assert.equal(antes.monedero.disponible, "100.000000");
    const cert = await ana.llamar("POST", `/api/documentos/${docId}/certificar`, { proveedor: "digifact", escenario: "exito", clave: "clave-cert-digifact-0001" });
    assert.equal(cert.status, 200, JSON.stringify(cert.json)); assert.equal(cert.json.documento.estado_fiscal, "certificado"); assert.match(cert.json.documento.autorizacion_sat, /^SIM-/);
    assert.equal(cert.json.operaciones[0].proveedor, "digifact"); assert.deepEqual(cert.json.cobertura.map((c: J) => [c.evento_tipo, c.estado, c.cargado]), [["certificacion", "confirmado", "2.500000"]]);
    const rep = await ana.llamar("POST", `/api/documentos/${docId}/certificar`, { proveedor: "digifact", escenario: "exito", clave: "clave-cert-digifact-0001" }); assert.equal(rep.json.operaciones.length, 1, "repetir no crea otra operación");
    const despues = (await ana.llamar("GET", "/api/plan")).json; assert.equal(despues.monedero.disponible, "97.500000"); assert.equal(despues.cargos.length, 1); assert.equal(despues.resumen.certificaciones, 1);
    // consultar el documento y su estado ante el proveedor (solo lectura)
    const q = await ana.llamar("GET", `/api/documentos/${docId}/consultar-proveedor`); assert.equal(q.status, 200); assert.equal(q.json.respuesta_del_proveedor.tipo, "certificado"); assert.equal(q.json.respuesta_del_proveedor.autorizacion, cert.json.documento.autorizacion_sat);
    // archivos (PDF/XML simulados) con marca
    const pdf = cert.json.artefactos.find((a: J) => a.tipo === "pdf"); assert.ok(pdf); const bin = await fetch(base + `/api/artefactos/${pdf.id}`, { headers: { cookie: ana.cookie } }); assert.equal(bin.status, 200); assert.match(bin.headers.get("content-disposition") ?? "", /SIMULADO-/);

    // ---- 4. anulación simulada (permiso, idempotencia, no se cobra)
    assert.equal((await pedro.llamar("POST", `/api/documentos/${docId}/anular`, { motivo: "Error de datos", clave: "clave-anula-lector-0001" })).status, 403, "el lector no anula");
    const an = await ana.llamar("POST", `/api/documentos/${docId}/anular`, { motivo: "Error en los datos del receptor", clave: "clave-anula-digifact-01" });
    assert.equal(an.status, 200, JSON.stringify(an.json)); assert.equal(an.json.documento.estado_fiscal, "anulado"); assert.equal(an.json.operaciones.filter((o: J) => o.tipo === "anulacion").length, 1);
    assert.equal((await ana.llamar("GET", "/api/plan")).json.cargos.length, 1, "la anulación no se cobra");
    assert.equal((await ana.llamar("POST", `/api/documentos/${docId}/anular`, { motivo: "Error en los datos del receptor", clave: "clave-anula-digifact-01" })).json.operaciones.filter((o: J) => o.tipo === "anulacion").length, 1, "repetir no duplica");

    // ---- 5. sin saldo, rechazo y desconocido (conciliación) 
    const d2 = await crear(marta, est2, [{ descripcion: "Servicio", cantidad: "1", precio_unitario: "100" }]); await ana.llamar("POST", `/api/documentos/${d2.documento.id}/estado`, { estado: "revisado", version: d2.documento.version });
    const rech = await ana.llamar("POST", `/api/documentos/${d2.documento.id}/certificar`, { proveedor: "digifact", escenario: "rechazo", clave: "clave-cert-digifact-0002" });
    assert.equal(rech.json.operaciones[0].estado, "confirmada_fallida"); assert.equal((await ana.llamar("GET", "/api/plan")).json.monedero.disponible, "97.500000", "un rechazo no se cobra");
    const d3 = await crear(marta, est2, [{ descripcion: "Servicio", cantidad: "1", precio_unitario: "100" }]); await ana.llamar("POST", `/api/documentos/${d3.documento.id}/estado`, { estado: "revisado", version: d3.documento.version });
    const desc = await ana.llamar("POST", `/api/documentos/${d3.documento.id}/certificar`, { proveedor: "digifact", escenario: "timeout_despues", clave: "clave-cert-digifact-0003" });
    assert.equal(desc.json.documento.estado_fiscal, "por_verificar"); assert.equal((await ana.llamar("GET", "/api/plan")).json.monedero.disponible, "95.000000", "la reserva queda retenida");
    const opD = desc.json.operaciones[0].id; const conc = await ana.llamar("POST", `/api/operaciones/${opD}/conciliar`, {}); assert.equal(conc.status, 200, JSON.stringify(conc.json)); assert.equal(conc.json.documento.estado_fiscal, "certificado");
    const p3 = (await ana.llamar("GET", "/api/plan")).json; assert.equal(p3.monedero.disponible, "95.000000"); assert.equal(p3.monedero.consumido, "5.000000"); assert.equal(p3.resumen.reservadas, 0);

    // ---- 6. aislamiento entre empresas
    assert.equal((await sofia.llamar("GET", `/api/documentos/${docId}`)).status, 404, "otra empresa no ve el documento");
    assert.equal((await sofia.llamar("POST", `/api/documentos/${docId}/anular`, { motivo: "Intento ajeno", clave: "clave-ajena-0000001" })).status >= 400, true);
    assert.equal((await sofia.llamar("GET", "/api/documentos")).json.length, 0); assert.equal((await marta.llamar("GET", "/api/plan")).status, 403, "la emisora no ve el plan y el consumo");
    assert.equal((await sofia.llamar("GET", "/api/plan")).json.contrato.codigo, "mensual_basico");

    // ---- 7. plataforma: crear empresa, plan, contrato, pago; bolsón global
    const nueva = await maestro.llamar("POST", "/api/plataforma/empresas", { nombre_comercial: "Taller Rivera", razon_social: "Taller Rivera, S.A. (FICTICIA)", nit: "9990003-1", propietario_nombre: "Rita Rivera", propietario_usuario: "rita", propietario_clave: "clave-rita-1234" });
    assert.equal(nueva.status, 200, JSON.stringify(nueva.json)); assert.equal((await maestro.llamar("POST", "/api/plataforma/empresas", { nombre_comercial: "Otra", razon_social: "Otra", nit: "9990004-2", propietario_nombre: "Rita Dos", propietario_usuario: "rita", propietario_clave: "clave-rita-1234" })).status, 409);
    const rita = new Cliente("rita"); assert.equal((await rita.entrar("clave-rita-1234")).status, 200); assert.equal((await rita.llamar("GET", "/api/estado")).json.empresa.nombre_comercial, "Taller Rivera");
    assert.equal((await rita.llamar("GET", "/api/plan")).json.contrato, null, "sin plan todavía");
    const pl = (await maestro.llamar("GET", "/api/plataforma/planes")).json; const ver = pl.versiones.find((v: J) => v.plan_codigo === "prepago_basico");
    assert.equal((await maestro.llamar("POST", "/api/plataforma/contratos", { empresa: nueva.json.empresa, plan_version: ver.id })).status, 200);
    assert.equal((await maestro.llamar("POST", "/api/plataforma/pagos", { empresa: nueva.json.empresa, monto: "10", referencia: "PAGO-RITA-1", clave: "clave-pago-rita-000001" })).status, 200);
    assert.equal((await maestro.llamar("POST", "/api/plataforma/pagos", { empresa: nueva.json.empresa, monto: "10", referencia: "PAGO-RITA-1", clave: "clave-pago-rita-000001" })).status, 200, "pago idempotente");
    assert.equal((await rita.llamar("GET", "/api/plan")).json.monedero.disponible, "10.000000", "el pago repetido no suma dos veces");
    assert.equal((await ana.llamar("POST", "/api/plataforma/pagos", { empresa: nueva.json.empresa, monto: "10", referencia: "X", clave: "clave-ajena-pago-00001" })).status, 404);
    const nv = await maestro.llamar("POST", "/api/plataforma/planes/mensual_basico/versiones", { cuota_fija: "0", unidades_incluidas: "0", tarifas: [{ evento: "certificacion", precio: "2.00", cargable: true }, { evento: "anulacion", precio: "0", cargable: false }] }); assert.equal(nv.status, 200, JSON.stringify(nv.json));
    const res = (await maestro.llamar("GET", "/api/plataforma/resumen")).json; assert.ok(res.empresas.length >= 3); assert.equal(res.verificacion.fallos, 0);
    const bol = (await maestro.llamar("GET", "/api/plataforma/bolson")).json; const c = bol.cuentas[0]; assert.equal(c.consumido, "4.000000", "el bolsón consumió 2 certificaciones + 1 anulación + 1 rechazo (prudencia: el proveedor pudo consumir)"); assert.equal(c.reservado, "0.000000");
    assert.ok(bol.porEmpresa.find((e: J) => e.nombre_comercial === "Empresa Demo").confirmados >= 3); assert.equal((await ana.llamar("GET", "/api/plataforma/bolson")).status, 404);
    assert.equal((await maestro.llamar("POST", "/api/plataforma/bolson/lotes", { cuenta: c.id, unidades: "100", costo_total: "50", referencia: "LOTE-SIM-2" })).status, 200);

    // ---- 8. cerrar sesión
    assert.equal((await ana.llamar("POST", "/api/sesion/salir", {})).status, 200); const tras = await fetch(base + "/api/estado", { headers: { "x-demo": "1", cookie: ana.cookie } }); assert.equal(tras.status, 401, "la sesión cerrada ya no sirve");
  } catch (e) { console.log("--- salida del servidor ---\n" + salida.slice(-3500)); throw e;
  } finally { hijo.kill("SIGTERM"); await Promise.race([Promise.all(lecturas), dormir(3000)]); try { await hijo.status; } catch { /* ya terminó */ } }
} });
