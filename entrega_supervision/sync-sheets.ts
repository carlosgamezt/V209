// Nexa · función "sync-sheets" (Supabase Edge Function, Deno)
// Lee tus Google Sheets con la cuenta de servicio nexa-lector y guarda los datos del mes en supervision_mensual.
//
// Secretos requeridos (supabase secrets set ...):
//   GOOGLE_SA_JSON  = contenido completo del archivo JSON de nexa-lector
//   ADMIN_EMAILS    = operaciones2@sistegua.com   (separados por coma)
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY ya existen en las funciones.
//
// Uso desde Nexa: POST { "mes": "2026-10" } con el token de sesión del usuario.
//
// v2: encargado (4, 5, 6) desde la data de personal; entregas también de Chimaltenango;
//     datos complementarios de sucursales desde la hoja "Supervisión mensual - datos de sucursales"
//     (pestaña AAAA-MM). Prioridad: hojas de Carlos > hoja de sucursales; lo manual (admin) nunca se pisa.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const IDS = {
  HE: "1IiFFu6Kv6XK5CshEmprIUIMgoD57KHYscPmFZepXyXM",
  INV: "1tUqhdBVUj64oMAgbbhV_8XPQZcVaHdd4oss7OGKxgUQ",
  FORM: "1qlDfumJRtkZrbhroxxdBZpbDKrqG4CgedASi0LFNaQw",
  PERS: "1ASuMmF22tKZNEgY_O8aLm17Po4y79C1j-TM3OK5-gIA",
  SUC: "1yhx7amI36V_3Hy4cQg66VwrRyuhBBKIPDgNuMvWodHY", // datos complementarios de sucursales
  PUENTE: "1QKBgWD8RQb8lDV3SZAW4IFRfisLtCZNUlEYtZ3gc3qM", // copia liviana (IMPORTRANGE) de entregas, ausencias y descargas de FORMATOS CONSOLIDADOS
};
// Libros "FORMATOS" de cada sucursal (los mismos que consolida FORMATOS CONSOLIDADOS, que ya no responde por pesado).
const LIBROS: Record<string, string> = {
  "136": "1PVgGopEzJouVgTXzdgez9D1OWm5jXzrKcdETQ-E_Mow", // San Juan
  "128": "10sOgu0jptDD3ChF5XjgsKEIOFu9_QRhJMZMYWsrqU6s", // Jocotenango
  "13": "1DMbGo0F9ppaMU2fb8apKKJg9ElrMCcIpWrNdD2-jOrw", // Chimaltenango
  "131": "1EMe811zQI17PVkRPmrtNsU6shbJY1ju8Gysed1G4iiU", // Sololá
  "21": "1bfj6lB8oh8tMMAaj1KJilKOEEfBo0vfLGxyqbImIhzU", // Quiché
  "18": "1g7K14Nz5fC0EqeG54TlApwBvj_eLWexcoFRpHhZaebo", // Huehuetenango
  "3": "1xUAQEyB_YSJ3ikUNdTr9m9zRpr3wAEdNpv6LminPvt4", // Xela
  "146": "1HSRSHY4inbkiY3vR6iUlFBsmBA7kbAqKzJNZrH439_c", // Totonicapán
  "151": "1IJh3Fwz5k8qW9vZDVYFzixar_fgTDNe1p4eZizeOcJA", // Sacapulas
};
const SUC: Record<string, string> = { // palabra clave -> código de sucursal
  "SAN JUAN": "136", JOCOTENANGO: "128", CHIMALTENANGO: "13", SOLOLA: "131", QUICHE: "21",
  HUEHUETENANGO: "18", XELA: "3", QUETZALTENANGO: "3", TOTONICAPAN: "146", SACAPULAS: "151",
};
const CODIGOS = ["136", "128", "13", "131", "21", "18", "3", "146", "151"];
const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];

const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
const num = (s: unknown) => String(s ?? "").replace(/[Q%\s,]/g, "");
const codigo = (s: unknown) => { const n = norm(s); for (const k in SUC) if (n.includes(k)) return SUC[k]; return null; };
const fecha = (s: string) => { const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? `${m[1].padStart(2,"0")}/${m[2].padStart(2,"0")}/${m[3]}` : s; };

