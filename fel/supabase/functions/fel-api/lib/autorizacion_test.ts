import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { ErrorFel } from "./errores.ts";
import { evaluar, type Estado } from "./autorizacion.ts";

const base: Estado = { esPlataforma: false, permisos: [], aal: "aal1" };
const codigo = (f: () => void) => (assertThrows(f, ErrorFel) as ErrorFel).codigo;

Deno.test("sin requisitos: pasa", () => evaluar({}, base));

Deno.test("plataforma: solo el administrador maestro", () => {
  assertEquals(codigo(() => evaluar({ plataforma: true }, base)), "no_autorizado");
  evaluar({ plataforma: true }, { ...base, esPlataforma: true });
});

Deno.test("permiso: debe estar en los efectivos; null o vacío no pasa", () => {
  assertEquals(codigo(() => evaluar({ permiso: "clientes.escribir" }, base)), "no_autorizado");
  assertEquals(codigo(() => evaluar({ permiso: "clientes.escribir" }, { ...base, permisos: null })), "no_autorizado");
  assertEquals(codigo(() => evaluar({ permiso: "clientes.escribir" }, { ...base, permisos: ["clientes.ver"] })), "no_autorizado");
  evaluar({ permiso: "clientes.escribir" }, { ...base, permisos: ["clientes.escribir"] });
});

Deno.test("MFA: exige aal2", () => {
  assertEquals(codigo(() => evaluar({ aal2: true }, base)), "mfa_requerido");
  assertEquals(codigo(() => evaluar({ aal2: true }, { ...base, aal: undefined })), "mfa_requerido");
  evaluar({ aal2: true }, { ...base, aal: "aal2" });
});

Deno.test("un administrador maestro sin MFA no pasa; sin ser maestro, tampoco con MFA", () => {
  assertEquals(codigo(() => evaluar({ plataforma: true, aal2: true }, { ...base, esPlataforma: true })), "mfa_requerido");
  assertEquals(codigo(() => evaluar({ plataforma: true, aal2: true }, { ...base, aal: "aal2" })), "no_autorizado");
  evaluar({ plataforma: true, aal2: true }, { esPlataforma: true, permisos: null, aal: "aal2" });
});
