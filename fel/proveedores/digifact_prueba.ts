// Pruebas REALES contra Digifact TEST (solo TEST; producción está bloqueada en el cliente). Se ejecutan a mano desde el workflow «NEXA FEL · Digifact TEST» o en un servidor con las variables definidas.
//   deno run --allow-net=testnucgt.digifact.com --allow-env=DIGIFACT_TEST_USERNAME,DIGIFACT_TEST_PASSWORD,DIGIFACT_TEST_NIT,DIGIFACT_CONFIRMAR,DIGIFACT_NIT_CONSULTA,DIGIFACT_AUTORIZACION,DIGIFACT_ESQUEMA,DIGIFACT_SALIDA,DIGIFACT_REFERENCIA,DIGIFACT_HUELLA_EMISOR --allow-read --allow-write=./salida digifact_prueba.ts <paso>
// Pasos:  autenticar · credenciales-presentes · consultar-nit-privado · consultar-cui-privado · (consultar-nit: retirado) · validar-nuc · datos-emisor · certificar-test · consulta-posterior · descargar
// NUNCA imprime la contraseña ni el token; solo «sí/no», códigos, UUID, serie, número, fechas y datos fiscales NO sensibles del emisor de prueba.
import { crearDigifactGt, DigifactGt, ErrorDigifact, nit12, soloUsuario } from "./src/digifact_gt.ts";
import { consultaNitPrivada, presenciaCredenciales } from "./src/consulta_nit_privada.ts";
import { consultaCuiPrivada, presenciaCuiPrueba } from "./src/consulta_cui_privada.ts";
import { construirNuc, NucInvalido, type FacturaGt } from "./src/nuc_gt.ts";
import { type DatosEmisor, extraerEmisorDeDte, huellaEmisor } from "./src/datos_emisor.ts";
import { agruparEstablecimientos } from "./src/establecimientos_digifact.ts";
import { conCorreo, estadoDeLaReferencia, nucParaMostrar, presenciaCorreoPrueba, resolverCorreoDePrueba, sha256Hex, verificarNucConCorreo } from "./src/correo_prueba.ts";

const NECESARIAS = ["DIGIFACT_TEST_USERNAME", "DIGIFACT_TEST_PASSWORD", "DIGIFACT_TEST_NIT"] as const;
const UUID = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;
const salir = (m: string, c = 1): never => { console.error(m); Deno.exit(c); };
const out = (o: Record<string, unknown>) => console.log(JSON.stringify(o, null, 2));
const paso = Deno.args[0] ?? "";
const fechaGt = (msDesplazados = 0) => new Date(Date.now() - 6 * 3600_000 + msDesplazados).toISOString().slice(0, 10);

function cliente(esquema: "raw" | "bearer"): DigifactGt {
  const faltan = NECESARIAS.filter((n) => !Deno.env.get(n));
  if (faltan.length) salir(`Faltan variables de entorno (solo se indican los NOMBRES): ${faltan.join(", ")}`, 2);
  return crearDigifactGt({ ambiente: "test", nit: Deno.env.get("DIGIFACT_TEST_NIT")!, usuario: Deno.env.get("DIGIFACT_TEST_USERNAME")!, obtenerClave: () => Deno.env.get("DIGIFACT_TEST_PASSWORD")!, esquemaAutorizacion: esquema, tiempoMaximoMs: 30_000 });
}
const errorLegible = (e: unknown) => e instanceof ErrorDigifact ? { tipo: e.tipo, estadoHttp: e.estadoHttp ?? null, mensaje: e.message, ...(e.detalle ? { respuestaDeDigifact: e.detalle } : {}) } : { tipo: "inesperado", mensaje: e instanceof Error ? e.name : "error" };
/** Solo la FORMA de los datos (sí/no), nunca valores ni longitudes: ayuda a descubrir un secreto mal pegado sin exponerlo. */
function formaDeCredenciales() {
  const u = Deno.env.get("DIGIFACT_TEST_USERNAME") ?? "", n = Deno.env.get("DIGIFACT_TEST_NIT") ?? "", c = Deno.env.get("DIGIFACT_TEST_PASSWORD") ?? "";
  return {
    usuarioTrajoElPrefijoGTCompleto: /^GT\.\d{12}\./i.test(u.trim()), usuarioSeUsoSinPrefijo: soloUsuario(u) !== u.trim() ? "se quitó el prefijo" : "tal cual",
    usuarioConEspaciosOSaltos: /\s/.test(u), nitSoloDigitos: /^\d+$/.test(n.trim()), nitConEspaciosOSaltos: n !== n.trim(),
    claveVacia: c.length === 0, claveConEspaciosOSaltosAlInicioOFinal: c !== c.trim(), claveContieneSaltoDeLinea: /[\r\n]/.test(c),
  };
}

