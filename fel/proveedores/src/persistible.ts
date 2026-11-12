// Estado «del lado del servidor» de los certificadores SIMULADOS, serializable: un certificador real conserva sus certificaciones aunque NEXA se reinicie; el simulador debe hacer lo mismo
// (si no, tras un reinicio una anulación o una conciliación fallaría con «no existe» sobre un documento ya certificado). Se guarda como texto JSON con etiquetas para binarios, Map y Set.
export interface Persistible { exportar(): unknown; importar(estado: unknown): void }
const aB64 = (b: Uint8Array) => { let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const deB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
// deno-lint-ignore no-explicit-any
export function codificar(v: unknown): string { return JSON.stringify(v, function (this: any, k: string, x: unknown) { const o = this[k]; if (o instanceof Uint8Array) return { $u8: aB64(o) }; if (o instanceof Map) return { $map: [...o] }; if (o instanceof Set) return { $set: [...o] }; return x; }); }
// deno-lint-ignore no-explicit-any
export function decodificar<T = unknown>(s: string): T { return JSON.parse(s, (_k, x: any) => { if (x && typeof x === "object") { if ("$u8" in x) return deB64(x.$u8); if ("$map" in x) return new Map(x.$map); if ("$set" in x) return new Set(x.$set); } return x; }) as T; }
