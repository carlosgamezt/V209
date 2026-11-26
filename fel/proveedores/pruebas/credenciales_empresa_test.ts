import assert from "node:assert/strict";
import { ErrorCredencial, cifrarCredencial, descifrarCredencial, llavesDeEntorno, recifrarCredencial } from "../src/credenciales_empresa.ts";

const A = "10000000-0000-0000-0000-00000000000a", B = "10000000-0000-0000-0000-00000000000b";
const USUARIO = "usuario-secreto-ZX81", CLAVE = "Clave-MUY-secreta-#4711";
const b64 = (fill: number) => btoa(String.fromCharCode(...new Uint8Array(32).fill(fill)));
const entorno = (o: Record<string, string>) => (k: string) => o[k];
const E1 = { FEL_CREDENCIALES_LLAVE_ACTUAL: "1", FEL_CREDENCIALES_LLAVE_V1: b64(7) };
const E12 = { FEL_CREDENCIALES_LLAVE_ACTUAL: "2", FEL_CREDENCIALES_LLAVE_V1: b64(7), FEL_CREDENCIALES_LLAVE_V2: b64(9) };
const E2 = { FEL_CREDENCIALES_LLAVE_ACTUAL: "2", FEL_CREDENCIALES_LLAVE_V2: b64(9) };
const rechaza = async (p: Promise<unknown>, codigo: string) => { await assert.rejects(p, (e: unknown) => e instanceof ErrorCredencial && e.codigo === codigo, `se esperaba ${codigo}`); };
const sinSecretos = (e: unknown) => { const t = String((e as Error).message) + JSON.stringify(e) + String(e) + ((e as Error).stack ?? "").split("\n")[0]; for (const s of [USUARIO, CLAVE, b64(7), b64(9)]) assert.ok(!t.includes(s), "el error no debe contener secretos"); };

Deno.test("cifrado de sobre: ida y vuelta, nonce distinto cada vez y el resultado no contiene el texto claro", async () => {
  const l = await llavesDeEntorno(entorno(E1));
  const a = await cifrarCredencial(l, A, { usuario: USUARIO, clave: CLAVE }), b = await cifrarCredencial(l, A, { usuario: USUARIO, clave: CLAVE });
  assert.equal(a.version, 1); assert.equal(a.bytes[0], 1); assert.equal(a.bytes[1], 1);
  assert.notDeepEqual(a.bytes, b.bytes, "dos cifrados de lo mismo difieren (nonce aleatorio)");
  assert.deepEqual(await descifrarCredencial(l, A, a.bytes, 1), { usuario: USUARIO, clave: CLAVE });
  const texto = new TextDecoder("latin1").decode(a.bytes); assert.ok(!texto.includes(USUARIO) && !texto.includes(CLAVE) && !texto.includes("secreta"));
  assert.ok(a.bytes.length >= 30 && a.bytes.length <= 2048, "cabe en la restricción de la columna");
});

Deno.test("vinculación a la empresa: el cifrado de A copiado a B no se descifra", async () => {
  const l = await llavesDeEntorno(entorno(E1));
  const a = await cifrarCredencial(l, A, { usuario: USUARIO, clave: CLAVE });
  await assert.rejects(descifrarCredencial(l, B, a.bytes, 1), (e: unknown) => { sinSecretos(e); return e instanceof ErrorCredencial && e.codigo === "AUTENTICACION"; });
  assert.deepEqual(await descifrarCredencial(l, A.toUpperCase(), a.bytes, 1), { usuario: USUARIO, clave: CLAVE }, "el UUID en mayúsculas es la misma empresa");
  await rechaza(descifrarCredencial(l, "no-es-uuid", a.bytes, 1), "ENTRADA");
  await rechaza(cifrarCredencial(l, "", { usuario: USUARIO, clave: CLAVE }), "ENTRADA");
});

