import assert from "node:assert/strict";
import { ProveedorEnrutado } from "../src/proveedor_enrutado.ts";
import { MockProvider } from "../src/mock.ts";
import { CTX } from "./datos.ts";
import type { OperacionRef } from "../src/tipos.ts";

const ref = (op: string): OperacionRef => ({ empresaId: "e1", documentoId: "d1", operacionId: op, claveIdempotencia: "clave-0000000000001", ambiente: "simulado" });
Deno.test("enrutado: cada operación se concilia con SU proveedor; proveedor desconocido o error al leer ⇒ indeterminado (nunca «no existe»)", async () => {
  const a = new MockProvider(), b = new MockProvider(); const llamadas: string[] = [];
  const orig = (n: string, p: MockProvider) => { const c = p.conciliar.bind(p); p.conciliar = (o, x) => { llamadas.push(n); return c(o, x); }; };
  orig("a", a); orig("b", b);
  const rpc = async (_f: string, args: Record<string, unknown>) => { const m: Record<string, unknown> = { op1: { proveedor: "a" }, op2: { proveedor: "b" }, op3: { proveedor: "otro" }, op4: { proveedor: null }, op5: null };
    if (args.p_op === "boom") throw new Error("bd caída"); return m[args.p_op as string]; };
  const r = new ProveedorEnrutado(rpc, { a, b }, a);
  await r.conciliar(ref("op1"), CTX); await r.conciliar(ref("op2"), CTX); assert.deepEqual(llamadas, ["a", "b"]);
  for (const op of ["op3", "boom"]) assert.equal((await r.conciliar(ref(op), CTX)).tipo, "indeterminado", op);
  assert.equal(llamadas.length, 2, "no se consultó a ningún proveedor equivocado");
  await r.conciliar(ref("op4"), CTX); assert.equal(llamadas.at(-1), "a", "sin proveedor registrado: el predeterminado");
  assert.deepEqual(await r.obtenerArtefactos(ref("op3"), CTX), []);
  await assert.rejects(() => r.enviar({} as never, CTX));
});