/** Datos exigidos de nuestro emisor TEST (los entregó Digifact): si el DTE ya aceptado por SAT no los confirma, NO se certifica nada. */
export const EMISOR_TEST_ESPERADO = { afiliacionIva: "GEN", establecimiento: "2", frase: { tipo: 1, escenario: 2 } } as const;
export function verificarEmisorEsperado(d: DatosEmisor): string[] {
  const p: string[] = [];
  if (d.afiliacionIva !== EMISOR_TEST_ESPERADO.afiliacionIva) p.push(`afiliación IVA del DTE aceptado = ${d.afiliacionIva}, se esperaba ${EMISOR_TEST_ESPERADO.afiliacionIva}`);
  if (d.codigoEstablecimiento !== EMISOR_TEST_ESPERADO.establecimiento) p.push(`establecimiento del DTE aceptado = ${d.codigoEstablecimiento}, se esperaba ${EMISOR_TEST_ESPERADO.establecimiento}`);
  if (!d.frases.some((f) => f.tipo === EMISOR_TEST_ESPERADO.frase.tipo && f.escenario === EMISOR_TEST_ESPERADO.frase.escenario)) p.push(`las frases del DTE aceptado (${d.frases.map((f) => `${f.tipo}/${f.escenario}`).join(", ") || "ninguna"}) no incluyen tipo ${EMISOR_TEST_ESPERADO.frase.tipo} escenario ${EMISOR_TEST_ESPERADO.frase.escenario}`);
  return p;
}

/** Factura de PRUEBA (TEST) armada SOLO con datos del emisor leídos de un DTE que SAT ya aceptó. Montos de IVA desglosados a mano para Q100.00 (NEXA no calcula IVA). */
export function facturaDePruebaTest(e: DatosEmisor, referenciaInterna: string, fechaEmision?: string): FacturaGt {
  return {
    tipoDoc: "FACT", fechaEmision: fechaEmision ?? new Date(Date.now() - 6 * 3600_000).toISOString().replace(/\.\d{3}Z$/, "-06:00"), moneda: "GTQ", referenciaInterna,
    emisor: {
      nit: String(Number(e.nit)), nombre: e.nombre, afiliacionIva: e.afiliacionIva as FacturaGt["emisor"]["afiliacionIva"], frases: e.frases,
      establecimiento: { codigo: Number(e.codigoEstablecimiento), ...(e.nombreComercial ? { nombre: e.nombreComercial } : {}), direccion: { direccion: e.direccion.direccion, codigoPostal: e.direccion.codigoPostal, municipio: e.direccion.municipio, departamento: e.direccion.departamento, pais: e.direccion.pais || "GT" } },
    },
    receptor: { tipoId: "CF", id: "CF", nombre: "CONSUMIDOR FINAL" },
    items: [{ tipo: "Servicio", descripcion: "Servicio de prueba NEXA FEL (TEST)", cantidad: "1", unidad: "SER", precioUnitario: "100", descuento: "0", impuestos: [{ codigoUnidadGravable: 1, nombre: "IVA", gravable: "89.285714", monto: "10.714286" }], totalItem: "100" }],
  };
}

