// Pruebas REALES contra Digifact TEST (solo TEST; producción está bloqueada en el cliente). Se ejecutan a mano desde el workflow «NEXA FEL · Digifact TEST» o en un servidor con las variables definidas.
//   deno run --allow-net=testnucgt.digifact.com --allow-env=DIGIFACT_TEST_USERNAME,DIGIFACT_TEST_PASSWORD,DIGIFACT_TEST_NIT,DIGIFACT_CONFIRMAR,DIGIFACT_NIT_CONSULTA,DIGIFACT_AUTORIZACION,DIGIFACT_ESQUEMA,DIGIFACT_SALIDA,DIGIFACT_EMISOR_NOMBRE --allow-read --allow-write=./salida digifact_prueba.ts <paso>
// Pasos:  autenticar · consultar-nit · validar-nuc · certificar-test · consulta-posterior · descargar
// NUNCA imprime la contraseña ni el token; solo «sí/no», códigos, UUID, serie, número y fechas.
import { crearDigifactGt, DigifactGt, ErrorDigifact, nit12 } from "./src/digifact_gt.ts";
import { construirNuc, NucInvalido, type FacturaGt } from "./src/nuc_gt.ts";

const NECESARIAS = ["DIGIFACT_TEST_USERNAME", "DIGIFACT_TEST_PASSWORD", "DIGIFACT_TEST_NIT"] as const;
const salir = (m: string, c = 1): never => { console.error(m); Deno.exit(c); };
const out = (o: Record<string, unknown>) => console.log(JSON.stringify(o, null, 2));
const paso = Deno.args[0] ?? "";

function cliente(esquema: "raw" | "bearer"): DigifactGt {
  const faltan = NECESARIAS.filter((n) => !Deno.env.get(n));
  if (faltan.length) salir(`Faltan variables de entorno (solo se indican los NOMBRES): ${faltan.join(", ")}`, 2);
  return crearDigifactGt({ ambiente: "test", nit: Deno.env.get("DIGIFACT_TEST_NIT")!, usuario: Deno.env.get("DIGIFACT_TEST_USERNAME")!, obtenerClave: () => Deno.env.get("DIGIFACT_TEST_PASSWORD")!, esquemaAutorizacion: esquema, tiempoMaximoMs: 30_000 });
}
const errorLegible = (e: unknown) => e instanceof ErrorDigifact ? { tipo: e.tipo, estadoHttp: e.estadoHttp ?? null, mensaje: e.message } : { tipo: "inesperado", mensaje: e instanceof Error ? e.name : "error" };

/** Factura de PRUEBA (TEST): datos del emisor TEST entregados por Digifact. La dirección del establecimiento es la del ejemplo oficial hasta confirmar la real. Montos desglosados a mano (NEXA no calcula IVA). */
export function facturaDePruebaTest(nit: string, referenciaInterna: string, nombreEmisor = "EMISOR DE PRUEBA NEXA FEL"): FacturaGt {
  return {
    tipoDoc: "FACT", fechaEmision: new Date(Date.now() - 6 * 3600_000).toISOString().replace(/\.\d{3}Z$/, "-06:00"), moneda: "GTQ", referenciaInterna,
    emisor: {
      nit: String(Number(nit)), nombre: nombreEmisor, afiliacionIva: "GEN", frases: [{ tipo: 1, escenario: 2 }],
      establecimiento: { codigo: 2, nombre: "ESTABLECIMIENTO DE PRUEBA", direccion: { direccion: "4 AVENIDA 15-70 ZONA 10 LOCAL 3 EDIFICIO PALADIUM", codigoPostal: "01010", municipio: "Guatemala", departamento: "Guatemala", pais: "GT" } },
    },
    receptor: { tipoId: "CF", id: "CF", nombre: "CONSUMIDOR FINAL", direccion: { direccion: "CIUDAD", codigoPostal: "01010", municipio: "GUATEMALA", departamento: "GUATEMALA", pais: "GT" } },
    items: [{ tipo: "Servicio", descripcion: "Servicio de prueba NEXA FEL (TEST)", cantidad: "1", unidad: "SER", precioUnitario: "100", descuento: "0", impuestos: [{ codigoUnidadGravable: 1, nombre: "IVA", gravable: "89.285714", monto: "10.714286" }], totalItem: "100" }],
  };
}

