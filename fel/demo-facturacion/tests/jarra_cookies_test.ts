import assert from "node:assert/strict";
import { JarraCookies } from "../nube/jarra_cookies.ts";

Deno.test("jarra de cookies: una cookie ajena (Cloudflare __cf_bm) NO pisa la de sesión; salir la borra", () => {
  const j = new JarraCookies();
  assert.equal(j.cabecera(), "");
  assert.deepEqual(j.guardar(["nexa_sesion=abc123; Path=/; HttpOnly; SameSite=Strict; Secure"]), ["nexa_sesion"]);
  assert.deepEqual(j.guardar(["__cf_bm=zzz; path=/; expires=Tue, 17-Nov-26 13:10:00 GMT; domain=.pages.dev; HttpOnly; Secure; SameSite=None"]), ["__cf_bm"]);
  assert.equal(j.cabecera(), "nexa_sesion=abc123; __cf_bm=zzz", "se conservan las dos");
  j.guardar(["__cf_bm=nueva; path=/"]); assert.equal(j.cabecera(), "nexa_sesion=abc123; __cf_bm=nueva", "se actualiza la ajena sin tocar la de sesión");
  j.guardar(["nexa_sesion=; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=0"]); assert.equal(j.cabecera(), "__cf_bm=nueva", "salir borra solo la de sesión");
  j.guardar(["otra=1; Max-Age=0"]); assert.equal(j.cabecera(), "__cf_bm=nueva");
});