/** Busca en el reporte de acuses (solo lectura) un DTE ya certificado del establecimiento 2 (prefiere los ACEPTADOS por SAT) y lee de su XML los datos del emisor. Máx. ~45 consultas. Si no hay nada, informa qué SÍ existe (solo conteos y códigos). */
async function descubrirEmisor(c: DigifactGt) {
  // Fuente indicada por el usuario: la autorización (UUID) de un DTE de TEST ya certificado para este NIT. Es la fuente más directa y la preferida.
  const aut = Deno.env.get("DIGIFACT_AUTORIZACION");
  if (aut) {
    const r = await c.consultarDte(aut);
    if (!r.encontrado) return { ok: false as const, motivo: "el DTE indicado no se encontró con estas credenciales (¿otro NIT o UUID mal copiado?)", etiquetasVistas: [] as string[], fuente: null, hallazgos: null };
    if (!r.xmlB64) return { ok: false as const, motivo: "el DTE indicado no devolvió su XML", etiquetasVistas: [] as string[], fuente: { documento: aut, tipoDte: r.tipoDte }, hallazgos: null };
    const e = extraerEmisorDeDte(r.xmlB64);
    const fuente = { documento: r.autorizacion, tipoDte: r.tipoDte, serie: r.serie, numero: r.numero, fechaEmision: r.fechaEmision };
    return e.ok ? { ok: true as const, datos: e.datos, fuente } : { ok: false as const, motivo: e.motivo, etiquetasVistas: e.etiquetasVistas, fuente, hallazgos: null };
  }
  const rangos: Array<[string, string]> = [];
  for (let i = 0; i < 20; i++) rangos.push([fechaGt(-(i * 2 + 2) * 86_400_000), fechaGt(-(i * 2) * 86_400_000)]);
  rangos.push(["2026-10-05", "2026-10-07"]);   // fechas del ejemplo de la guía oficial de Digifact
  const vistos = { rangosConsultados: 0, filas: 0, establecimientos: new Set<string>(), estados: new Set<string>(), tipos: new Set<string>() };
  const orden = (a: { estadoAcuse: string }, b: { estadoAcuse: string }) => Number(b.estadoAcuse === "ACEPTADO_SAT") - Number(a.estadoAcuse === "ACEPTADO_SAT");
  for (const filtrarEst of [true, false]) {
    for (const [d, h] of rangos) {
      const filas = await c.reporteAcuses(d, { hasta: h, ...(filtrarEst ? { establecimiento: 2 } : {}), limite: 20 }); vistos.rangosConsultados++;
      for (const f of filas) { vistos.filas++; vistos.establecimientos.add(f.establecimiento); vistos.estados.add(f.estadoAcuse); vistos.tipos.add(f.tipoDte); }
      const candidatas = filas.filter((x) => x.autorizacion && x.establecimiento === "2").sort(orden).slice(0, 3);
      for (const f of candidatas) {
        const r = await c.consultarDte(f.autorizacion);
        if (!r.encontrado || !r.xmlB64) continue;
        const e = extraerEmisorDeDte(r.xmlB64);
        if (e.ok) return { ok: true as const, datos: e.datos, fuente: { rango: `${d} a ${h}`, tipoDte: f.tipoDte, establecimiento: f.establecimiento, nombreEstablecimiento: f.nombreEstablecimiento, estadoAcuse: f.estadoAcuse } };
        return { ok: false as const, motivo: e.motivo, etiquetasVistas: e.etiquetasVistas, fuente: { rango: `${d} a ${h}`, tipoDte: f.tipoDte }, hallazgos: null };
      }
    }
    if (vistos.filas > 0) break;   // si ya hay documentos (de otros establecimientos) no hace falta repetir sin filtro
  }
  return { ok: false as const, motivo: "no se encontró ningún DTE del establecimiento 2 con datos legibles", etiquetasVistas: [] as string[], fuente: null, hallazgos: { rangosConsultados: vistos.rangosConsultados, filasVistas: vistos.filas, establecimientosVistos: [...vistos.establecimientos].slice(0, 20), estadosVistos: [...vistos.estados], tiposVistos: [...vistos.tipos] } };
}

