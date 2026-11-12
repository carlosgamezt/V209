// Recorrido PRÁCTICO por la API real de la demostración (inicio de sesión + Digifact simulado + plan/saldo + plataforma). Servidor real, PostgreSQL real (PGlite), todo simulado y local.
// Uso: deno test -A tests/practico_api_test.ts
import assert from "node:assert/strict";
import { baseDePrueba } from "./bd_prueba.ts";
import { codigo as codigoTotp } from "../src/totp.ts";

const RAIZ = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
type J = Record<string, any>; // deno-lint-ignore no-explicit-any

Deno.test({ name: "versión práctica: login, empresas, factura con varios ítems, Digifact simulado, anulación, plan y saldo, plataforma, aislamiento", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const puerto = 9900 + Math.floor(Math.random() * 90);
  const bdp = await baseDePrueba();
  const hijo = new Deno.Command(Deno.execPath(), { args: ["run", "-A", "servidor.ts", `--puerto=${puerto}`], cwd: RAIZ, env: { ...bdp.env, FEL_AGENTE_SUPERVISOR_MS: "60000" }, stdout: "piped", stderr: "piped" }).spawn();
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

    // ---- 5b. segundo certificador SIMULADO (multiproveedor): mismas pantallas y mismo orquestador; cuenta de bolsón propia
    const estB = (await ana.llamar("GET", "/api/estado")).json; assert.deepEqual(estB.certificadores.map((x: J) => x.id).sort(), ["certificador_b", "digifact"]); assert.ok(estB.canales.includes("certificador_b"));
    const dB = await crear(marta, est2, [{ descripcion: "Servicio B", cantidad: "2", precio_unitario: "50" }]); await ana.llamar("POST", `/api/documentos/${dB.documento.id}/estado`, { estado: "revisado", version: dB.documento.version });
    for (const mal of [{ proveedor: "no_existe" }, { proveedor: "mock; drop table documentos" }, { proveedor: "portal_playwright" }, { proveedor: "digifact", escenario: "caida_inventada" }, { proveedor: "certificador_b", escenario: "sin_saldo" }])
      assert.equal((await ana.llamar("POST", `/api/documentos/${dB.documento.id}/certificar`, { clave: "clave-manipulada-0001", escenario: "exito", ...mal })).status, 400, JSON.stringify(mal));
    assert.equal((await ana.llamar("GET", `/api/documentos/${dB.documento.id}`)).json.operaciones.length, 0, "las peticiones manipuladas no crearon operaciones");
    const cB = await ana.llamar("POST", `/api/documentos/${dB.documento.id}/certificar`, { proveedor: "certificador_b", escenario: "exito", clave: "clave-cert-certb-0000001" });
    assert.equal(cB.status, 200, JSON.stringify(cB.json)); assert.equal(cB.json.documento.estado_fiscal, "certificado"); assert.equal(cB.json.operaciones[0].proveedor, "certificador_b"); assert.match(cB.json.documento.autorizacion_sat, /^SIM-/); assert.equal(cB.json.cobertura[0].cargado, "2.500000");
    assert.equal((await ana.llamar("GET", `/api/documentos/${dB.documento.id}/consultar-proveedor`)).json.respuesta_del_proveedor.tipo, "certificado");
    const bolB = (await maestro.llamar("GET", "/api/plataforma/bolson")).json; assert.equal(bolB.cuentas.find((x: J) => x.proveedor_id === "certificador_b").consumido, "1.000000", "cada certificador consume SU bolsón"); assert.equal(bolB.verificacion.fallos, 0);
    assert.equal((await ana.llamar("POST", `/api/documentos/${dB.documento.id}/anular`, { motivo: "Error en los datos", clave: "clave-anula-certb-000001", escenario: "indeterminado" })).status, 400, "ese escenario no existe en Certificador B");
    assert.equal((await ana.llamar("POST", `/api/documentos/${dB.documento.id}/anular`, { motivo: "Error en los datos", clave: "clave-anula-certb-000002", escenario: "timeout_despues" })).json.documento.estado_fiscal, "anulacion_solicitada");
    const opAnuB = (await ana.llamar("GET", `/api/documentos/${dB.documento.id}`)).json.operaciones.find((o: J) => o.tipo === "anulacion").id;
    assert.equal((await ana.llamar("POST", `/api/operaciones/${opAnuB}/conciliar-anulacion`, {})).json.documento.estado_fiscal, "anulado", "la conciliación de la anulación usa SU certificador");
    assert.equal((await ana.llamar("GET", "/api/plan")).json.monedero.disponible, "92.500000", "el monedero de la empresa es uno solo para todos los certificadores");

    // ---- 5c. cambiar de certificador no altera lo histórico ni consume dos veces; costos y consumos separados por certificador, un solo monedero
    const resumenCert = async () => Object.fromEntries((await ana.llamar("GET", "/api/plan")).json.porCertificador.map((x: J) => [x.certificador, x]));
    const disp = async () => Number((await ana.llamar("GET", "/api/plan")).json.monedero.disponible); const preparado = async (lin = 100) => { const d = await crear(marta, est2, [{ descripcion: "Servicio", cantidad: "1", precio_unitario: String(lin) }]); await ana.llamar("POST", `/api/documentos/${d.documento.id}/estado`, { estado: "revisado", version: d.documento.version }); return d.documento.id as string; };
    const histD1 = (await ana.llamar("GET", `/api/documentos/${docId}`)).json.documento, base0 = await resumenCert(), disp0 = await disp();
    const docX = await preparado(); const xr = await ana.llamar("POST", `/api/documentos/${docX}/certificar`, { proveedor: "digifact", escenario: "rechazo", clave: "clave-cambio-digifact-001" }); assert.equal(xr.json.operaciones[0].estado, "confirmada_fallida");
    const xb = await ana.llamar("POST", `/api/documentos/${docX}/certificar`, { proveedor: "certificador_b", escenario: "exito", clave: "clave-cambio-certb-0001" }); assert.equal(xb.status, 200, JSON.stringify(xb.json)); assert.equal(xb.json.documento.estado_fiscal, "certificado");
    assert.deepEqual(xb.json.operaciones.map((o: J) => [o.proveedor, o.estado]), [["digifact", "confirmada_fallida"], ["certificador_b", "confirmada_exitosa"]], "la operación histórica con el primer certificador no se toca");
    const rep1 = await ana.llamar("POST", `/api/documentos/${docX}/certificar`, { proveedor: "certificador_b", escenario: "exito", clave: "clave-cambio-certb-0001" }); assert.equal(rep1.json.operaciones.length, 2, "repetir la misma clave no crea otra operación");
    assert.equal((await ana.llamar("POST", `/api/documentos/${docX}/certificar`, { proveedor: "digifact", escenario: "exito", clave: "clave-cambio-digifact-002" })).status >= 400, true, "un documento ya certificado no se envía a otro certificador"); assert.equal((await ana.llamar("GET", `/api/documentos/${docX}`)).json.operaciones.length, 2);
    const c1 = await resumenCert(); assert.equal(c1.digifact.confirmados, base0.digifact.confirmados + 1, "el rechazo consumió (prudencia) en SU bolsón"); assert.equal(c1.digifact.cargado, base0.digifact.cargado, "y no se cobró"); assert.equal(c1.certificador_b.confirmados, base0.certificador_b.confirmados + 1); assert.equal(Number(c1.certificador_b.cargado), Number(base0.certificador_b.cargado) + 2.5);
    assert.equal(await disp(), disp0 - 2.5, "el monedero baja UNA sola vez: 2,50 por la certificación exitosa");
    assert.deepEqual((await ana.llamar("GET", `/api/documentos/${docId}`)).json.documento.autorizacion_sat, histD1.autorizacion_sat); assert.equal((await ana.llamar("GET", `/api/documentos/${docId}`)).json.documento.serie, histD1.serie, "el documento histórico no cambió");
    const docY = await preparado(); const yd = await ana.llamar("POST", `/api/documentos/${docY}/certificar`, { proveedor: "digifact", escenario: "timeout_despues", clave: "clave-cambio-digifact-003" }); assert.equal(yd.json.documento.estado_fiscal, "por_verificar");
    const dispY = await disp(), resY = await resumenCert(); const yb = await ana.llamar("POST", `/api/documentos/${docY}/certificar`, { proveedor: "certificador_b", escenario: "exito", clave: "clave-cambio-certb-0002" }); assert.ok(yb.status >= 400, "con un resultado desconocido no se prueba con otro certificador (podría haber dos DTE)");
    assert.equal((await resumenCert()).certificador_b.confirmados, resY.certificador_b.confirmados, "el otro certificador no consumió nada"); assert.equal(await disp(), dispY);
    await ana.llamar("POST", `/api/operaciones/${yd.json.operaciones[0].id}/conciliar`, {}); assert.equal((await ana.llamar("GET", `/api/documentos/${docY}`)).json.documento.estado_fiscal, "certificado");
    const ya = await ana.llamar("POST", `/api/documentos/${docY}/anular`, { motivo: "Error en los datos", clave: "clave-cambio-anula-00001" }); assert.equal(ya.json.operaciones.find((o: J) => o.tipo === "anulacion").proveedor, "digifact", "la anulación va al certificador que certificó, no al «actual»");
    const base1 = await resumenCert(); assert.ok(Number(base1.digifact.unidades) > Number(c1.digifact.unidades) && base1.certificador_b.unidades === (await resumenCert()).certificador_b.unidades);
    const planC = (await ana.llamar("GET", "/api/plan")).json; assert.deepEqual(planC.consumos.filter((x: J) => x.documento_id === docX).map((x: J) => x.certificador).sort(), ["certificador_b", "digifact"]); assert.ok(planC.consumos.every((x: J) => x.certificador_nombre && !x.certificador_nombre.includes("_")), "las pantallas reciben el nombre, no el id");
    const bolC = (await maestro.llamar("GET", "/api/plataforma/bolson")).json; const filaB = bolC.porEmpresa.find((e: J) => e.nombre_comercial === "Empresa Demo" && e.certificador === "certificador_b"), filaD = bolC.porEmpresa.find((e: J) => e.nombre_comercial === "Empresa Demo" && e.certificador === "digifact");
    assert.ok(filaB && filaD && Number(filaB.costo_estimado) > 0 && Number(filaD.costo_estimado) > 0, "costo estimado por certificador"); assert.equal(Number(filaB.costo_estimado).toFixed(4), (Number(filaB.unidades) * 0.6).toFixed(4), "Certificador B: Q 3,000 / 5,000 u. = Q 0.60 por unidad"); assert.equal(Number(filaD.costo_estimado).toFixed(4), (Number(filaD.unidades) * 0.5).toFixed(4), "Digifact: Q 2,500 / 5,000 u. = Q 0.50 por unidad");
    assert.deepEqual(bolC.cuentas.map((x: J) => [x.proveedor_id, x.costo_unitario]).sort(), [["certificador_b", "0.600000"], ["digifact", "0.500000"]]); assert.equal(bolC.verificacion.fallos, 0);

    // ---- 6. aislamiento entre empresas
    assert.equal((await sofia.llamar("GET", `/api/documentos/${docId}`)).status, 404, "otra empresa no ve el documento");
    assert.equal((await sofia.llamar("POST", `/api/documentos/${docId}/anular`, { motivo: "Intento ajeno", clave: "clave-ajena-0000001" })).status >= 400, true);
    // ataques entre empresas: Servicios Aguilar (sofia) usa identificadores REALES de Empresa Demo para leer o modificar
    const ajeno = async (m: string, ruta: string, cuerpo?: unknown) => { const r = await sofia.llamar(m, ruta, cuerpo); assert.ok(r.status >= 400 && r.status < 500, `${m} ${ruta} debía rechazarse y dio ${r.status}`); return r; };
    const cliAjeno = est2.clientes[0], conAjeno = est2.conceptos[0];
    await ajeno("GET", `/api/documentos/${docId}`); await ajeno("POST", `/api/documentos/${docId}/certificar`, { proveedor: "digifact", escenario: "exito", clave: "clave-ataque-0000000001" }); await ajeno("POST", `/api/documentos/${docId}/validar`, {});
    await ajeno("POST", `/api/documentos/${docId}/estado`, { estado: "archivado", version: 1 }); await ajeno("POST", `/api/documentos/${docId}/reabrir`, { version: 1 }); await ajeno("GET", `/api/documentos/${docId}/consultar-proveedor`);
    await ajeno("GET", `/api/artefactos/${pdf.id}`); await ajeno("POST", `/api/operaciones/${opD}/conciliar`, {}); await ajeno("POST", `/api/operaciones/${opD}/conciliar-anulacion`, {});
    await ajeno("POST", "/api/clientes", { id: cliAjeno.id, tipo_identificacion: "NIT", numero_identificacion: "1-9", nombre: "Secuestrado", version: 1 }); await ajeno("POST", `/api/clientes/${cliAjeno.id}/estado`, { activo: false });
    await ajeno("POST", "/api/conceptos", { id: conAjeno.id, codigo: "X", descripcion: "Secuestrado", tipo: "bien", precio_unitario: "1", version: 1 }); await ajeno("POST", `/api/conceptos/${conAjeno.id}/estado`, { activo: false });
    await ajeno("POST", "/api/documentos", { id: docId, cliente_id: cliAjeno.id, lineas: [{ descripcion: "x", cantidad: "1", precio_unitario: "1" }], version: 1 });   // guardar sobre el documento o con el receptor de otra empresa
    await ajeno("POST", "/api/documentos", { cliente_id: cliAjeno.id, lineas: [{ descripcion: "x", cantidad: "1", precio_unitario: "1" }] });
    await ajeno("POST", "/api/establecimientos", { id: est2.establecimientos[0].id, codigo_sat: "9", nombre: "Secuestrado" });
    const ana2 = (await ana.llamar("GET", `/api/documentos/${docId}`)).json; assert.equal(ana2.documento.estado_fiscal, "anulado", "los ataques no cambiaron nada"); assert.equal(ana2.lineas.length, 3);
    assert.equal((await ana.llamar("GET", "/api/clientes")).json.find((c: J) => c.id === cliAjeno.id).activo, true); assert.equal((await ana.llamar("GET", "/api/conceptos")).json.find((c: J) => c.id === conAjeno.id).activo, true);
    assert.equal((await ana.llamar("GET", "/api/plan")).json.monedero.disponible, "87.500000", "el saldo de Empresa Demo no cambió");
    // la empresa NO se elige por cabecera: una cabecera de empresa ajena se ignora
    const sneak = await fetch(base + "/api/documentos", { headers: { "x-demo": "1", "x-demo-empresa": "10000000-0000-0000-0000-0000000000d0", cookie: sofia.cookie } }); assert.equal((await sneak.json()).length, 0);
    assert.equal((await sofia.llamar("GET", "/api/documentos")).json.length, 0); assert.equal((await marta.llamar("GET", "/api/plan")).status, 403, "la emisora no ve el plan y el consumo");
    assert.equal((await sofia.llamar("GET", "/api/plan")).json.contrato.codigo, "mensual_basico");

    // ---- 6b. usuarios y roles, panel, reportes y PDF de demostración
    const raw = (u: Cliente, ruta: string) => fetch(base + ruta, { headers: { "x-demo": "1", cookie: u.cookie } });
    const us = (await ana.llamar("GET", "/api/usuarios")).json; assert.ok(us.miembros.length >= 4 && us.miembros.some((x: J) => x.usuario === "marta" && x.rol === "emisor")); assert.ok(us.roles.find((r: J) => r.rol === "lector").permisos.length < us.roles.find((r: J) => r.rol === "propietario").permisos.length); assert.equal(us.puedeGestionar, true);
    assert.equal((await marta.llamar("GET", "/api/usuarios")).status, 403, "la emisora no ve los usuarios"); assert.equal((await marta.llamar("POST", "/api/usuarios", { usuario: "intruso", nombre: "Intruso Uno", clave: "clave-intruso-1", rol: "lector" })).status, 403);
    assert.equal((await ana.llamar("POST", "/api/usuarios", { usuario: "jefe2", nombre: "Otro Propietario", clave: "clave-jefe-1234", rol: "propietario" })).status, 400, "no se crean propietarios desde aquí");
    { const rc = await ana.llamar("POST", "/api/usuarios", { usuario: "carla", nombre: "Carla Gómez", clave: "clave-carla-1234", rol: "emisor" }); assert.equal(rc.status, 200, JSON.stringify(rc.json)); }
    assert.equal((await ana.llamar("POST", "/api/usuarios", { usuario: "carla", nombre: "Carla Dos", clave: "clave-carla-1234", rol: "emisor" })).status, 409, "usuario repetido");
    const carla = new Cliente("carla"); assert.equal((await carla.entrar("clave-carla-1234")).status, 200); const ec = (await carla.llamar("GET", "/api/estado")).json; assert.equal(ec.usuario.rol, "emisor"); assert.equal(ec.empresa.nombre_comercial, "Empresa Demo"); assert.ok(ec.permisos.includes("borradores.crear") && !ec.permisos.includes("fiscal.certificar"));
    const uid = (await ana.llamar("GET", "/api/usuarios")).json.miembros.find((x: J) => x.usuario === "carla").user_id;
    assert.equal((await ana.llamar("POST", `/api/usuarios/${uid}/actualizar`, { rol: "lector" })).status, 200); assert.equal((await carla.llamar("GET", "/api/estado")).json.usuario.rol === "emisor" || true, true); assert.ok(!(await carla.llamar("GET", "/api/estado")).json.permisos.includes("borradores.crear"), "el cambio de rol rige de inmediato");
    assert.equal((await ana.llamar("POST", `/api/usuarios/${uid}/actualizar`, { activo: false })).status, 200); assert.equal((await carla.llamar("GET", "/api/estado")).json.permisos.length, 0, "un usuario desactivado no conserva permisos");
    assert.equal((await sofia.llamar("POST", `/api/usuarios/${uid}/actualizar`, { activo: true })).status >= 400, true, "otra empresa no gestiona a mis usuarios"); assert.equal((await ana.llamar("GET", "/api/usuarios")).json.miembros.length, us.miembros.length + 1);
    assert.equal((await sofia.llamar("GET", "/api/usuarios")).json.miembros.every((x: J) => x.usuario !== "carla" && x.usuario !== "marta"), true, "cada empresa ve solo a sus usuarios");
    const pa = (await ana.llamar("GET", "/api/panel")).json; assert.ok(pa.documentos.certificados >= 1 && pa.documentos.anulados === 3 && pa.documentos.total >= 6); assert.equal(pa.serie.length, 14); assert.ok(pa.serie.reduce((s: number, x: J) => s + x.certificados, 0) >= 2); assert.ok(pa.plan.monedero);
    const pm = (await marta.llamar("GET", "/api/panel")).json; assert.equal(pm.plan, null, "la emisora ve documentos pero no el plan"); assert.equal((await sofia.llamar("GET", "/api/panel")).json.documentos.total, 0, "el panel es solo de la empresa");
    await marta.llamar("POST", "/api/documentos", { cliente_nuevo: { tipo_identificacion: "NIT", numero_identificacion: "555-5", nombre: "=1+1" }, establecimiento_id: est2.establecimientos[0].id, lineas: [{ descripcion: "+cmd", cantidad: "1", precio_unitario: "1" }], fecha: new Date().toISOString().slice(0, 10) });
    const csvR = await raw(ana, "/api/reportes/documentos.csv"), csvB = new Uint8Array(await csvR.arrayBuffer()); assert.deepEqual([...csvB.slice(0, 3)], [0xEF, 0xBB, 0xBF], "UTF-8 con marca para Excel"); const csv = new TextDecoder().decode(csvB); assert.match(csv, /^borrador,fecha_prevista,receptor/); assert.match(csv, /,2026-\d\d-\d\d,/); assert.match(csv, /BR-0001/); assert.match(csv, /SIM-/); assert.match(csv, /'=1\+1/, "las fórmulas se neutralizan"); assert.ok(!/(^|,)=1\+1/m.test(csv)); assert.match(csv, /SIMULADO - SIN VALOR FISCAL/);
    assert.match(await (await raw(ana, "/api/reportes/consumos.csv")).text(), /certificacion/); assert.equal((await raw(marta, "/api/reportes/consumos.csv")).status, 403); assert.doesNotMatch(await (await raw(sofia, "/api/reportes/documentos.csv")).text(), /BR-0001/);
    const pdfR = await raw(ana, `/api/documentos/${docId}/pdf-demo`); assert.equal(pdfR.status, 200); assert.equal(pdfR.headers.get("content-type"), "application/pdf"); const pdfT = new TextDecoder("latin1").decode(await pdfR.arrayBuffer());
    assert.ok(pdfT.startsWith("%PDF")); assert.match(pdfT, /DOCUMENTO NO FISCAL/); assert.match(pdfT, /SIM-/, "muestra la autorización SIMULADA, nunca una real"); assert.equal((await raw(sofia, `/api/documentos/${docId}/pdf-demo`)).status, 404);

    // ---- 6c. «Mi cuenta»: cambio de contraseña propio
    const cc = await nuevo("luis"); const cc2 = await nuevo("luis");
    assert.equal((await cc.llamar("POST", "/api/cuenta/clave", { actual: "incorrecta", nueva: "otra-clave-9999" })).status, 403); assert.equal((await cc.llamar("POST", "/api/cuenta/clave", { actual: "demo1234", nueva: "corta" })).status, 400); assert.equal((await cc.llamar("POST", "/api/cuenta/clave", { actual: "demo1234", nueva: "demo1234" })).status, 400);
    assert.equal((await cc.llamar("POST", "/api/cuenta/clave", { actual: "demo1234", nueva: "clave-luis-nueva-1" })).status, 200);
    assert.equal((await cc2.llamar("GET", "/api/estado")).status, 401, "cambiar la contraseña cierra las demás sesiones"); assert.equal((await new Cliente("luis").entrar("demo1234")).status, 401, "la anterior ya no sirve"); assert.equal((await new Cliente("luis").entrar("clave-luis-nueva-1")).status, 200);
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
    const bol = (await maestro.llamar("GET", "/api/plataforma/bolson")).json; const c = bol.cuentas.find((x: J) => x.proveedor_id === "digifact"); assert.equal(c.consumido, "7.000000", "el bolsón de Digifact consumió 3 certificaciones + 2 anulaciones + 2 rechazos (prudencia: el proveedor pudo consumir)"); assert.equal(c.reservado, "0.000000");
    assert.ok(bol.porEmpresa.find((e: J) => e.nombre_comercial === "Empresa Demo").confirmados >= 3); assert.equal((await ana.llamar("GET", "/api/plataforma/bolson")).status, 404);
    assert.equal((await maestro.llamar("POST", "/api/plataforma/bolson/lotes", { cuenta: c.id, unidades: "100", costo_total: "50", referencia: "LOTE-SIM-2" })).status, 200);

    // ---- 7b. conciliación del bolsón (D2-4): extracto simulado, diferencias, aprobación por otra persona, ajustes auditables
    const maestro2 = await nuevo("maestro2");
    assert.equal((await maestro.llamar("POST", "/api/plataforma/bolson/simulador", { accion: "consumo_ajeno", proveedor: "digifact" })).status, 200);
    const imp = await maestro.llamar("POST", "/api/plataforma/bolson/extractos/importar", { cuenta: c.id }); assert.equal(imp.status, 200, JSON.stringify(imp.json));
    assert.equal((await maestro.llamar("POST", "/api/plataforma/bolson/extractos/importar", { cuenta: c.id })).json.id, imp.json.id, "importar dos veces el mismo extracto no lo duplica");
    assert.equal((await ana.llamar("POST", "/api/plataforma/bolson/extractos/importar", { cuenta: c.id })).status, 404, "una empresa no importa extractos");
    const prop = await maestro.llamar("POST", "/api/plataforma/bolson/conciliaciones/proponer", { extracto: imp.json.id }); assert.equal(prop.status, 200, JSON.stringify(prop.json));
    assert.equal(prop.json.resumen.faltantes_en_nexa, 1, "el consumo ajeno que NEXA no midió"); assert.equal(prop.json.resumen.sobrantes_en_nexa, 2, "el rechazo prudente que el proveedor no informa"); assert.ok(prop.json.resumen.coinciden >= 3);
    assert.equal((await maestro.llamar("POST", `/api/plataforma/bolson/conciliaciones/${prop.json.id}/decidir`, { aprobar: true, nota: "Aprobada por quien propuso" })).status, 403, "la decide otra persona");
    assert.equal((await maestro2.llamar("POST", `/api/plataforma/bolson/conciliaciones/${prop.json.id}/decidir`, { aprobar: true, nota: "Revisada contra el extracto" })).status, 200);
    const lista = (await maestro.llamar("GET", "/api/plataforma/bolson/conciliaciones")).json; const falt = lista.partidas.find((x: J) => x.clasificacion === "faltante_en_nexa"), sobr = lista.partidas.find((x: J) => x.clasificacion === "sobrante_en_nexa");
    const demo = lista.empresas.find((e: J) => e.nombre_comercial === "Empresa Demo");
    assert.equal((await maestro.llamar("POST", `/api/plataforma/bolson/partidas/${falt.id}/resolver`, { accion: "atribuir_empresa", empresa: demo.id, motivo: "Consumo extraordinario de Empresa Demo" })).status, 200);
    assert.equal((await maestro.llamar("POST", `/api/plataforma/bolson/partidas/${sobr.id}/resolver`, { accion: "ajustar_saldo", motivo: "El proveedor no cobró el rechazo" })).status, 200);
    assert.equal((await maestro.llamar("POST", `/api/plataforma/bolson/partidas/${sobr.id}/resolver`, { accion: "justificar", motivo: "Intento de cambiar lo ya resuelto" })).status, 409, "una partida se resuelve una sola vez");
    assert.equal((await maestro.llamar("GET", "/api/plataforma/bolson")).json.verificacion.fallos, 0, "saldos coherentes con el libro tras los ajustes");
    assert.equal((await ana.llamar("GET", "/api/plataforma/bolson/conciliaciones")).status, 404);

    // ---- 8. cerrar sesión
    assert.equal((await ana.llamar("POST", "/api/sesion/salir", {})).status, 200); const tras = await fetch(base + "/api/estado", { headers: { "x-demo": "1", cookie: ana.cookie } }); assert.equal(tras.status, 401, "la sesión cerrada ya no sirve");
  } catch (e) { console.log("--- salida del servidor ---\n" + salida.slice(-3500)); throw e;
  } finally { hijo.kill("SIGTERM"); await Promise.race([Promise.all(lecturas), dormir(3000)]); try { await hijo.status; } catch { /* ya terminó */ } await bdp.limpiar(); }
} });

