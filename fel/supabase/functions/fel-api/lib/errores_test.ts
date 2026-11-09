import { assertEquals } from "jsr:@std/assert@1";
import { traducirErrorPg } from "./errores.ts";

Deno.test("traduce los errores FEL_ a códigos HTTP y quita el prefijo", () => {
  const casos: [string, number, string][] = [
    ["FEL_NO_AUTORIZADO: no puedes asignar ese rol", 403, "no puedes asignar ese rol"],
    ["FEL_NO_ENCONTRADO: cliente no encontrado", 404, "cliente no encontrado"],
    ["FEL_CONFLICTO: el cliente cambió", 409, "el cliente cambió"],
    ["FEL_REGLA: falta el motivo", 422, "falta el motivo"],
  ];
  for (const [msg, status, texto] of casos) {
    const e = traducirErrorPg({ message: msg });
    assertEquals([e.status, e.message], [status, texto]);
  }
});

Deno.test("traduce códigos de PostgreSQL sin filtrar texto interno", () => {
  assertEquals(traducirErrorPg({ code: "23505", message: 'duplicate key value violates unique constraint "clientes_nit_uq"' }).status, 409);
  assertEquals(traducirErrorPg({ code: "23514", message: "new row violates check constraint" }).status, 422);
  assertEquals(traducirErrorPg({ code: "23503", message: "foreign key" }).status, 422);
  assertEquals(traducirErrorPg({ code: "42501", message: "permission denied" }).status, 403);
  const raro = traducirErrorPg({ code: "XX000", message: "relation public.secreta does not exist" });
  assertEquals([raro.status, raro.message], [500, "Error interno"]);
  assertEquals(traducirErrorPg(null).status, 500);
});
