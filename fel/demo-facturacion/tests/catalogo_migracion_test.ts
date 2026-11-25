// El catálogo del código (catalogo_dte.ts) y el de la base (propuesta de migración de tipos, tabla fel_tipos_dte) deben decir LO MISMO: una prueba los compara campo por campo.
// Uso: deno test -A tests/catalogo_migracion_test.ts   (lee el archivo de la migración: por eso vive aquí y no en proveedores/pruebas, que se ejecuta sin permiso de lectura)
import assert from "node:assert/strict";
import { CATALOGO_DTE } from "../../proveedores/src/catalogo_dte.ts";

const SQL = await Deno.readTextFile(new URL("../../supabase/migrations/20261115000100_fel_tipos_documento.sql", import.meta.url));
const bloque = SQL.slice(SQL.indexOf("insert into public.fel_tipos_dte"), SQL.indexOf("-- El catálogo es de solo lectura"));
const filas = [...bloque.matchAll(/\(\s*'([A-Z]{4})',\s*'([^']*)',\s*'(\w+)',\s*'(\w+)',\s*(true|false),\s*(true|false),\s*(true|false),\s*(?:'\{\}'|array\[([^\]]*)\])::text\[\]\)/g)]
  .map((m) => ({ codigo: m[1], nombre: m[2].replace(/''/g, "'"), familia: m[3], disponibilidad: m[4], cert: m[5] === "true", explicita: m[6] === "true", origen: m[7] === "true", permitidos: m[8] ? [...m[8].matchAll(/'(\w+)'/g)].map((x) => x[1]) : [] }));

Deno.test("catálogo del código = catálogo de la base (propuesta de migración de tipos): mismos tipos y mismos campos", () => {
  assert.equal(filas.length, CATALOGO_DTE.length, "mismo número de tipos");
  assert.deepEqual(filas.map((f) => f.codigo), CATALOGO_DTE.map((t) => t.codigo), "mismos códigos y mismo orden");
  for (const t of CATALOGO_DTE) {
    const f = filas.find((x) => x.codigo === t.codigo)!;
    assert.equal(f.nombre, t.nombre, t.codigo); assert.equal(f.familia, t.familia, t.codigo); assert.equal(f.disponibilidad, t.disponibilidad, t.codigo);
    assert.equal(f.cert, t.certificacionHabilitada, `${t.codigo}: certificación habilitada`); assert.equal(f.explicita, t.habilitacionExplicita, `${t.codigo}: habilitación explícita`);
    assert.equal(f.origen, t.requiereOrigen, `${t.codigo}: requiere origen`); assert.deepEqual(f.permitidos, t.origenesPermitidos, `${t.codigo}: orígenes permitidos`);
  }
});
Deno.test("la propuesta de migración de tipos solo habilita certificar FACT y lo impone con una restricción de la tabla", () => {
  assert.deepEqual(filas.filter((f) => f.cert).map((f) => f.codigo), ["FACT"]);
  assert.match(SQL, /check \(not certificacion_habilitada or disponibilidad = 'implementado'\)/);
  assert.match(SQL, /create trigger fel_operacion_tipo_guard_t before insert on public\.operaciones_fiscales/);
  assert.match(SQL, /fel_tipos_instalar_guardian_digifact/, "el guardián de las operaciones de la 29 se instala aparte");
});
Deno.test("la propuesta de migración de tipos no toca la 29 ni crea nada fuera de su alcance: no hay GRANT a anon/authenticated sobre funciones y las tablas son de solo lectura para el cliente", () => {
  assert.doesNotMatch(SQL, /grant execute on function[^;]*to (anon|authenticated)/i);
  assert.doesNotMatch(SQL, /grant (insert|update|delete|all)[^;]*to (anon|authenticated)/i);
  assert.doesNotMatch(SQL, /digifact_operaciones[^;]*(alter|drop|truncate|delete|update)/i, "no modifica la tabla de la migración 29");
  assert.doesNotMatch(SQL, /\bdrop (table|function|policy|trigger|column|constraint)\b/i, "la migración no elimina nada");
  const alter = [...SQL.matchAll(/\balter (table|function) public\.(\w+)/gi)].map((m) => m[2]);
  assert.deepEqual([...new Set(alter)].sort(), ["documentos", "empresa_tipos_documento", "fel_tipos_dte"], "solo modifica documentos (columnas nuevas y restricciones) y activa RLS en sus dos tablas nuevas");
});
