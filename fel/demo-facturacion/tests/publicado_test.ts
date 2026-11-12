import assert from "node:assert/strict";
import { LimiteTasa } from "../src/limite.ts";
import { leerConfigPublicada } from "../src/publicado.ts";

const USU = ["maestro", "maestro2", "ana", "luis", "marta", "pedro", "sofia"];
const OK = { FEL_DEMO_CLAVES: "maestro=Aaaa-bbbb-cccc-1,maestro2=Dddd-eeee-ffff-2,ana=Gggg-hhhh-iiii-3", FEL_DEMO_MFA_SEMILLAS: "maestro=JBSWY3DPEHPK3PXP,maestro2=KRSXG5CTMVRXEZLU", FEL_DEMO_HOSTS: "nexa-demo.example.com" };
const cfg = (o: Record<string, string | undefined>) => leerConfigPublicada((k) => ({ ...OK, ...o })[k], USU);
Deno.test("modo publicado: configuración válida; todo lo flojo, faltante o público se rechaza", () => {
  const c = cfg({}); assert.deepEqual(Object.keys(c.claves), ["maestro", "maestro2", "ana"]); assert.deepEqual(c.hosts, ["nexa-demo.example.com"]);
  const mal = (o: Record<string, string | undefined>, patron: RegExp) => assert.throws(() => cfg(o), patron);
  mal({ FEL_DEMO_CLAVES: undefined }, /maestro/); mal({ FEL_DEMO_CLAVES: "maestro=Aaaa-bbbb-cccc-1" }, /maestro2/); mal({ FEL_DEMO_MFA_SEMILLAS: undefined }, /semilla MFA/); mal({ FEL_DEMO_MFA_SEMILLAS: "maestro=JBSWY3DPEHPK3PXP" }, /maestro2/);
  mal({ FEL_DEMO_CLAVES: OK.FEL_DEMO_CLAVES + ",luis=demo1234demo1234" }, /débil o pública/); mal({ FEL_DEMO_CLAVES: OK.FEL_DEMO_CLAVES + ",luis=corta" }, /corta/); mal({ FEL_DEMO_CLAVES: OK.FEL_DEMO_CLAVES + ",luis=aaaaaaaaaaaaaaaa" }, /débil/);
  mal({ FEL_DEMO_CLAVES: OK.FEL_DEMO_CLAVES + ",luis=Aaaa-bbbb-cccc-1" }, /distinta/); mal({ FEL_DEMO_CLAVES: OK.FEL_DEMO_CLAVES + ",intruso=Zzzz-yyyy-xxxx-9" }, /desconocido/); mal({ FEL_DEMO_CLAVES: "sin-igual" }, /formato/);
  mal({ FEL_DEMO_MFA_SEMILLAS: "maestro=abc,maestro2=KRSXG5CTMVRXEZLU" }, /base32/); mal({ FEL_DEMO_HOSTS: undefined }, /FEL_DEMO_HOSTS/);
  for (const h of ["https://x.example.com", "*.example.com", "10.0.0.5", "localhost", "a b.example.com", "x.example.com/ruta"]) mal({ FEL_DEMO_HOSTS: h }, /no válido/);
});
Deno.test("límite de tasa: ventana fija por clave, espera informada y recuperación", () => {
  let t = 0; const l = new LimiteTasa(3, 60_000, () => t);
  for (let i = 0; i < 3; i++) assert.equal(l.permitir("ip1").ok, true);
  const r = l.permitir("ip1"); assert.equal(r.ok, false); assert.ok(r.reintentarEnS >= 1 && r.reintentarEnS <= 60); assert.equal(l.permitir("ip2").ok, true, "otra IP no se ve afectada");
  t = 60_001; assert.equal(l.permitir("ip1").ok, true, "la ventana se renueva");
});

import { generar, claveFuerte } from "../src/generar_secretos.ts";
Deno.test("generador de secretos: contraseñas únicas y fuertes que el modo publicado acepta; semillas MFA válidas", () => {
  const g = generar(USU, ["maestro", "maestro2"]);
  const c = leerConfigPublicada((k) => ({ FEL_DEMO_CLAVES: g.FEL_DEMO_CLAVES, FEL_DEMO_MFA_SEMILLAS: g.FEL_DEMO_MFA_SEMILLAS, FEL_DEMO_HOSTS: "nexa-demo.fly.dev" })[k], USU);
  assert.equal(Object.keys(c.claves).length, USU.length); assert.equal(new Set(Object.values(c.claves)).size, USU.length); assert.ok(Object.values(c.claves).every((x) => x.length >= 24 && /[a-z]/.test(x) && /[A-Z]/.test(x) && /\d/.test(x)));
  assert.notEqual(claveFuerte(), claveFuerte());
});
