import { assertEquals } from "jsr:@std/assert@1";
import { decodificarClaims } from "./jwt.ts";

export const fabricarToken = (claims: Record<string, unknown>) => {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "HS256" })}.${b64(claims)}.firma`;
};

Deno.test("lee aal y sub del token", () => {
  const c = decodificarClaims(fabricarToken({ sub: "u1", aal: "aal2" }));
  assertEquals([c.sub, c.aal], ["u1", "aal2"]);
});

Deno.test("un token mal formado no rompe: devuelve vacío", () => {
  assertEquals(decodificarClaims("basura"), {});
  assertEquals(decodificarClaims("a.b.c"), {});
  assertEquals(decodificarClaims(""), {});
});
