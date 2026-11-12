// Construye lo que se sube a la nube (NO sube nada; solo escribe archivos en dist/nube):
//   dist/nube/pagina/   → Cloudflare Pages: la interfaz estática, _headers, robots y la Pages Function intermediaria (/api/*)
//   dist/nube/funcion/  → proyecto Supabase con la función «nexa-demo» (código copiado, sin secretos) y config.toml con verify_jwt = false (la protege el secreto del intermediario)
// Uso:  deno run -A nube/construir.ts
import { fromFileUrl, join, relative, dirname } from "jsr:@std/path@1";

const AQUI = fromFileUrl(new URL("..", import.meta.url)), FEL = join(AQUI, ".."), SALIDA = join(FEL, "dist", "nube");
const copiar = async (de: string, a: string) => { await Deno.mkdir(dirname(a), { recursive: true }); await Deno.copyFile(de, a); };
async function copiarDir(de: string, a: string, ok: (n: string) => boolean = () => true) {
  await Deno.mkdir(a, { recursive: true });
  for await (const e of Deno.readDir(de)) { if (!ok(e.name)) continue; if (e.isDirectory) await copiarDir(join(de, e.name), join(a, e.name), ok); else await copiar(join(de, e.name), join(a, e.name)); }
}
await Deno.remove(SALIDA, { recursive: true }).catch(() => {});

// ---- Cloudflare Pages
const P = join(SALIDA, "pagina");
await copiarDir(join(AQUI, "web"), join(P, "web"));
for (const f of ["index.html", "manifest.webmanifest", "sw.js"]) await copiar(join(AQUI, "web", f), join(P, f));
for (const f of ["index.html", "manifest.webmanifest", "sw.js"]) await Deno.remove(join(P, "web", f)).catch(() => {});   // viven en la raíz (las rutas del manifiesto y del service worker)
await copiarDir(join(FEL, "app", "css"), join(P, "app", "css")); await copiarDir(join(FEL, "app", "js"), join(P, "app", "js"), (n) => /^[A-Za-z0-9._-]+\.js$/.test(n) || !n.includes("."));
await copiar(join(AQUI, "nube", "pages", "_headers"), join(P, "_headers")); await copiar(join(AQUI, "nube", "pages", "robots.txt"), join(P, "robots.txt"));
await copiar(join(AQUI, "nube", "pages", "functions", "api", "[[path]].ts"), join(P, "functions", "api", "[[path]].ts")); await copiar(join(AQUI, "nube", "proxy.ts"), join(P, "functions", "_proxy.ts"));

// ---- Supabase (función)
const F = join(SALIDA, "funcion", "supabase"), CODIGO = join(F, "functions", "nexa-demo", "codigo");
const info = JSON.parse(new TextDecoder().decode((await new Deno.Command(Deno.execPath(), { args: ["info", "--json", join(AQUI, "nube", "funcion_entrada.ts")], stdout: "piped", stderr: "null" }).output()).stdout));
const locales: string[] = info.modules.map((m: { specifier: string }) => m.specifier).filter((s: string) => s.startsWith("file://")).map((s: string) => fromFileUrl(s));
for (const f of locales) { const rel = relative(FEL, f); if (rel.startsWith("..")) throw new Error(`módulo fuera del proyecto: ${f}`); await copiar(f, join(CODIGO, rel)); }
await Deno.writeTextFile(join(F, "functions", "nexa-demo", "index.ts"), `// Generado por nube/construir.ts. Entrada de la función de la demostración.\nimport "./codigo/demo-facturacion/nube/funcion_entrada.ts";\n`);
await Deno.writeTextFile(join(F, "config.toml"), `# Generado por nube/construir.ts\nproject_id = "nexa-demo"\n\n[functions.nexa-demo]\nverify_jwt = false   # la función exige el secreto del intermediario de Cloudflare (x-nexa-proxy); no usa el JWT de Supabase\n`);

// ---- control: nada sensible en lo construido
const sospechosos: string[] = [];
async function revisar(d: string) { for await (const e of Deno.readDir(d)) { const r = join(d, e.name); if (e.isDirectory) { await revisar(r); continue; } if (/\.(ts|js|html|toml|css|txt|webmanifest)$|^_headers$/.test(e.name)) { const t = await Deno.readTextFile(r); if (/(postgres(ql)?:\/\/[^\s'"`]+:[^\s'"`@]+@)|(eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})|(sb_secret_[A-Za-z0-9_-]{20,})|(service_role['"]?\s*[:=]\s*['"]ey)/.test(t)) sospechosos.push(relative(SALIDA, r)); } } }
await revisar(SALIDA); if (sospechosos.length) { console.error("Posibles secretos en:", sospechosos); Deno.exit(1); }
console.log(`  Construido en ${SALIDA}\n   · pagina/  (${locales.length ? "Cloudflare Pages" : ""})\n   · funcion/ (Supabase: ${locales.length} módulos locales copiados)`);
