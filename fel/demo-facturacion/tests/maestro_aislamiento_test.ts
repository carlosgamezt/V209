// AISLAMIENTO del administrador de la plataforma (maestro) en el código: sus rutas NO leen documentos, clientes, conceptos, operaciones fiscales, artefactos, auditoría ni credenciales/configuración fiscal de Digifact,
// y el enrutador lo manda SIEMPRE a `rutasMaestro` (jamás a las rutas de una empresa). Guardián estático: si alguien agrega una consulta prohibida a las rutas del maestro, esta prueba falla.
import assert from "node:assert/strict";
const leer = (r: string) => Deno.readTextFileSync(new URL(r, import.meta.url));
const PROHIBIDAS = ["documentos", "documento_lineas", "documento_estados", "clientes", "conceptos", "operaciones_fiscales", "digifact_operaciones", "digifact_artefactos", "artefactos_documento", "auditoria", "conciliaciones",
  "eventos_proveedor", "empresa_digifact_config", "empresa_digifact_eventos", "empresa_emisor_versiones", "acceso_maestro_datos", "demo_credenciales", "demo_sesiones", "ordenes_emision", "alertas_fiscales", "establecimientos", "empresa_canales"];
const PERMITIDAS_RPC = /^fel_admin_[a-z_]+$|^fel_sys_bolson_revisar$/;
function tramo(): string { const t = leer("../src/api_practico.ts"), i = t.indexOf("async rutasMaestro"), j = t.indexOf("async verificacion", i); assert.ok(i > 0 && j > i, "no se encontró el tramo de rutasMaestro"); return t.slice(i, j); }

Deno.test("maestro: sus rutas no consultan tablas fiscales ni de credenciales", () => {
  const seg = tramo(), usadas = new Set([...seg.matchAll(/\b(?:from|join|into|update|delete\s+from)\s+(?:public\.)?([a-z_][a-z_0-9]*)\b/gi)].map((m) => m[1].toLowerCase()));
  const malas = PROHIBIDAS.filter((t) => usadas.has(t) || new RegExp(`\\bpublic\\.${t}\\b`).test(seg)); assert.deepEqual(malas, [], `rutasMaestro consulta tablas prohibidas: ${malas.join(", ")}`);
  assert.ok(usadas.size >= 10, "el análisis encontró las consultas del panel (si no, el guardián no sirve)");
  const rpcs = [...seg.matchAll(/rpc\(\s*"([a-z_0-9]+)"/g)].map((m) => m[1]); assert.ok(rpcs.length >= 10);
  assert.deepEqual(rpcs.filter((r) => !PERMITIDAS_RPC.test(r)), [], "solo funciones de administración de la plataforma");
});

Deno.test("maestro: el enrutador lo envía siempre a rutasMaestro, antes de cualquier ruta de empresa", () => {
  const t = leer("../src/api.ts"), a = t.indexOf("esMaestro(a.clave)"), b = t.indexOf("manejar(req, url)", a);
  assert.ok(a > 0 && b > a, "el desvío del maestro debe estar ANTES de manejar()"); assert.match(t.slice(a - 30, a + 260), /return await (peticion\.run\(\{[^}]*\}, \(\) => )?pr\.rutasMaestro\(req, url, a\)/);   // directo, o dentro del contexto de la petición (identidad de sesión, R2)
  const seg = tramo(); assert.match(seg, /throw new ErrorPr\(403, "Esta función no está disponible para el administrador de la plataforma"/, "lo desconocido se niega (falla cerrado)");
});

Deno.test("maestro: ninguna función de la base que consulta documentos o credenciales forma parte de su lista", () => {
  const seg = tramo(); for (const mala of ["fel_sys_digifact_credencial", "fel_sys_emisor_vigente", "fel_op_digifact_conectar", "fel_sys_documento_instantanea", "fel_admin_datos_excepcionales"]) assert.ok(!seg.includes(mala), `rutasMaestro no debe llamar a ${mala}`);
});
