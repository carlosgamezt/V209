// Ayudas comunes de las pruebas del autollenado por la API REAL (mismo proceso, PostgreSQL real en memoria con las migraciones del proyecto). Ninguna prueba toca la red ni usa credenciales reales.
import assert from "node:assert/strict";
import { crearBd } from "../src/bd_memoria.ts";
import { prepararBase } from "../src/aprovisionar.ts";
import { crearApi } from "../src/api.ts";
import { Sesiones } from "../src/sesiones.ts";
import { AlmacenMemoria } from "../src/almacen.ts";
import { PERSONAS, CLAVE_DEMO } from "../src/mundo_practico.ts";
export type J = Record<string, any>; // deno-lint-ignore no-explicit-any

/** @param extras lo que se le pasa a crearApi además de la sesión (por ejemplo `digifact` o `digifactNit`) */
export async function montar(extras: Record<string, unknown> = {}) {
  const bd = await crearBd(); const mundo = await prepararBase(bd, { sembrar: true });
  const sesiones = new Sesiones(undefined, new AlmacenMemoria(PERSONAS)); sesiones.claveDemoPublica = CLAVE_DEMO;
  for (const k of Object.keys(PERSONAS)) await sesiones.registrar(k, CLAVE_DEMO, PERSONAS[k]);
  const api = crearApi(bd, mundo, { sesiones, practico: true, ...extras });
  class Cli { cookie = ""; constructor(public usuario: string) {}
    async llamar(m: string, ruta: string, cuerpo?: unknown, cab: Record<string, string> = { "x-demo": "1" }) {
      const r = await api(new Request("http://127.0.0.1" + ruta, { method: m, headers: { ...cab, "content-type": "application/json", ...(this.cookie ? { cookie: this.cookie } : {}) }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) }));
      const sc = r.headers.get("set-cookie"); if (sc) this.cookie = sc.split(";")[0]; const t = await r.text(); let json: J = {}; try { json = JSON.parse(t); } catch { /* sin cuerpo */ } return { status: r.status, json, texto: t };
    }
    async entrar() { assert.equal((await this.llamar("POST", "/api/sesion/entrar", { usuario: this.usuario, clave: CLAVE_DEMO })).status, 200); return this; } }
  return { bd, mundo, Cli };
}
export const nit = (c: { llamar: (m: string, r: string, b?: unknown, h?: Record<string, string>) => Promise<{ status: number; json: J; texto: string }> }, v: unknown, cab?: Record<string, string>) => c.llamar("POST", "/api/receptores/nit", { nit: v }, cab);