Deno.test("integridad: cualquier bit cambiado, truncado o versión distinta se rechaza sin revelar nada", async () => {
  const l = await llavesDeEntorno(entorno(E12));
  const a = await cifrarCredencial(l, A, { usuario: USUARIO, clave: CLAVE });
  for (const i of [0, 1, 2, 13, a.bytes.length - 1]) {
    const m = a.bytes.slice(); m[i] ^= 1;
    await assert.rejects(descifrarCredencial(l, A, m, a.version), (e: unknown) => { sinSecretos(e); return e instanceof ErrorCredencial && ["AUTENTICACION", "FORMATO", "LLAVE_NO_DISPONIBLE"].includes(e.codigo); }, `byte ${i}`);
  }
  await rechaza(descifrarCredencial(l, A, a.bytes.slice(0, 20), 2), "FORMATO");
  await rechaza(descifrarCredencial(l, A, a.bytes, 1), "FORMATO");   // la versión registrada en la base no coincide con la del cifrado
  await rechaza(descifrarCredencial(l, A, new Uint8Array(3000), 2), "FORMATO");
});

Deno.test("rotación de llaves: conviven dos, se vuelve a cifrar con la nueva y la anterior puede retirarse", async () => {
  const antes = await cifrarCredencial(await llavesDeEntorno(entorno(E1)), A, { usuario: USUARIO, clave: CLAVE });
  const l12 = await llavesDeEntorno(entorno(E12));
  assert.deepEqual(await descifrarCredencial(l12, A, antes.bytes, 1), { usuario: USUARIO, clave: CLAVE }, "la llave anterior sigue sirviendo durante la rotación");
  const nuevo = await recifrarCredencial(l12, A, antes.bytes, 1);
  assert.equal(nuevo.version, 2); assert.equal(nuevo.bytes[1], 2);
  const l2 = await llavesDeEntorno(entorno(E2));   // se retira la V1
  assert.deepEqual(await descifrarCredencial(l2, A, nuevo.bytes, 2), { usuario: USUARIO, clave: CLAVE });
  await assert.rejects(descifrarCredencial(l2, A, antes.bytes, 1), (e: unknown) => { sinSecretos(e); return e instanceof ErrorCredencial && e.codigo === "LLAVE_NO_DISPONIBLE"; });
});

Deno.test("configuración de llaves: falla cerrado y nunca muestra el valor de una llave", async () => {
  for (const [o, patron] of [
    [{}, /LLAVE_ACTUAL/], [{ FEL_CREDENCIALES_LLAVE_ACTUAL: "1" }, /V1/], [{ FEL_CREDENCIALES_LLAVE_ACTUAL: "0", FEL_CREDENCIALES_LLAVE_V1: b64(7) }, /LLAVE_ACTUAL/],
    [{ FEL_CREDENCIALES_LLAVE_ACTUAL: "1", FEL_CREDENCIALES_LLAVE_V1: "AAAA" }, /32 bytes/], [{ FEL_CREDENCIALES_LLAVE_ACTUAL: "1", FEL_CREDENCIALES_LLAVE_V1: "###" }, /32 bytes/],
    [{ FEL_CREDENCIALES_LLAVE_ACTUAL: "3", FEL_CREDENCIALES_LLAVE_V1: b64(7) }, /V3/],
  ] as [Record<string, string>, RegExp][]) {
    await assert.rejects(llavesDeEntorno(entorno(o)), (e: unknown) => { sinSecretos(e); return e instanceof ErrorCredencial && e.codigo === "CONFIGURACION" && patron.test(e.message) && !String(e.message).includes(o.FEL_CREDENCIALES_LLAVE_V1 ?? "\u0000"); });
  }
});

Deno.test("entradas inválidas se rechazan y las llaves no son exportables", async () => {
  const l = await llavesDeEntorno(entorno(E1));
  for (const c of [{ usuario: "", clave: CLAVE }, { usuario: USUARIO, clave: "" }, { usuario: "x".repeat(257), clave: CLAVE }, { usuario: "a\nb", clave: CLAVE }, { usuario: USUARIO, clave: "a\u0000" }, null as never])
    await rechaza(cifrarCredencial(l, A, c), "ENTRADA");
  await assert.rejects(crypto.subtle.exportKey("raw", l.llaves.get(1)!), "la llave importada no se puede exportar");
});
