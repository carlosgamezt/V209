// Cobertura de reglas: TODA regla del registro debe tener fuente completa, existir en los recursos oficiales y tener al menos una prueba cuyo nombre la identifique.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { REGLAS } from "../src/reglas.ts";
import { leerManifiesto } from "../src/recursos.ts";
import { rec } from "./ayudas.ts";

Deno.test("[COBERTURA] cada regla registrada tiene al menos una prueba que la nombra [ID]", async () => {
  const nombres: string[] = [];
  for await (const f of Deno.readDir(new URL(".", import.meta.url))) if (f.name.endsWith("_test.ts")) {
    const t = await Deno.readTextFile(new URL(f.name, import.meta.url)); for (const m of t.matchAll(/Deno\.test\(\s*"([^"]+)"/g)) nombres.push(m[1]);
  }
  const sin = REGLAS.filter((r) => !nombres.some((n) => n.includes(`[${r.id}]`))).map((r) => r.id); assertEquals(sin, []);
  assertEquals(new Set(REGLAS.map((r) => r.id)).size, REGLAS.length); // ids únicos
});
Deno.test("[COBERTURA] cada regla de origen SAT identifica archivo oficial del manifiesto, versión y ubicación", async () => {
  const m = await leerManifiesto();
  for (const r of REGLAS) {
    assert(r.descripcion.length > 10 && r.ubicacion.length > 0, r.id);
    if (r.origen === "SAT") { const a = m.archivos.find((x) => x.ruta === r.recurso); assert(a, `${r.id}: recurso ${r.recurso} no está en el manifiesto`); assertEquals(a!.version, r.version, r.id); }
    else { assertEquals(r.recurso, "autorizacion-D1-A"); }
  }
});
Deno.test("[COBERTURA] los códigos de mensaje citados en las reglas existen en el catálogo oficial de mensajes 0.3.0", () => {
  for (const r of REGLAS.filter((x) => x.recurso.includes("catalogoMensajes"))) for (const c of r.ubicacion.match(/(?:RCP|SEC|INF)\d{3}/g) ?? []) assert(rec.mensajes.has(`FEL_${c}`) || rec.mensajes.has(c), `${r.id}: ${c}`);
});
Deno.test("[COBERTURA] el texto oficial de cada regla aritmética respalda lo implementado (palabras clave del catálogo de mensajes)", () => {
  const t = (c: string) => rec.mensajes.get(`FEL_${c}`)!.validacion;
  assert(/Cantidad/.test(t("RCP313")) && /PrecioUnitario/.test(t("RCP313")));
  assert(/1\.12/.test(t("RCP226")) && /Precio/.test(t("RCP226")));
  assert(/Monto gravable/i.test(t("RCP331")));
  assert(/excepto el IVA/.test(t("RCP348")));
  assert(/sumatoria/.test(t("RCP349")) && /sumatoria/.test(t("RCP332")));
  assert(/RANT/.test(t("RCP487")) && /posterior al último día del mes/.test(t("RCP301")));
});