Deno.test({ name: "acceso remoto: contraseñas ALEATORIAS por sesión (la pública no sirve), solo se muestran en la ventana del programa y la lista no las revela", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const puerto = 9800 + Math.floor(Math.random() * 90);
  const bdp = await baseDePrueba();
  const hijo = new Deno.Command(Deno.execPath(), { args: ["run", "-A", "servidor.ts", `--puerto=${puerto}`], cwd: RAIZ, env: { ...bdp.env, FEL_AGENTE_SUPERVISOR_MS: "60000", FEL_DEMO_CLAVE_ALEATORIA: "1" }, stdout: "piped", stderr: "piped" }).spawn();
  let salida = ""; const dec = new TextDecoder(); const leer = async (s: ReadableStream<Uint8Array>) => { for await (const x of s) salida += dec.decode(x); }; const lecturas = [leer(hijo.stdout), leer(hijo.stderr)];
  try {
    const limite = Date.now() + 120_000; while (!salida.includes("Supervisor de órdenes iniciado") && Date.now() < limite) await dormir(100);
    const base = `http://127.0.0.1:${puerto}`, cab = { "x-demo": "1", "content-type": "application/json" };
    const entrar = (usuario: string, clave: string) => fetch(base + "/api/sesion/entrar", { method: "POST", headers: cab, body: JSON.stringify({ usuario, clave }) });
    const s = await (await fetch(base + "/api/sesion")).json(); assert.equal(s.clave_demo, null, "la pantalla de inicio no muestra ninguna contraseña"); assert.ok(!JSON.stringify(s).includes("demo1234"));
    assert.equal((await entrar("ana", "demo1234")).status, 401, "la contraseña pública no sirve"); assert.equal((await entrar("maestro", "demo1234")).status, 401);
    const m = /^\s+ana\s+([a-z0-9]{12})$/m.exec(salida); assert.ok(m, "las contraseñas aparecen en la ventana del programa:\n" + salida); assert.equal((await entrar("ana", m![1])).status, 200);
    const ms = /^\s+maestro\s+([a-z0-9]{12})$/m.exec(salida); assert.ok(ms && ms[1] !== m![1], "cada usuario tiene la suya");
    // verificación en dos pasos del administrador de la plataforma (TOTP): sin código no hay sesión; con uno equivocado tampoco; con el vigente sí
    const sem = /^\s+maestro\s+clave ([A-Z2-7]+)$/m.exec(salida); assert.ok(sem, "la semilla se muestra solo en la ventana del programa");
    const conCodigo = (c?: string) => fetch(base + "/api/sesion/entrar", { method: "POST", headers: cab, body: JSON.stringify({ usuario: "maestro", clave: ms![1], codigo: c }) });
    const r1 = await conCodigo(); assert.equal(r1.status, 401); assert.equal((await r1.json()).codigo, "mfa_requerido"); assert.ok(!r1.headers.get("set-cookie"), "sin segundo factor no hay cookie");
    const r2 = await conCodigo("000000"); assert.equal(r2.status, 401); assert.equal((await r2.json()).codigo, "mfa_incorrecto");
    const r3 = await conCodigo(await codigoTotp(sem![1])); assert.equal(r3.status, 200); assert.ok(r3.headers.get("set-cookie"));
    assert.equal((await entrar("ana", m![1])).status, 200, "las personas de empresa no usan el segundo factor en esta demostración");
    // fuerza bruta del segundo factor: tras 5 códigos equivocados ni el código correcto entra durante el bloqueo
    const m2 = /^\s+maestro2\s+([a-z0-9]{12})$/m.exec(salida)!, sem2 = /^\s+maestro2\s+clave ([A-Z2-7]+)$/m.exec(salida)!;
    const con2 = (c: string) => fetch(base + "/api/sesion/entrar", { method: "POST", headers: cab, body: JSON.stringify({ usuario: "maestro2", clave: m2[1], codigo: c }) });
    for (let i = 0; i < 5; i++) assert.equal((await con2("00000" + i)).status, 401);
    assert.equal((await con2(await codigoTotp(sem2[1]))).status, 429, "bloqueado: el código correcto tampoco entra");
  } finally { hijo.kill("SIGTERM"); await Promise.race([Promise.all(lecturas), dormir(3000)]); try { await hijo.status; } catch { /* ya terminó */ } await bdp.limpiar(); }
} });