type Fila = { s: string; q: number; v: string };
const avisos: string[] = [];

// ---------- Google auth (JWT RS256 con cuenta de servicio) ----------
const b64u = (b: ArrayBuffer | string) => btoa(typeof b === "string" ? b : String.fromCharCode(...new Uint8Array(b)))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function googleToken(): Promise<string> {
  const sa = JSON.parse(Deno.env.get("GOOGLE_SA_JSON")!);
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64u(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3000 }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
  const key = await crypto.subtle.importKey("pkcs8", Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${body}`));
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${body}.${b64u(sig)}` }) });
  const j = await r.json();
  if (!j.access_token) throw new Error("Google no dio token: " + JSON.stringify(j));
  return j.access_token;
}
async function hoja(tok: string, id: string, nombre: string): Promise<string[][]> {
  const u = `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(`'${nombre}'`)}?valueRenderOption=FORMATTED_VALUE`;
  // Si Google tarda demasiado (libros muy pesados), se corta a los 45 s y se sigue con las demás hojas.
  try {
    const r = await fetch(u, { headers: { Authorization: `Bearer ${tok}` }, signal: AbortSignal.timeout(45000) });
    if (!r.ok) { avisos.push(`No pude leer la hoja "${nombre}" (${r.status}). ¿Existe la pestaña y está compartida con nexa-lector?`); return []; }
    return (await r.json()).values ?? [];
  } catch (_e) {
    avisos.push(`La hoja "${nombre}" tardó más de 45 s en responder (Google estaba lento). Vuelve a actualizar en unos minutos.`);
    return [];
  }
}
const conEncabezado = (v: string[][]) => { const h = (v[0] ?? []).map(norm); return v.slice(1).map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ""]))); };

