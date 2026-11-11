// Firma Ed25519 de las peticiones del agente (node:crypto). Mismo formato que fel/proveedores/src/firma_agente.ts (ver fel/docs/agente-protocolo.md §1):
//   mensaje = «MÉTODO\nruta\nmarca-de-tiempo\nnonce\nsha256-hex-del-cuerpo»; clave pública = 32 bytes crudos en base64url; firma = 64 bytes en base64url.
import { createHash, createPrivateKey, generateKeyPairSync, randomBytes, sign } from "node:crypto";

export const b64u = (b) => Buffer.from(b).toString("base64url");
export const sha256Hex = (t) => createHash("sha256").update(t).digest("hex");
export const mensajeFirmado = (metodo, ruta, ts, nonce, hash) => `${metodo}\n${ruta}\n${ts}\n${nonce}\n${hash}`;

/** Par nuevo: la clave privada nunca sale del equipo; solo la pública (cruda, base64url) se entrega a NEXA al vincular. */
export function generarPar() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { publica: publicKey.export({ format: "jwk" }).x, privadaPem: privateKey.export({ format: "pem", type: "pkcs8" }) };
}
export const claveDesdePem = (pem) => createPrivateKey(pem);

export function cabecerasFirmadas({ agenteId, privada, ruta, cuerpo, ts = new Date().toISOString(), nonce = b64u(randomBytes(18)), metodo = "POST" }) {
  const firma = sign(null, Buffer.from(mensajeFirmado(metodo, ruta, ts, nonce, sha256Hex(cuerpo))), privada);
  return { "content-type": "application/json", "x-agente": agenteId, "x-ts": ts, "x-nonce": nonce, "x-firma": b64u(firma) };
}