async function main() {
  switch (paso) {
    case "autenticar": {   // PRUEBA 1
      const c = cliente("raw");
      try { await c.token(); const s = c.estadoSesion(); out({ prueba: "autenticar", ok: true, tokenObtenido: s.activa, venceEnSegundos: s.venceEnS, ambiente: "TEST", nitConsultado: nit12(Deno.env.get("DIGIFACT_TEST_NIT")!) }); }
      catch (e) { out({ prueba: "autenticar", ok: false, error: errorLegible(e) }); Deno.exit(1); }
      return;
    }
    case "consultar-nit": {   // PRUEBA 2 (GET seguro: se prueba sin prefijo y, si Digifact lo rechaza con 401, con «Bearer»)
      const nit = Deno.env.get("DIGIFACT_NIT_CONSULTA") || Deno.env.get("DIGIFACT_TEST_NIT")!;
      for (const esq of ["raw", "bearer"] as const) {
        const c = cliente(esq);
        try { const r = await c.consultarNit(nit); out({ prueba: "consultar-nit", ok: true, esquemaAutorizacionQueFunciona: esq === "raw" ? "token sin prefijo" : "Bearer", resultado: r }); return; }
        catch (e) { if (e instanceof ErrorDigifact && e.tipo === "no_autorizado" && esq === "raw") continue; out({ prueba: "consultar-nit", ok: false, esquemaProbado: esq, error: errorLegible(e) }); Deno.exit(1); }
      }
      return;
    }
    case "validar-nuc": {   // PRUEBA 3 (sin red): construye y valida la factura de prueba
      try { const ref = crypto.randomUUID(); const n = construirNuc(facturaDePruebaTest(Deno.env.get("DIGIFACT_TEST_NIT") ?? "5888492", ref, Deno.env.get("DIGIFACT_EMISOR_NOMBRE") || undefined)); out({ prueba: "validar-nuc", ok: true, camposRaiz: Object.keys(n), items: (n.Items as unknown[]).length }); }
      catch (e) { out({ prueba: "validar-nuc", ok: false, errores: e instanceof NucInvalido ? e.errores : [String(e)] }); Deno.exit(1); }
      return;
    }
    case "certificar-test": {   // PRUEBA 4: UNA certificación en TEST, solo con la confirmación literal
      if (Deno.env.get("DIGIFACT_CONFIRMAR") !== "CERTIFICAR-TEST") salir("Falta la confirmación explícita: DIGIFACT_CONFIRMAR=CERTIFICAR-TEST", 3);
      const esq = Deno.env.get("DIGIFACT_ESQUEMA") === "bearer" ? "bearer" : "raw"; const c = cliente(esq);
      const ref = crypto.randomUUID();
      let nuc: Record<string, unknown>; try { nuc = construirNuc(facturaDePruebaTest(Deno.env.get("DIGIFACT_TEST_NIT")!, ref, Deno.env.get("DIGIFACT_EMISOR_NOMBRE") || undefined)); } catch (e) { out({ prueba: "certificar-test", ok: false, errores: e instanceof NucInvalido ? e.errores : [String(e)] }); Deno.exit(1); }
      let r; try { r = await c.certificar(nuc, { referencia: ref, formatos: ["XML", "PDF"] }); } catch (e) { out({ prueba: "certificar-test", ok: false, referenciaInterna: ref, noSeProceso: true, error: errorLegible(e) }); Deno.exit(1); }
      if (r.tipo === "certificado") {
        const dir = Deno.env.get("DIGIFACT_SALIDA") ?? "./salida"; await Deno.mkdir(dir, { recursive: true });
        const guarda = async (n: string, b64?: string) => { if (b64) await Deno.writeFile(`${dir}/${n}`, Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))); return !!b64; };
        const xml = await guarda(`${r.autorizacion}.xml`, r.artefactos.xml), pdf = await guarda(`${r.autorizacion}.pdf`, r.artefactos.pdf);
        out({ prueba: "certificar-test", ok: true, referenciaInterna: ref, autorizacion: r.autorizacion, serie: r.serie, numero: r.numero, fechaCertificacion: r.fechaCertificacion, xmlRecibido: xml, pdfRecibido: pdf });
      } else if (r.tipo === "rechazado_confirmado") { out({ prueba: "certificar-test", ok: false, referenciaInterna: ref, rechazo: { codigo: r.codigo, mensaje: r.mensaje } }); Deno.exit(1); }
      else {   // desconocido: NO se reenvía; se concilia por la referencia interna
        const hoy = new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
        out({ prueba: "certificar-test", ok: false, referenciaInterna: ref, resultado: "desconocido", motivo: r.motivo, conciliacion: await c.conciliarPorReferencia(hoy, ref, 2) }); Deno.exit(1);
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
      try { const r = await c.obtenerDocumento(aut!, ["XML", "PDF"]); out({ prueba: "descargar", ok: r.encontrado, xml: r.encontrado && !!r.artefactos.xml, pdf: r.encontrado && !!r.artefactos.pdf }); if (!r.encontrado) Deno.exit(1); }
      catch (e) { out({ prueba: "descargar", ok: false, error: errorLegible(e) }); Deno.exit(1); }
      return;
    }
    default: salir("Uso: digifact_prueba.ts <autenticar|consultar-nit|validar-nuc|certificar-test|consulta-posterior|descargar>", 2);
  }
}
if (import.meta.main) await main();