// ---------- lectores por hoja ----------
function ventas(v: string[][], mes: string, anio: string): Fila[] {
  const out: Fila[] = [];
  for (const r of conEncabezado(v)) {
    if (r["MES"]?.toLowerCase() !== mes || r["ANO"] !== anio) continue;
    const s = codigo(r["SUCURSAL"]); if (!s) continue;
    const campos: [number, string][] = [[38,"META"],[39,"VENTA LOGRADA"],[40,"FACTURAS EMITIDAS"],[41,"NOTAS DE CREDITO"],
      [42,"TICKET PROMEDIO"],[43,"SKU"],[44,"ROTACION SKU"],[19,"SSO"]];
    for (const [q, k] of campos) if (r[k] !== undefined && r[k] !== "") out.push({ s, q, v: num(r[k]) });
    if (r["FECHA DE ULTIMA VISITA SUPERVISOR"]) out.push({ s, q: 7, v: fecha(r["FECHA DE ULTIMA VISITA SUPERVISOR"]) });
  }
  if (!out.length) avisos.push(`VENTAS no trae filas de ${mes} ${anio}.`);
  return out;
}
function inventarios(v: string[][], fin: Date): Fila[] {
  const ult: Record<string, { f: Date; r: Record<string, string> }> = {};
  for (const r of conEncabezado(v)) {
    const s = codigo(r["SUCURSAL"]); const m = (r["FECHA DE INVENTARIO"] ?? "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!s || !m) continue; const f = new Date(+m[3], +m[2] - 1, +m[1]);
    if (f <= fin && (!ult[s] || f > ult[s].f)) ult[s] = { f, r };
  }
  const out: Fila[] = [];
  for (const [s, { r }] of Object.entries(ult)) {
    out.push({ s, q: 8, v: fecha(r["FECHA DE INVENTARIO"]) }, { s, q: 9, v: r["NO. INVENTARIO"] },
      { s, q: 10, v: num(r["SOBRANTE"]) }, { s, q: 11, v: num(r["FALTANTE"]) }, { s, q: 12, v: r["EFICIENCIA UIG"] });
  }
  return out;
}
function horasExtras(v: string[][]): Fila[] {
  const out: Fila[] = []; let cur: string | null = null;
  for (const r of v) {
    if (/^\d+$/.test(r[6] ?? "") && r[7]) { cur = codigo(r[7]); continue; }
    const vacio = r.slice(0, 7).every((x) => !x);
    if (cur && vacio && /^\d/.test(r[7] ?? "") && /%$/.test(r[13] ?? "")) {
      out.push({ s: cur, q: 25, v: num(r[7]) }, { s: cur, q: 26, v: num(r[12]) }, { s: cur, q: 27, v: num(r[13]) }); cur = null;
    }
  }
  return out;
}
function altasBajas(v: string[][]): Fila[] {
  const cnt: Record<string, Record<string, number>> = { igss: {}, vac: {}, altas: {}, bajas: {} };
  let sec = "";
  for (const r of v) {
    const t = norm(r[1]);
    if (t.startsWith("SUSPENSIONES DE IGSS")) sec = "igss"; else if (t.startsWith("EN PERIODO DE VACACIONES")) sec = "vac";
    else if (t === "ALTAS") sec = "altas"; else if (t === "BAJAS") sec = "bajas";
    else if (t === "SUCURSAL" || t === "REVISO") { if (t === "REVISO") sec = ""; }
    else if (sec && t && r[2]) { const s = codigo(t); if (s) cnt[sec][s] = (cnt[sec][s] ?? 0) + 1; }
  }
  return CODIGOS.flatMap((s) => [{ s, q: 32, v: String(cnt.igss[s] ?? 0) }, { s, q: 31, v: String(cnt.vac[s] ?? 0) },
    { s, q: 23, v: String(cnt.altas[s] ?? 0) }, { s, q: 24, v: String(cnt.bajas[s] ?? 0) }]);
}
function entregas(v: string[][]): Fila[] {
  const out: Fila[] = [];
  for (const r of conEncabezado(v)) {
    if (!/TOTAL$/.test(norm(r["SUCURSAL"])) || norm(r["SUCURSAL"]).startsWith("GRAND")) continue;
    const s = codigo(r["SUCURSAL"]); if (!s) continue; // ahora incluye Chimaltenango
    const tot = +num(r["CANTIDAD DE ENTREGAS"]), fl = +num(r["CANTIDAD DE FLETES"]) || 0;
    out.push({ s, q: 48, v: num(r["MONTO FACTURADO"]) }, { s, q: 51, v: String(tot - fl) }, { s, q: 52, v: String(fl) },
      { s, q: 53, v: num(r["COSTO FLETE"]) }, { s, q: 54, v: num(r["KILOMETROS RECORRIDOS"]) },
      { s, q: 55, v: num(r["CONSUMO DE COMBUSTIBLE"]) }, { s, q: 56, v: num(r["KM POR GALON"]) || "0" });
  }
  return out;
}
// Dinero y números en cualquier formato regional: "Q16.921,25", "Q9,110.25", "14,39", "5.5".
const dinero = (t: unknown) => {
  let x = String(t ?? "").replace(/[Q\s]/g, ""); if (!x) return 0;
  if (/,\d{1,2}$/.test(x)) x = x.replace(/\./g, "").replace(",", "."); else x = x.replace(/,/g, "");
  const n = parseFloat(x); return isFinite(n) ? n : 0;
};
// Entregas del mes calculadas desde la pestaña "1 ENTREGAS" de cada sucursal (columnas: B mes, C año, D sucursal, J monto, N km, O combustible Q, P galones, Q costo flete).
function entregasDirecto(cod: string, v: string[][], mes: string, anio: string): Fila[] {
  const rows = v.slice(1).filter((r) => String(r[1] ?? "").toLowerCase() === mes && String(r[2] ?? "").trim() === anio && codigo(r[3]) === cod);
  if (!rows.length) return [];
  const suma = (i: number) => rows.reduce((t, r) => t + dinero(r[i]), 0);
  const fletes = rows.filter((r) => dinero(r[16]) > 0).length, km = suma(13), gal = suma(15);
  const f = (n: number) => (Math.round(n * 100) / 100).toString();
  return [{ s: cod, q: 48, v: f(suma(9)) }, { s: cod, q: 51, v: String(rows.length - fletes) }, { s: cod, q: 52, v: String(fletes) },
    { s: cod, q: 53, v: f(suma(16)) }, { s: cod, q: 54, v: f(km) }, { s: cod, q: 55, v: f(suma(14)) }, { s: cod, q: 56, v: gal > 0 ? f(km / gal) : "0" }];
}
function ausencias(v: string[][], mes: string, anio: string): Fila[] {
  const permisos: Record<string, Set<string>> = {}, sin: Record<string, number> = {};
  for (const r of conEncabezado(v)) {
    if (r["MES"]?.toLowerCase() !== mes || r["ANO"] !== anio) continue;
    const s = codigo(r["SUCURSAL"]); if (!s) continue;
    const c = norm(r["PRESENTO CONSTANCIA O PERMISO"]);
    if (c.includes("PERMISO")) (permisos[s] ??= new Set()).add(r["CODIGO DE COLABORADOR"]);
    else if (c === "NO") sin[s] = (sin[s] ?? 0) + 1;
  }
  return CODIGOS.flatMap((s) => [{ s, q: 29, v: String(permisos[s]?.size ?? 0) }, { s, q: 30, v: String(sin[s] ?? 0) }]);
}
function descargasCD(v: string[][], mes: number, anio: number): Fila[] {
  const c: Record<string, number> = {};
  for (const r of conEncabezado(v)) {
    const m = (r["FECHA RECIBIDO"] ?? "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); const s = codigo(r["SUCURSAL"]);
    if (m && s && +m[2] === mes && +m[3] === anio) c[s] = (c[s] ?? 0) + 1;
  }
  return CODIGOS.map((s) => ({ s, q: 3501, v: String(c[s] ?? 0) }));
}
function planilla(v: string[][]): Fila[] {
  const h = (v.find((r) => r.map(norm).includes("CODIGO")) ?? []).map(norm);
  const iS = h.indexOf("SUCURSAL"), iC = h.indexOf("CODIGO"), iE = h.indexOf("ESTADO");
  const vistos = new Set<string>(), c: Record<string, number> = {};
  for (const r of v) {
    const s = codigo(r[iS]); const cod = (r[iC] ?? "").trim(); if (!s || !/^\d+$/.test(cod) || norm(r[iE]) !== "ACTIVO") continue;
    const k = s + "|" + cod; if (vistos.has(k)) continue; vistos.add(k); c[s] = (c[s] ?? 0) + 1;
  }
  return CODIGOS.map((s) => ({ s, q: 20, v: String(c[s] ?? 0) }));
}
// Preguntas 4, 5 y 6: encargado de cada sucursal según la data de personal.
// Encargado = el nombre que más se repite en la columna ENCARGADO (personal ACTIVO).
// Código = código de planilla de esa persona. Titular si su puesto es ENCARGADO FACTURADOR o ADMINISTRADOR; si no, Suplente.
function encargados(v: string[][]): Fila[] {
  const h = (v[0] ?? []).map(norm);
  const iS = h.indexOf("SUCURSAL"), iC = h.indexOf("CODIGO"), iN = h.indexOf("NOMBRE COMPLETO"),
    iP = h.indexOf("PUESTO"), iE = h.indexOf("ENCARGADO"), iT = h.indexOf("ESTADO");
  const limpia = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
  const filas = v.slice(1).filter((r) => codigo(r[iS]) && norm(r[iT]) === "ACTIVO");
  const out: Fila[] = [];
  for (const s of CODIGOS) {
    const de = filas.filter((r) => codigo(r[iS]) === s);
    const cuenta: Record<string, number> = {};
    for (const r of de) { const k = norm(limpia(r[iE])); if (k) cuenta[k] = (cuenta[k] ?? 0) + 1; }
    const ganador = Object.entries(cuenta).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!ganador) continue;
    const p = de.find((r) => norm(limpia(r[iN])) === ganador);
    out.push({ s, q: 4, v: limpia(p ? p[iN] : ganador) });
    if (p) {
      const cod = limpia(p[iC]); if (/^\d+$/.test(cod)) out.push({ s, q: 5, v: cod });
      const pu = norm(p[iP]);
      out.push({ s, q: 6, v: pu === "ENCARGADO FACTURADOR" || pu === "ADMINISTRADOR" ? "Titular" : "Suplente" });
    }
  }
  return out;
}
// Datos complementarios que llegan de las sucursales (hoja de Google, pestaña AAAA-MM).
// Fila 1: códigos de sucursal desde la columna C. Desde la fila 3: columna A = número de pregunta.
function complemento(v: string[][]): Fila[] {
  const cods = (v[0] ?? []).slice(2).map((x) => String(x).trim());
  const out: Fila[] = [];
  for (const r of v.slice(2)) {
    const q = parseInt(String(r[0] ?? ""), 10); if (!q) continue;
    cods.forEach((s, i) => { const val = String(r[i + 2] ?? "").trim(); if (val && CODIGOS.includes(s)) out.push({ s, q, v: val }); });
  }
  return out;
}

// ---------- servidor ----------
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" };
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const tokenUsuario = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data: u } = await sb.auth.getUser(tokenUsuario);
  const admins = (Deno.env.get("ADMIN_EMAILS") ?? "").toLowerCase().split(",").map((x) => x.trim());
  if (!u?.user?.email || !admins.includes(u.user.email.toLowerCase()))
    return new Response(JSON.stringify({ error: "No autorizado" }), { status: 403, headers: cors });
  try {
    const { mes } = await req.json(); // "2026-10"
    const [anio, m] = mes.split("-").map(Number); const nombre = MESES[m - 1]; const fin = new Date(anio, m, 0);
    const g = await googleToken();
    const [vt, inv, he, ab, pe, co, suc] = await Promise.all([
      hoja(g, IDS.INV, "VENTAS"), hoja(g, IDS.INV, "R INVENTARIOS"), hoja(g, IDS.HE, "HORAS EXTRAS"),
      hoja(g, IDS.HE, "ALTAS,BAJAS,IGSS"), hoja(g, IDS.PERS, "DATOS PARA EDITAR"), hoja(g, IDS.SUC, mes),
      // entregas, ausencias y descargas CD: de cada libro de sucursal (más livianos que el consolidado)
      Promise.all(Object.entries(LIBROS).map(async ([cod, id]) => {
        const [en, au, cd] = await Promise.all([hoja(g, id, "1 ENTREGAS"), hoja(g, id, "5 AUSENCIAS"), hoja(g, id, "3 DESCARGAS CD")]);
        return { cod, en, au, cd };
      })),
    ]);
    const filasHojas: Fila[] = [...ventas(vt, nombre, String(anio)), ...inventarios(inv, fin), ...horasExtras(he), ...altasBajas(ab),
      ...suc.flatMap((x) => entregasDirecto(x.cod, x.en, nombre, String(anio))), ...suc.flatMap((x) => ausencias(x.au, nombre, String(anio)).filter((f) => f.s === x.cod)),
      ...suc.flatMap((x) => descargasCD(x.cd, m, anio).filter((f) => f.s === x.cod)), ...planilla(pe), ...encargados(pe)]
      .filter((f) => f.v !== "");
    // lo de las sucursales solo completa lo que tus hojas no trajeron
    const conHojas = new Set(filasHojas.map((f) => `${f.s}|${f.q}`));
    const filasSuc = complemento(co).filter((f) => !conHojas.has(`${f.s}|${f.q}`));
    const mesDate = `${anio}-${String(m).padStart(2, "0")}-01`;
    // lo que tú editaste a mano en Nexa (fuente 'admin') no se pisa
    const { data: manual } = await sb.from("supervision_mensual").select("sucursal_codigo,pregunta").eq("mes", mesDate).eq("fuente", "admin");
    const bloqueadas = new Set((manual ?? []).map((x) => `${x.sucursal_codigo}|${x.pregunta}`));
    const ahora = new Date().toISOString();
    const armar = (fs: Fila[], fuente: string) => fs.filter((f) => !bloqueadas.has(`${f.s}|${f.q}`))
      .map((f) => ({ sucursal_codigo: f.s, mes: mesDate, pregunta: f.q, valor: f.v, fuente,
        actualizado_en: ahora, actualizado_por: u.user!.email }));
    const rows = [...armar(filasHojas, "hojas"), ...armar(filasSuc, "sucursal")];
    const { error } = await sb.from("supervision_mensual").upsert(rows, { onConflict: "sucursal_codigo,mes,pregunta" });
    if (error) throw error;
    await sb.from("supervision_sync_log").insert({ mes: mesDate, ejecutado_por: u.user.email, filas: rows.length, avisos, ok: !avisos.length });
    return new Response(JSON.stringify({ ok: true, filas: rows.length, avisos }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message ?? e), avisos }), { status: 500, headers: cors });
  }
});
