// PRUEBA DE CERTIFICACIÓN EN DIGIFACT TEST de la demostración publicada (la ejecuta quien despliega, SOLO si eligió «digifact_prueba=habilitado» y el ciclo de pruebas está autorizado):
//   FEL_DEMO_URL=https://<nombre>.pages.dev FEL_DEMO_CLAVES='ana=…' deno run -A nube/prueba_digifact.ts
// Recorre, con la API real y la sesión de «ana»: estado de Digifact (solo TEST, ciclo autorizado, almacén persistente) → factura de PRUEBA (hoy) → revisar → preparar (no envía) → certificar con la
// confirmación → serie, número y autorización del certificador → XML (impuestos, total, UUID, serie, número, fecha) → PDF → documento guardado y certificado → certificar OTRA vez NO reenvía.
// Los documentos son de PRUEBA, sin valor fiscal. No imprime contraseñas, tokens ni cookies. Solo ambiente TEST de Digifact (el cliente no tiene producción).
import { JarraCookies } from "./jarra_cookies.ts";
const url = (Deno.env.get("FEL_DEMO_URL") ?? "").replace(/\/$/, ""); if (!url) { console.error("Falta FEL_DEMO_URL."); Deno.exit(1); }
const pares = (s?: string) => Object.fromEntries((s ?? "").split(",").filter(Boolean).map((x) => { const i = x.indexOf("="); return [x.slice(0, i), x.slice(i + 1)]; }));
const claves = pares(Deno.env.get("FEL_DEMO_CLAVES")), semillas = pares(Deno.env.get("FEL_DEMO_MFA_SEMILLAS"));
if (!claves.ana) { console.error("Falta la contraseña de «ana» en FEL_DEMO_CLAVES."); Deno.exit(1); }
const fallos: string[] = []; const ok = (c: boolean, m: string) => { console.log(`${c ? "OK   " : "FALLO"} ${m}`); if (!c) fallos.push(m); };
type J = Record<string, any>; // deno-lint-ignore no-explicit-any
class Cli { jarra = new JarraCookies(); ultimasCookies: string[] = [];
  async ll(m: string, ruta: string, cuerpo?: unknown) { const r = await fetch(url + ruta, { method: m, redirect: "manual", headers: { "x-demo": "1", "content-type": "application/json", ...(this.jarra.cabecera() ? { cookie: this.jarra.cabecera() } : {}) }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
    this.ultimasCookies = this.jarra.guardar(r.headers.getSetCookie()); const buf = new Uint8Array(await r.arrayBuffer()); let json: J = {}; try { json = JSON.parse(new TextDecoder().decode(buf)); } catch { /* binario */ } return { status: r.status, json, r, buf }; } }

const hoyGt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala" }).format(new Date());
const sumar = (iso: string, n: number) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const resumen: string[] = [];
const ana = new Cli(); const ent = await ana.ll("POST", "/api/sesion/entrar", { usuario: "ana", clave: claves.ana }); ok(ent.status === 200, "ana inicia sesión");
const dg = (await ana.ll("GET", "/api/digifact/estado")).json;
ok(dg.habilitado === true && dg.certificacion === true && dg.ambiente === "TEST" && dg.produccion === "bloqueada", "Digifact TEST habilitado, ambiente TEST y producción bloqueada");
ok(dg.almacenamiento === "persistente", "almacén de operaciones persistente (la base guarda lo enviado)");
ok(dg.empresaConCanal === true && dg.ciclo === true, "la empresa de ana tiene canal Digifact TEST y el ciclo de pruebas está autorizado");
if (fallos.length) { console.error(`\nNo se continúa: ${fallos.length} condición(es) previas fallaron.`, fallos); Deno.exit(1); }
const est = (await ana.ll("GET", "/api/estado")).json;
const cliente = est.clientes.find((c: J) => c.tipo_identificacion === "CF") ?? est.clientes[0];

/** XML certificado: lee los datos que Digifact entregó (tolerante al prefijo del espacio de nombres). */
const dato = (xml: string, re: RegExp) => re.exec(xml)?.[1];
async function certificarFact(etiqueta: string, fecha: string, lineas: J[], esperado: { total: string; iva: string }, cf?: string) {
  const d = await ana.ll("POST", "/api/documentos", { ...(cf ? { cliente_nuevo: { tipo_identificacion: "CF", numero_identificacion: "CF", nombre: cf } } : { cliente_id: cliente.id }), establecimiento_id: est.establecimientos[0].id, fecha, observaciones: `PRUEBA TEST ${etiqueta}`, lineas });
  ok(d.status === 200, `${etiqueta}: borrador creado y guardado`); if (d.status !== 200) return;
  const id = d.json.documento.id as string;
  ok((await ana.ll("POST", `/api/documentos/${id}/estado`, { estado: "revisado", version: d.json.documento.version })).status === 200, `${etiqueta}: marcado como revisado`);
  const prep = await ana.ll("POST", `/api/documentos/${id}/digifact/preparar`, {}); ok(prep.status === 200 && !!prep.json.referencia, `${etiqueta}: preparado (no se envió nada)`); if (prep.status !== 200) { console.log(`      (preparar: HTTP ${prep.status}, código ${String(prep.json.codigo ?? "?").slice(0, 40)}: ${String(prep.json.mensaje ?? "").slice(0, 200)})`); resumen.push(`| ${etiqueta} | no preparado | ${String(prep.json.codigo ?? "")} | | |`); return; }
  ok(String(prep.json.fechaEmision).slice(0, 10) === fecha, `${etiqueta}: la fecha de emisión preparada es la elegida (${fecha})`);
  const cer = await ana.ll("POST", `/api/documentos/${id}/digifact/certificar`, { operacionId: prep.json.operacionId, confirmacion: "CERTIFICAR-TEST", referencia: prep.json.referencia, huellaEmisor: prep.json.huellaEmisor });
  const op = cer.json.operacion ?? {}, res = op.resultado ?? {};
  console.log(`      (${etiqueta}: HTTP ${cer.status}, estado ${op.estado ?? "?"}${cer.json.error ? `, error ${cer.json.error.tipo}: ${String(cer.json.error.mensaje).slice(0, 160)}` : ""}${res.mensaje ? `, mensaje ${String(res.mensaje).slice(0, 160)}` : ""})`);
  ok(op.estado === "certificada", `${etiqueta}: certificada por Digifact TEST`);
  if (op.estado !== "certificada") { resumen.push(`| ${etiqueta} | ${op.estado ?? "sin estado"} | ${String(res.mensaje ?? cer.json.error?.mensaje ?? "").slice(0, 80)} | | |`); return; }
  ok(!!res.autorizacion && !!res.serie && !!res.numero, `${etiqueta}: el certificador entregó serie, número y autorización (UUID)`);
  const doc = (await ana.ll("GET", `/api/documentos/${id}`)).json.documento;
  ok(doc?.estado_fiscal === "certificado" && doc.autorizacion_sat === res.autorizacion && doc.serie === res.serie && String(doc.numero_fiscal) === String(res.numero), `${etiqueta}: el documento guardado quedó certificado con los mismos datos`);
  ok(!String(doc.autorizacion_sat).toUpperCase().startsWith("SIM-"), `${etiqueta}: no es una autorización simulada (SIM-)`);
  const xmlR = await ana.ll("GET", `/api/documentos/${id}/digifact/xml`); const xml = new TextDecoder().decode(xmlR.buf);
  ok(xmlR.status === 200 && /<(\w+:)?GranTotal>/.test(xml), `${etiqueta}: XML certificado descargable`);
  const total = dato(xml, /<(?:\w+:)?GranTotal>([\d.]+)</), iva = dato(xml, /TotalMontoImpuesto="([\d.]+)"/), uuid = dato(xml, /<(?:\w+:)?NumeroAutorizacion[^>]*>([0-9A-Fa-f-]{36})</);
  const serieXml = dato(xml, /<(?:\w+:)?NumeroAutorizacion[^>]*\bSerie="([^"]+)"/), numXml = dato(xml, /<(?:\w+:)?NumeroAutorizacion[^>]*\bNumero="([^"]+)"/);
  const fechaXml = dato(xml, /FechaHoraEmision="(\d{4}-\d{2}-\d{2})/), tipoXml = dato(xml, /DatosGenerales[^>]*\bTipo="([A-Z]+)"/);
  ok(Number(total) === Number(esperado.total), `${etiqueta}: total del XML ${total} = esperado ${esperado.total}`);
  ok(Number(iva) === Number(esperado.iva), `${etiqueta}: IVA del XML ${iva} = esperado ${esperado.iva} (12 % incluido)`);
  ok((uuid ?? "").toUpperCase() === String(res.autorizacion).toUpperCase(), `${etiqueta}: el UUID del XML coincide con la autorización registrada`);
  ok(serieXml === res.serie && String(numXml) === String(res.numero), `${etiqueta}: serie y número del XML coinciden con los registrados`);
  ok(tipoXml === "FACT", `${etiqueta}: tipo de documento FACT en el XML`);
  if (cf) { ok(xml.includes(cf), `${etiqueta}: el XML certificado lleva el nombre del receptor CF escrito («${cf}»)`); ok(/IDReceptor="CF"/.test(xml), `${etiqueta}: y la identificación CF`); }
  ok(fechaXml === fecha, `${etiqueta}: la fecha de emisión del XML es la elegida (${fecha}), no la de hoy`);
  const pdf = await ana.ll("GET", `/api/documentos/${id}/digifact/pdf`); ok(pdf.status === 200 && new TextDecoder().decode(pdf.buf.slice(0, 4)) === "%PDF", `${etiqueta}: PDF del certificador descargable`);
  const local = await ana.ll("GET", `/api/documentos/${id}/pdf-demo?formato=ticket`); ok(local.status === 200 && /PRUEBAS/.test(new TextDecoder("latin1").decode(local.buf)), `${etiqueta}: el PDF/ticket local se rotula como PRUEBAS`);
  const dup = await ana.ll("POST", `/api/documentos/${id}/digifact/certificar`, { operacionId: prep.json.operacionId, confirmacion: "CERTIFICAR-TEST", referencia: prep.json.referencia, huellaEmisor: prep.json.huellaEmisor });
  ok(dup.json.reutilizada === true && dup.json.operacion?.resultado?.autorizacion === res.autorizacion, `${etiqueta}: certificar de nuevo NO reenvía (devuelve la misma autorización)`);
  const lista = (await ana.ll("GET", "/api/documentos")).json as J[]; ok(lista.some((x) => x.id === id && x.estado_fiscal === "certificado"), `${etiqueta}: aparece en Documentos como certificado`);
  resumen.push(`| ${etiqueta} | certificada (TEST) | ${res.serie} · ${res.numero} | ${res.autorizacion} | total ${total} · IVA ${iva} · fecha ${fechaXml} |`);
  return { id, serie: res.serie as string, numero: String(res.numero), autorizacion: res.autorizacion as string, fecha, total: total! };
}

const lin = (descripcion: string, precio: string) => [{ descripcion, cantidad: "1", precio_unitario: precio }];
await certificarFact("FACT hoy", hoyGt, lin("Servicio de prueba TEST", "100.00"), { total: "100", iva: "10.714286" });
await certificarFact("FACT fecha anterior", sumar(hoyGt, -2), lin("Servicio de prueba TEST (fecha anterior)", "250.50"), { total: "250.5", iva: "26.839286" });
await certificarFact("FACT receptor CF con nombre", hoyGt, lin("Servicio de prueba TEST (CF con nombre)", "75.00"), { total: "75", iva: "8.035714" }, "Juan Pérez");
await ana.ll("POST", "/api/sesion/salir", {});
const sal = Deno.env.get("GITHUB_STEP_SUMMARY");
if (sal) Deno.writeTextFileSync(sal, `### Certificación en Digifact TEST (documentos de PRUEBA, sin valor fiscal)\n\n| Documento | Resultado | Serie · Número | Autorización (UUID) | Detalle |\n|---|---|---|---|---|\n${resumen.join("\n")}\n`, { append: true });
if (fallos.length) { console.error(`\n${fallos.length} comprobación(es) fallaron:`, fallos); Deno.exit(1); }
console.log("\nPRUEBA DE CERTIFICACIÓN EN DIGIFACT TEST OK");