async function main() {
  switch (paso) {
    case "autenticar": {   // PRUEBA 1
      const c = cliente("raw");
      try { await c.token(); const s = c.estadoSesion(); out({ prueba: "autenticar", ok: true, tokenObtenido: s.activa, tokenVinoComo: s.tokenVinoComo, venceEnSegundos: s.venceEnS, ambiente: "TEST", nitConsultado: nit12(Deno.env.get("DIGIFACT_TEST_NIT")!) }); }
      catch (e) { out({ prueba: "autenticar", ok: false, error: errorLegible(e), ...(e instanceof ErrorDigifact && e.tipo === "autenticacion" ? { diagnosticoDeForma: formaDeCredenciales() } : {}) }); Deno.exit(1); }
      return;
    }
    case "credenciales-presentes": {   // SOLO presencia (sí/no): sin red, sin valores, sin longitudes
      const c = presenciaCredenciales((k) => Deno.env.get(k)); out({ prueba: "credenciales-presentes", ambiente: "TEST", credenciales: c, cuiPrueba: presenciaCuiPrueba((k) => Deno.env.get(k)), correoPrueba: presenciaCorreoPrueba((k) => Deno.env.get(k)), ok: c.usuario && c.clave && c.nit }); if (!(c.usuario && c.clave && c.nit)) Deno.exit(1);
      return;
    }
    case "consultar-nit-privado": {   // UNA consulta real al ambiente TEST del NIT de la propia cuenta; la salida no lleva ningún dato personal (ver src/consulta_nit_privada.ts)
      const r = await consultaNitPrivada((k) => Deno.env.get(k)); out({ ...r }); if (!r.ok) Deno.exit(1);
      return;
    }
    case "consultar-cui-privado": {   // UNA consulta real al ambiente TEST del CUI guardado en un secreto; salida sin ningún dato personal (ver src/consulta_cui_privada.ts)
      const r = await consultaCuiPrivada((k) => Deno.env.get(k)); out({ ...r }); if (!r.ok) Deno.exit(1);
      return;
    }
    case "consultar-nit": {   // RETIRADO: imprimía el NIT y el nombre del contribuyente en el registro; se sustituyó por «consultar-nit-privado»
      salir("«consultar-nit» ya no existe porque dejaba el NIT y el nombre en el registro. Usa «consultar-nit-privado» (solo el NIT de la cuenta, salida sin datos personales).", 2);
      return;
    }
    case "validar-nuc": {   // PRUEBA 3 (sin red): con un emisor de EJEMPLO, solo para comprobar la estructura
      const ej: DatosEmisor = { nit: "5888492", nombre: "EMISOR DE EJEMPLO", nombreComercial: "ESTABLECIMIENTO DE EJEMPLO", afiliacionIva: "GEN", codigoEstablecimiento: "2", correo: "", direccion: { direccion: "DIRECCION DE EJEMPLO", codigoPostal: "01010", municipio: "Guatemala", departamento: "Guatemala", pais: "GT" }, frases: [{ tipo: 1, escenario: 2 }] };
      try { const n = construirNuc(facturaDePruebaTest(ej, crypto.randomUUID())); out({ prueba: "validar-nuc", ok: true, camposRaiz: Object.keys(n), items: (n.Items as unknown[]).length, nota: "emisor de ejemplo: solo valida la estructura" }); }
      catch (e) { out({ prueba: "validar-nuc", ok: false, errores: e instanceof NucInvalido ? e.errores : [String(e)] }); Deno.exit(1); }
      return;
    }
    case "listar-establecimientos": {   // SOLO LECTURA: qué establecimientos aparecen en el reporte de acuses de ESTA cuenta (mismo NIT y mismas credenciales); NO inventa códigos
      const c = cliente(Deno.env.get("DIGIFACT_ESQUEMA") === "bearer" ? "bearer" : "raw"); const filas: Awaited<ReturnType<DigifactGt["reporteAcuses"]>> = [];
      // Por etapas: 30, luego 90 y luego 180 días hacia atrás; ventanas de 3 días (máximo del reporte: 2 días de rango), sin repetir lo ya consultado; se DETIENE en cuanto aparecen ≥2 establecimientos
      let consultados = 0, fallidos = 0, truncadas = 0, desde = 0; const etapas: Record<string, unknown>[] = []; let ests = agruparEstablecimientos(filas);
      for (const tope of [30, 90, 180]) {
        for (; desde < tope; desde += 3) { try { const f = await c.reporteAcuses(fechaGt(-(desde + 2) * 86_400_000), { hasta: fechaGt(-desde * 86_400_000), limite: 200 }); consultados++; if (f.length >= 200) truncadas++; filas.push(...f); } catch { fallidos++; } }
        ests = agruparEstablecimientos(filas); etapas.push({ hastaDias: tope, filasVistas: filas.length, establecimientosVistos: ests.length });
        if (ests.length >= 2) break;
      }
      out({ prueba: "listar-establecimientos", ok: true, soloLectura: true, etapas, solicitudes: consultados, solicitudesFallidas: fallidos, ventanasConPosibleTruncamiento: truncadas, filasVistas: filas.length, establecimientos: ests,
        nota: "Para leer el emisor de cada uno: paso «datos-emisor» con «autorizacion» = la autorización de ejemplo del establecimiento. Solo aparecen los establecimientos con documentos en el periodo consultado." });
      return;
    }
    case "datos-emisor": {   // PREPARACIÓN de la certificación: SOLO LECTURA. Muestra los datos validados y la factura exacta que se enviaría
      const ref = Deno.env.get("DIGIFACT_REFERENCIA") ?? ""; if (!UUID.test(ref)) salir("Falta DIGIFACT_REFERENCIA (GUID de 36 caracteres) para mostrar la factura exacta", 2);
      const c = cliente(Deno.env.get("DIGIFACT_ESQUEMA") === "bearer" ? "bearer" : "raw");
      let r; try { r = await descubrirEmisor(c); } catch (e) { out({ prueba: "datos-emisor", ok: false, error: errorLegible(e) }); Deno.exit(1); }
      if (!r.ok) { out({ prueba: "datos-emisor", ok: false, motivo: r.motivo, etiquetasVistas: r.etiquetasVistas, fuente: r.fuente, hallazgos: r.hallazgos }); Deno.exit(1); }
      const problemas = verificarEmisorEsperado(r.datos);
      let nuc: Record<string, unknown> | null = null, errores: unknown = null;
      try { nuc = construirNuc(facturaDePruebaTest(r.datos, ref)); } catch (e) { errores = e instanceof NucInvalido ? e.errores : [String(e)]; }
      // correo de la factura enviado por Digifact (solo si la ejecución lo pide con «con_correo = si»): se muestra ENMASCARADO y se verifica el nodo exacto; sin pedirlo, la salida es la de siempre
      const cp = resolverCorreoDePrueba((k) => Deno.env.get(k)); let correoInfo: Record<string, unknown> | null = null, nucMostrar: Record<string, unknown> | null = nuc, correoOk = true;
      if (cp.estado === "bloqueado") { correoInfo = { estado: "bloqueado", motivo: cp.motivo }; correoOk = false; }
      else if (cp.estado === "listo" && nuc) {
        try { const conC = construirNuc(conCorreo(facturaDePruebaTest(r.datos, ref), cp.correo)); const v = verificarNucConCorreo(nuc, conC, cp.correo);
          correoInfo = { estado: "listo", destinatario: cp.enmascarado, cantidadDeCorreosEnElNuc: v.cantidad, nodoExactoYSinOtrosCambios: v.ok, problemas: v.problemas, nota: "Es una vista previa: NO se envió nada. «Solicitado» no es «entregado»." }; correoOk = v.ok; nucMostrar = nucParaMostrar(conC); }
        catch (e) { correoInfo = { estado: "bloqueado", motivo: "nuc_no_valido_con_correo", errores: e instanceof NucInvalido ? e.errores : [String(e)] }; correoOk = false; }
      }
      out({ prueba: "datos-emisor", ok: problemas.length === 0 && nuc !== null && correoOk, fuente: r.fuente, emisorValidado: r.datos, huellaEmisor: await huellaEmisor(r.datos), discrepanciasConLoEsperado: problemas, errores, facturaQueSeEnviaria: nucMostrar, ...(correoInfo ? { correo: correoInfo } : {}), nota: "IssuedDateTime se fija al momento de ejecutar (hora de Guatemala)" });
      if (problemas.length || !nuc || !correoOk) Deno.exit(1);
      return;
    }
    case "certificar-test": {   // PRUEBA 4: UNA certificación en TEST, solo con la confirmación literal, la referencia mostrada y la huella del emisor aprobada
      if (Deno.env.get("DIGIFACT_CONFIRMAR") !== "CERTIFICAR-TEST") salir("Falta la confirmación explícita: DIGIFACT_CONFIRMAR=CERTIFICAR-TEST", 3);
      const ref = Deno.env.get("DIGIFACT_REFERENCIA") ?? ""; if (!UUID.test(ref)) salir("Falta DIGIFACT_REFERENCIA (la referencia interna que se mostró para aprobar)", 2);
      const aprobada = Deno.env.get("DIGIFACT_HUELLA_EMISOR") ?? ""; if (!/^[0-9a-f]{16}$/.test(aprobada)) salir("Falta DIGIFACT_HUELLA_EMISOR (la huella de los datos del emisor que aprobaste)", 2);
      const cp = resolverCorreoDePrueba((k) => Deno.env.get(k));   // ANTES de cualquier llamada a la red: si se pidió el correo y algo no está en regla, no se envía nada
      if (cp.estado === "bloqueado") { out({ prueba: "certificar-test", ok: false, noSeEnvioNada: true, correo: { estado: "bloqueado", motivo: cp.motivo } }); Deno.exit(1); }
      const c = cliente(Deno.env.get("DIGIFACT_ESQUEMA") === "bearer" ? "bearer" : "raw");
      let r; try { r = await descubrirEmisor(c); } catch (e) { out({ prueba: "certificar-test", ok: false, noSeEnvioNada: true, error: errorLegible(e) }); Deno.exit(1); }
      if (!r.ok) { out({ prueba: "certificar-test", ok: false, noSeEnvioNada: true, motivo: r.motivo }); Deno.exit(1); }
      const huella = await huellaEmisor(r.datos), problemas = verificarEmisorEsperado(r.datos);
      if (huella !== aprobada || problemas.length) { out({ prueba: "certificar-test", ok: false, noSeEnvioNada: true, motivo: huella !== aprobada ? "los datos del emisor ya no coinciden con los que se aprobaron" : "el emisor no coincide con lo esperado", problemas }); Deno.exit(1); }
      let nuc: Record<string, unknown>; try { nuc = construirNuc(facturaDePruebaTest(r.datos, ref)); } catch (e) { out({ prueba: "certificar-test", ok: false, noSeEnvioNada: true, errores: e instanceof NucInvalido ? e.errores : [String(e)] }); Deno.exit(1); }
      if (cp.estado === "listo") {   // el NUC que se envía lleva el correo; se comprueba el nodo exacto y que no cambió nada más, y se evita repetir una referencia ya certificada
        let conC: Record<string, unknown>; try { conC = construirNuc(conCorreo(facturaDePruebaTest(r.datos, ref), cp.correo)); } catch (e) { out({ prueba: "certificar-test", ok: false, noSeEnvioNada: true, correo: { estado: "bloqueado", motivo: "nuc_no_valido_con_correo", errores: e instanceof NucInvalido ? e.errores : [String(e)] } }); Deno.exit(1); }
        const v = verificarNucConCorreo(nuc, conC, cp.correo); if (!v.ok) { out({ prueba: "certificar-test", ok: false, noSeEnvioNada: true, correo: { estado: "bloqueado", motivo: "nodo_de_correo_no_exacto", problemas: v.problemas } }); Deno.exit(1); }
        const er = await estadoDeLaReferencia(c, fechaGt(), ref, Number(r.datos.codigoEstablecimiento)); if (er !== "no_encontrada") { out({ prueba: "certificar-test", ok: false, noSeEnvioNada: true, referenciaInterna: ref, correo: { estado: "bloqueado", motivo: er === "ya_certificada" ? "la_referencia_ya_esta_certificada_no_se_repite" : "no_se_pudo_verificar_que_la_referencia_sea_nueva" } }); Deno.exit(1); }
        nuc = conC;
      }
      let res; try { res = await c.certificar(nuc, { referencia: ref, formatos: ["XML", "PDF"] }); } catch (e) { out({ prueba: "certificar-test", ok: false, referenciaInterna: ref, noSeProceso: true, error: errorLegible(e) }); Deno.exit(1); }
      if (res.tipo === "certificado") {
        const dir = Deno.env.get("DIGIFACT_SALIDA") ?? "./salida"; await Deno.mkdir(dir, { recursive: true });
        const guarda = async (n: string, b64?: string) => { if (b64) await Deno.writeFile(`${dir}/${n}`, Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))); return !!b64; };
        const xml = await guarda(`${res.autorizacion}.xml`, res.artefactos.xml), pdf = await guarda(`${res.autorizacion}.pdf`, res.artefactos.pdf);
        const bytes = (b64?: string) => (b64 ? Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)) : null);
        const bx = bytes(res.artefactos.xml), bp = bytes(res.artefactos.pdf);
        const correoRecibido = cp.estado === "listo" && bx ? (/CorreoReceptor="([^"]*)"/.exec(new TextDecoder().decode(bx))?.[1] ?? null) : null;
        out({ prueba: "certificar-test", ok: true, referenciaInterna: ref, codigoDeRespuesta: res.crudoSaneado.code ?? null, mensaje: res.crudoSaneado.message ?? null, autorizacionUuid: res.autorizacion, serie: res.serie, numero: res.numero, fechaCertificacion: res.fechaCertificacion, xmlRecibido: xml, pdfRecibido: pdf,
          sha256Xml: bx ? await sha256Hex(bx as Uint8Array<ArrayBuffer>) : null, sha256Pdf: bp ? await sha256Hex(bp as Uint8Array<ArrayBuffer>) : null,
          ...(cp.estado === "listo" ? { correo: { estado: "solicitado_a_digifact", destinatario: cp.enmascarado, entregaConfirmada: false, xmlCertificadoTraeCorreoReceptor: correoRecibido === null ? null : correoRecibido.toLowerCase() === cp.correo.toLowerCase(), nota: "Digifact no confirma la entrega: revisa el buzón autorizado y compara los adjuntos con sha256Xml/sha256Pdf." } } : {}) });
      } else if (res.tipo === "rechazado_confirmado") { out({ prueba: "certificar-test", ok: false, referenciaInterna: ref, rechazo: { codigo: res.codigo, mensaje: res.mensaje } }); Deno.exit(1); }
      else {   // desconocido: NUNCA se reenvía; se consulta y se concilia por la referencia interna (hasta 4 consultas espaciadas)
        let conciliacion: unknown = null;
        for (let i = 0; i < 4; i++) { if (i) await new Promise((x) => setTimeout(x, 5000 * i)); const q = await c.conciliarPorReferencia(fechaGt(), ref, 2); conciliacion = q; if (q.tipo === "encontrado") break; }
        out({ prueba: "certificar-test", ok: false, referenciaInterna: ref, resultado: "desconocido", motivo: res.motivo, noSeReenvio: true, conciliacion }); Deno.exit(1);
      }
      return;
    }
    case "consulta-posterior": {   // PRUEBA 5
      const aut = Deno.env.get("DIGIFACT_AUTORIZACION"); if (!aut) salir("Falta DIGIFACT_AUTORIZACION (UUID del DTE certificado)", 2);
      const c = cliente(Deno.env.get("DIGIFACT_ESQUEMA") === "bearer" ? "bearer" : "raw");
      try { const r = await c.consultarDte(aut!); out({ prueba: "consulta-posterior", ok: r.encontrado, resultado: r.encontrado ? { ...r, xmlB64: r.xmlB64 ? "(presente)" : undefined } : r }); if (!r.encontrado) Deno.exit(1); }
      catch (e) { out({ prueba: "consulta-posterior", ok: false, error: errorLegible(e) }); Deno.exit(1); }
      return;
    }
    case "descargar": {
      const aut = Deno.env.get("DIGIFACT_AUTORIZACION"); if (!aut) salir("Falta DIGIFACT_AUTORIZACION (UUID del DTE certificado)", 2);
      const c = cliente(Deno.env.get("DIGIFACT_ESQUEMA") === "bearer" ? "bearer" : "raw");
      try { const r = await c.obtenerDocumento(aut!, ["XML", "PDF"]); const h = async (b64?: string) => (b64 ? await sha256Hex(Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)) as Uint8Array<ArrayBuffer>) : null); out({ prueba: "descargar", ok: r.encontrado, xml: r.encontrado && !!r.artefactos.xml, pdf: r.encontrado && !!r.artefactos.pdf, sha256Xml: r.encontrado ? await h(r.artefactos.xml) : null, sha256Pdf: r.encontrado ? await h(r.artefactos.pdf) : null }); if (!r.encontrado) Deno.exit(1); }
      catch (e) { out({ prueba: "descargar", ok: false, error: errorLegible(e) }); Deno.exit(1); }
      return;
    }
    default: salir("Uso: digifact_prueba.ts <autenticar|credenciales-presentes|consultar-nit-privado|consultar-cui-privado|validar-nuc|datos-emisor|certificar-test|consulta-posterior|descargar>", 2);
  }
}
if (import.meta.main) await main();
