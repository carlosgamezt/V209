import assert from "node:assert/strict";
import { Sesiones } from "../src/sesiones.ts";

Deno.test("sesiones: entrar, validar, salir; contraseña errónea y usuario inexistente se tratan igual", async () => {
  let t = 1_000_000; const s = new Sesiones(() => t); await s.registrar("ana", "clave-correcta");
  assert.equal((await s.entrar("ana", "mala", false)).sesion, null); assert.equal((await s.entrar("nadie", "x", false)).sesion, null);
  const { sesion } = await s.entrar("ana", "clave-correcta", false); assert.ok(sesion); assert.match(sesion!.id, /^[0-9a-f]{64}$/);
  assert.equal(s.validar(sesion!.id)?.usuario, "ana"); assert.equal(s.validar("0".repeat(64)), null); assert.equal(s.validar(null), null);
  s.salir(sesion!.id); assert.equal(s.validar(sesion!.id), null);
});
Deno.test("sesiones: caducidad por inactividad (30 min) y por tiempo máximo; «recordar» dura 7 días de inactividad y 14 como máximo", async () => {
  let t = 0; const s = new Sesiones(() => t); await s.registrar("ana", "c");
  const n = (await s.entrar("ana", "c", false)).sesion!; t += 29 * 60_000; assert.ok(s.validar(n.id)); t += 29 * 60_000; assert.ok(s.validar(n.id), "la actividad renueva"); t += 31 * 60_000; assert.equal(s.validar(n.id), null);
  const r = (await s.entrar("ana", "c", true)).sesion!; for (let i = 0; i < 6; i++) { t += 2 * 86_400_000; assert.ok(s.validar(r.id), `día ${(i + 1) * 2}`); }   // 12 días activa
  t += 2.5 * 86_400_000; assert.equal(s.validar(r.id), null, "pasó el máximo de 14 días");
  const r2 = (await s.entrar("ana", "c", true)).sesion!; t += 8 * 86_400_000; assert.equal(s.validar(r2.id), null, "8 días sin actividad");
});
Deno.test("sesiones: bloqueo tras 5 intentos fallidos; el bloqueo cede con el tiempo; cambiar la clave cierra las sesiones", async () => {
  let t = 0; const s = new Sesiones(() => t); await s.registrar("ana", "buena");
  for (let i = 0; i < 5; i++) assert.equal((await s.entrar("ana", "mala" + i, false)).sesion, null);
  const b = await s.entrar("ana", "buena", false); assert.equal(b.sesion, null); assert.equal(b.bloqueado, true, "ni la clave correcta entra mientras dura el bloqueo");
  t += 61_000; const ok = await s.entrar("ana", "buena", false); assert.ok(ok.sesion);
  await s.cambiarClave("ana", "nueva"); assert.equal(s.validar(ok.sesion!.id), null); assert.ok((await s.entrar("ana", "nueva", false)).sesion);
});
Deno.test("sesiones: cookie HttpOnly + SameSite=Strict; Secure bajo HTTPS; la lectura rechaza valores ajenos", async () => {
  const s = new Sesiones(); await s.registrar("ana", "c"); const x = (await s.entrar("ana", "c", true)).sesion!;
  const c = Sesiones.cookie(x, true); assert.match(c, /HttpOnly/); assert.match(c, /SameSite=Strict/); assert.match(c, /Secure/); assert.match(c, /Max-Age=1209600/);
  assert.doesNotMatch(Sesiones.cookie(x, false), /Secure/); assert.doesNotMatch(Sesiones.cookie((await s.entrar("ana", "c", false)).sesion!, false), /Max-Age/, "la sesión normal muere con el navegador");
  assert.match(Sesiones.cookie(null, false), /Max-Age=0/);
  assert.equal(Sesiones.idDeCookie(new Request("http://x/", { headers: { cookie: `a=1; fel_sid=${x.id}` } })), x.id); assert.equal(Sesiones.idDeCookie(new Request("http://x/", { headers: { cookie: "fel_sid=abc" } })), null);
});
