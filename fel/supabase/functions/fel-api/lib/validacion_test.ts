import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { ErrorFel } from "./errores.ts";
import * as v from "./validacion.ts";

const falla = (f: () => unknown, parte = "") => {
  const e = assertThrows(f, ErrorFel);
  assertEquals((e as ErrorFel).status, 400);
  if (parte) assertEquals((e as ErrorFel).message.includes(parte), true, (e as ErrorFel).message);
};

Deno.test("texto recorta, exige largo y rechaza caracteres de control", () => {
  assertEquals(v.texto({ a: "  hola  " }, "a", 1, 10), "hola");
  falla(() => v.texto({ a: "   " }, "a", 1, 10), "a");
  falla(() => v.texto({ a: "x".repeat(11) }, "a", 1, 10));
  falla(() => v.texto({}, "a", 1, 10));
  falla(() => v.texto({ a: 5 }, "a", 1, 10));
  falla(() => v.texto({ a: "mal\u0000dito" }, "a", 1, 10));
});

Deno.test("textoOpt devuelve null si viene vacío", () => {
  assertEquals(v.textoOpt({}, "a", 10), null);
  assertEquals(v.textoOpt({ a: "  " }, "a", 10), null);
  assertEquals(v.textoOpt({ a: "ok" }, "a", 10), "ok");
});

Deno.test("soloCampos rechaza campos no permitidos (mass assignment)", () => {
  v.soloCampos({ accion: "x", nombre: "a" }, ["nombre"]);
  falla(() => v.soloCampos({ accion: "x", nombre: "a", empresa_id: "1" }, ["nombre"]), "empresa_id");
  falla(() => v.soloCampos({ estado: "certificada" }, []), "estado");
  falla(() => v.soloCampos({ serie: "A" }, ["nombre"]), "serie");
});

Deno.test("uuid", () => {
  assertEquals(v.uuid({ a: "10000000-0000-0000-0000-00000000000A" }, "a"), "10000000-0000-0000-0000-00000000000a");
  falla(() => v.uuid({ a: "1; drop table x" }, "a"));
  falla(() => v.uuid({ a: 1 }, "a"));
  assertEquals(v.uuidOpt({}, "a"), null);
});

Deno.test("email", () => {
  assertEquals(v.email({ a: "Persona@Empresa.GT" }, "a"), "persona@empresa.gt");
  falla(() => v.email({ a: "sin-arroba" }, "a"));
  falla(() => v.email({ a: "a b@c.com" }, "a"));
  assertEquals(v.emailOpt({}, "a"), null);
});

Deno.test("nit: formato, K mayúscula y CF solo si se permite", () => {
  assertEquals(v.nit({ a: "1234567-8" }, "a"), "1234567-8");
  assertEquals(v.nit({ a: "7654321-k" }, "a"), "7654321-K");
  assertEquals(v.nit({ a: "12345678" }, "a"), "12345678");
  falla(() => v.nit({ a: "CF" }, "a"));
  assertEquals(v.nit({ a: "cf" }, "a", true), "CF");
  falla(() => v.nit({ a: "ABC" }, "a", true));
  falla(() => v.nit({ a: "1-2-3" }, "a"));
});

Deno.test("montoNoNegativo conserva el texto exacto y rechaza lo peligroso", () => {
  assertEquals(v.montoNoNegativo({ a: "125.50" }, "a"), "125.50");
  assertEquals(v.montoNoNegativo({ a: 0.1 }, "a"), "0.1");
  assertEquals(v.montoNoNegativo({ a: "12.345678" }, "a"), "12.345678");
  falla(() => v.montoNoNegativo({ a: "12.3456789" }, "a"));
  falla(() => v.montoNoNegativo({ a: "-1" }, "a"));
  falla(() => v.montoNoNegativo({ a: "1e5" }, "a"));
  falla(() => v.montoNoNegativo({ a: NaN }, "a"));
  falla(() => v.montoNoNegativo({ a: Infinity }, "a"));
  falla(() => v.montoNoNegativo({ a: "" }, "a"));
});

Deno.test("enumerado, entero, booleano, lista de permisos", () => {
  assertEquals(v.enumerado({ r: "lector" }, "r", ["lector", "emisor"] as const), "lector");
  falla(() => v.enumerado({ r: "root" }, "r", ["lector", "emisor"] as const));
  assertEquals(v.entero({ n: 3 }, "n"), 3);
  falla(() => v.entero({ n: 1.5 }, "n"));
  falla(() => v.entero({ n: "3" }, "n"));
  falla(() => v.entero({ n: 0 }, "n"));
  assertEquals(v.booleano({ b: false }, "b"), false);
  falla(() => v.booleano({ b: "si" }, "b"));
  assertEquals(v.listaPermisos({}, "p"), null);
  assertEquals(v.listaPermisos({ p: ["clientes.ver", "clientes.ver"] }, "p"), ["clientes.ver"]);
  falla(() => v.listaPermisos({ p: ["CLIENTES"] }, "p"));
  falla(() => v.listaPermisos({ p: "clientes.ver" }, "p"));
});

Deno.test("objeto rechaza arreglos y null", () => {
  assertEquals(v.objeto({ o: { a: 1 } }, "o"), { a: 1 });
  falla(() => v.objeto({ o: [] }, "o"));
  falla(() => v.objeto({ o: null }, "o"));
});
