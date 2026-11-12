// Genera MANIFIESTO.json de los recursos oficiales de la SAT (hash SHA-256, tamaño y versión de cada archivo). Se ejecuta SOLO al actualizar los recursos y el resultado se revisa.
// Uso: deno run -A fiscal/herramientas/generar_manifiesto.ts --commit=<sha completo> --fecha-commit=AAAA-MM-DD --descargado=AAAA-MM-DD
const arg = (n: string) => Deno.args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const commit = arg("commit"), fechaCommit = arg("fecha-commit"), descargado = arg("descargado");
if (!commit || !/^[0-9a-f]{40}$/.test(commit) || !fechaCommit || !descargado) { console.error("Faltan --commit (40 hex), --fecha-commit y --descargado"); Deno.exit(2); }
const RAIZ = new URL("../recursos/sat-fel/", import.meta.url);
const hex = async (b: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", b as unknown as BufferSource)), (x) => x.toString(16).padStart(2, "0")).join("");
const archivos: Record<string, unknown>[] = [];
for (const carpeta of ["XSD", "Catalogos"]) {
  for (const e of [...Deno.readDirSync(new URL(`${carpeta}/`, RAIZ))].filter((x) => x.isFile).sort((a, b) => a.name.localeCompare(b.name))) {
    const b = await Deno.readFile(new URL(`${carpeta}/${e.name}`, RAIZ)); const v = /-(\d+\.\d+\.\d+)\.(xsd|json)$/.exec(e.name);
    archivos.push({ ruta: `${carpeta}/${e.name}`, tipo: carpeta === "XSD" ? "esquema" : "catalogo", version: v ? v[1] : null, bytes: b.length, sha256: await hex(b) });
  }
}
for (const nombre of ["LICENSE", "README.md"]) { const b = await Deno.readFile(new URL(nombre, RAIZ)); archivos.push({ ruta: nombre, tipo: "documento", version: null, bytes: b.length, sha256: await hex(b) }); }
const manifiesto = {
  esquema: 1,
  fuente: { nombre: "Catalogo-FEL (Esquema y catálogos - FEL, rama v2)", url: "https://github.com/notificacioneselectfel/Catalogo-FEL", publicador: "Gerencia de Informática de la SAT (según el README del repositorio)", licencia: "GPL-3.0 (archivo LICENSE del repositorio)" },
  referencia: { rama: "main", commit, fechaCommit, nota: "Archivos descargados de la rama main; el commit indicado era el más reciente del historial público al descargarlos. Los cuatro archivos centrales (GT_Documento-0.2.1.xsd y los tres catálogos) se comprobaron idénticos en ese commit." },
  descargado,
  nota: "La fecha «Ultima Actualizacion» que traen las cabeceras de los catálogos NO es fiable como vigencia (p. ej. el de frases dice 25/03/2025 y contiene decretos de 2026): la versión efectiva es el commit.",
  archivos,
};
await Deno.writeTextFile(new URL("MANIFIESTO.json", RAIZ), JSON.stringify(manifiesto, null, 2) + "\n");
console.log(`MANIFIESTO.json: ${archivos.length} archivos`);