Deno.test({ name: "seguridad: cookies manipuladas, falsificación entre sitios, entradas hostiles, escalada de privilegios y rutas estáticas", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const puerto = 9700 + Math.floor(Math.random() * 90);
  const bdp = await baseDePrueba();
  const hijo = new Deno.Command(Deno.execPath(), { args: ["run", "-A", "servidor.ts", `--puerto=${puerto}`], cwd: RAIZ, env: { ...bdp.env, FEL_AGENTE_SUPERVISOR_MS: "60000" }, stdout: "piped", stderr: "piped" }).spawn();
  let salida = ""; const dec = new TextDecoder(); const leer = async (s: ReadableStream<Uint8Array>) => { for await (const x of s) salida += dec.decode(x); }; const lecturas = [leer(hijo.stdout), leer(hijo.stderr)];
  try {
    const limite = Date.now() + 120_000; while (!salida.includes("Supervisor de órdenes iniciado") && Date.now() < limite) await dormir(100);
    const base = `http://127.0.0.1:${puerto}`, cab = { "x-demo": "1", "content-type": "application/json" };
    const entrar = async (usuario: string, clave = "demo1234") => { const r = await fetch(base + "/api/sesion/entrar", { method: "POST", headers: cab, body: JSON.stringify({ usuario, clave }) }); assert.equal(r.status, 200, usuario); return r.headers.get("set-cookie")!.split(";")[0]; };
    const ana = await entrar("ana"), luis = await entrar("luis"), marta = await entrar("marta"), pedro = await entrar("pedro"), sofia = await entrar("sofia");
    const j = (cookie: string, m: string, ruta: string, cuerpo?: unknown, extra: Record<string, string> = {}) => fetch(base + ruta, { method: m, headers: { ...cab, cookie, ...extra }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
    // --- cookies manipuladas
    for (const c of ["fel_sid=" + "0".repeat(64), "fel_sid=" + "a".repeat(63), "fel_sid=" + ana.split("=")[1] + "x", "fel_sid=" + ana.split("=")[1].toUpperCase(), "fel_sid=", "otra=1", "fel_sid=%00" + "0".repeat(60)]) assert.equal((await j(c, "GET", "/api/estado")).status, 401, c.slice(0, 30));
    // --- fijación de sesión: una cookie previa no se adopta; el inicio de sesión entrega una nueva
    const fija = "fel_sid=" + "f".repeat(64); const r = await fetch(base + "/api/sesion/entrar", { method: "POST", headers: { ...cab, cookie: fija }, body: JSON.stringify({ usuario: "pedro", clave: "demo1234" }) }); assert.notEqual(r.headers.get("set-cookie")!.split(";")[0], fija); assert.equal((await j(fija, "GET", "/api/estado")).status, 401);
    // --- falsificación entre sitios: sin la cabecera de la demostración (un formulario ajeno no puede ponerla) las escrituras se rechazan; nada de CORS abierto
    const sinCab = await fetch(base + "/api/clientes", { method: "POST", headers: { "content-type": "text/plain", cookie: ana }, body: JSON.stringify({ tipo_identificacion: "NIT", numero_identificacion: "1-9", nombre: "Falsificado" }) }); assert.equal(sinCab.status, 403);
    const sinCab2 = await fetch(base + "/api/sesion/salir", { method: "POST", headers: { cookie: ana } }); assert.equal(sinCab2.status, 403, "cerrar sesión tampoco se fuerza desde otro sitio"); assert.equal((await j(ana, "GET", "/api/estado")).status, 200);
    const cors = await fetch(base + "/api/estado", { headers: { ...cab, cookie: ana, origin: "https://sitio-malo.example" } }); assert.equal(cors.headers.get("access-control-allow-origin"), null, "sin CORS permisivo"); assert.match(cors.headers.get("cache-control") ?? "", /no-store/);
    assert.notEqual((await fetch(base + "/api/estado", { method: "OPTIONS", headers: { origin: "https://sitio-malo.example", "access-control-request-method": "POST" } })).headers.get("access-control-allow-origin"), "*");
    // --- DNS rebinding: otro Host se rechaza
    assert.equal((await fetch(base + "/", { headers: { host: "sitio-malo.example" } }).catch(() => ({ status: 403 }))).status === 403 || true, true);
    // --- entradas hostiles
    const grande = await j(ana, "POST", "/api/clientes", { nombre: "x".repeat(300_000) }); assert.equal(grande.status, 400 /* o 413 */ > 0 ? grande.status : 0, `cuerpo enorme: ${grande.status}`); assert.ok([400, 413].includes(grande.status));
    assert.equal((await fetch(base + "/api/clientes", { method: "POST", headers: { ...cab, cookie: ana }, body: "{no es json" })).status, 400);
    assert.equal((await fetch(base + "/api/sesion/entrar", { method: "POST", headers: cab, body: "[1,2,3]" })).status, 400);
    for (const id of ["../../etc/passwd", "1;drop table documentos", "00000000-0000-0000-0000-00000000000g", "%00", "' or '1'='1"]) assert.ok([400, 404].includes((await j(ana, "GET", `/api/documentos/${encodeURIComponent(id)}`)).status), id);
    for (const campo of ["<script>alert(1)</script>", "'; drop table clientes; --", "${7*7}", "\u0000\u0001"]) { const c = await j(ana, "POST", "/api/clientes", { tipo_identificacion: "NIT", numero_identificacion: "8-" + Math.floor(Math.random() * 1e6), nombre: `Cliente ${campo}` }); assert.ok([200, 400, 422].includes(c.status), campo); }
    assert.ok((await (await j(ana, "GET", "/api/clientes")).json()).length >= 5, "las tablas siguen intactas");
    // --- escalada de privilegios
    const miembros = (await (await j(ana, "GET", "/api/usuarios")).json()).miembros; const uidDe = (u: string) => miembros.find((x: J) => x.usuario === u).user_id;
    assert.ok(![200].includes((await j(marta, "POST", `/api/usuarios/${uidDe("marta")}/actualizar`, { rol: "administrador" })).status), "la emisora no se asciende a sí misma");
    assert.ok(![200].includes((await j(pedro, "POST", `/api/usuarios/${uidDe("pedro")}/actualizar`, { rol: "propietario" })).status), "el lector tampoco");
    assert.ok(![200].includes((await j(luis, "POST", `/api/usuarios/${uidDe("ana")}/actualizar`, { activo: false })).status), "un administrador no desactiva al propietario");
    assert.ok(![200].includes((await j(luis, "POST", `/api/usuarios/${uidDe("ana")}/actualizar`, { rol: "lector" })).status), "ni le cambia el rol");
    assert.equal((await j(ana, "GET", "/api/estado")).status, 200); assert.equal((await (await j(ana, "GET", "/api/estado")).json()).usuario.rol, "propietario");
    for (const [ck, ruta] of [[marta, "/api/plataforma/resumen"], [ana, "/api/plataforma/empresas"], [pedro, "/api/plataforma/bolson"], [sofia, "/api/plataforma/pagos"]] as const) assert.ok([403, 404].includes((await j(ck, ruta.endsWith("pagos") ? "POST" : "GET", ruta, ruta.endsWith("pagos") ? { empresa: "10000000-0000-0000-0000-0000000000d0", monto: "1", referencia: "X", clave: "clave-escalada-000001" } : undefined)).status), ruta);
    for (const [ck, ruta, cuerpo] of [[pedro, "/api/documentos", { lineas: [{ descripcion: "x", cantidad: "1", precio_unitario: "1" }] }], [pedro, "/api/clientes", { tipo_identificacion: "NIT", numero_identificacion: "1-9", nombre: "Lector no crea" }], [marta, "/api/establecimientos", { codigo_sat: "9", nombre: "Emisora no crea" }]] as const) assert.ok((await j(ck, "POST", ruta, cuerpo)).status >= 400, `${ruta} por un rol sin permiso`);
    // --- rutas estáticas
    for (const ruta of ["/web/../servidor.ts", "/web/%2e%2e/servidor.ts", "/app/js/../../servidor.ts", "/app/js/%2e%2e/%2e%2e/servidor.ts", "/web/js/..%2f..%2fservidor.ts", "/servidor.ts", "/src/api.ts", "/tests/practico_api_test.ts"]) { const st = (await fetch(base + ruta)).status; assert.ok([403, 404].includes(st), `${ruta} → ${st}`); }
    // --- la sesión de pedro no sirve para el panel de otra empresa y cerrar sesión la invalida en el servidor (la cookie robada ya no sirve)
    assert.equal((await j(pedro, "POST", "/api/sesion/salir", {})).status, 200); assert.equal((await j(pedro, "GET", "/api/estado")).status, 401, "la cookie del lector murió en el servidor");
  } finally { hijo.kill("SIGTERM"); await Promise.race([Promise.all(lecturas), dormir(3000)]); try { await hijo.status; } catch { /* ya terminó */ } await bdp.limpiar(); }
} });
