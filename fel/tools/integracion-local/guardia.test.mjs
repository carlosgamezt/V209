// Pruebas de la guardia: cualquier configuración dudosa se rechaza. Sin red. Ejecutar: node --test fel/tools/integracion-local/guardia.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { evaluarGuardia, PROYECTOS_PROHIBIDOS } from "./guardia.mjs";

const REF = "abcdefghij0123456789", OTRA = "zyxwvutsrq9876543210", NEXA = PROYECTOS_PROHIBIDOS[0];
const jwt = (c) => `${Buffer.from("{}").toString("base64url")}.${Buffer.from(JSON.stringify(c)).toString("base64url")}.firma`;
const bueno = (etapa = "ejecutar", extra = {}) => ({
  API_URL: `https://${REF}.supabase.co`, DB_URL: `postgresql://postgres:x@db.${REF}.supabase.co:5432/postgres`, FEL_API_URL: "http://127.0.0.1:8000",
  ANON_KEY: jwt({ ref: REF, role: "anon" }), SERVICE_ROLE_KEY: jwt({ ref: REF, role: "service_role" }),
  FEL_AUTORIZACION_PRUEBAS_REALES: "si", FEL_ETAPA_AUTORIZADA: etapa, FEL_PROYECTOS_DEV_PERMITIDOS: REF, FEL_CONFIRMAR_REF: REF, ...extra });
const sin = (env, ...claves) => { const e = { ...env }; for (const k of claves) delete e[k]; return e; };
const rechaza = (nombre, env, etapa = "ejecutar", patron) => test(`RECHAZA: ${nombre}`, () => { const r = evaluarGuardia({ env, etapa }); assert.equal(r.permitido, false, `se permitió: ${nombre}`); if (patron) assert.match(r.razones.join(" | "), patron); });
const acepta = (nombre, env, etapa = "ejecutar") => test(`ACEPTA: ${nombre}`, () => { const r = evaluarGuardia({ env, etapa }); assert.equal(r.permitido, true, r.razones.join(" | ")); });

// ---- local
acepta("pila local por omisión (sin variables)", {});
acepta("pila local explícita", { API_URL: "http://127.0.0.1:54321", DB_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres", FEL_API_URL: "http://localhost:8000" });
for (const e of ["verificar", "ejecutar", "limpiar"]) acepta(`local, etapa ${e}`, {}, e);
rechaza("etapa inexistente", {}, "borrar_todo", /etapa no válida/);
rechaza("etapa vacía", {}, "");
rechaza("etapa nula", {}, null);
// ---- local con engaños en el nombre
for (const u of ["http://127.0.0.1.evil.com", "http://localhost.evil.com:54321", "http://127.0.0.1@evil.com", "http://evil.com/127.0.0.1", "http://127.0.0.2:54321", "http://0.0.0.0:54321", "http://[::1]:54321", "http://localhost@evil.com"])
  rechaza(`URL con apariencia local: ${u}`, { API_URL: u });
rechaza("Auth local pero base de datos remota", { DB_URL: `postgresql://postgres:x@db.${REF}.supabase.co:5432/postgres` }, "ejecutar", /contradictoria/);
rechaza("base de datos local pero Auth remoto", { API_URL: `https://${REF}.supabase.co` }, "ejecutar", /contradictoria|autorización/);
rechaza("todo local pero con variables de proyecto real (contradictorio)", { FEL_AUTORIZACION_PRUEBAS_REALES: "si", FEL_PROYECTOS_DEV_PERMITIDOS: REF, FEL_CONFIRMAR_REF: REF }, "ejecutar", /contradictoria/);
rechaza("Auth y BD locales con la función en un host remoto", { FEL_API_URL: `https://${REF}.supabase.co/functions/v1/fel-api` }, "ejecutar", /contradictoria/);
rechaza("URL no válida", { API_URL: "esto no es una url" });
rechaza("cadena de BD no válida", { DB_URL: "no-es-postgres" });
rechaza("cadena de BD con protocolo equivocado", { DB_URL: "http://127.0.0.1:54322/postgres" });
// ---- real: el caso bueno y cada ingrediente que falta
for (const e of ["verificar", "ejecutar", "limpiar"]) acepta(`proyecto real autorizado para ${e}`, bueno(e), e);
acepta("el nombre de host en mayúsculas es el mismo host (DNS no distingue)", bueno("ejecutar", { API_URL: `https://${REF.toUpperCase()}.supabase.co` }));
acepta("proyecto real con pooler", bueno("ejecutar", { DB_URL: `postgresql://postgres.${REF}:x@aws-0-us-east-1.pooler.supabase.com:6543/postgres` }));
acepta("proyecto real con la función del propio proyecto", bueno("ejecutar", { FEL_API_URL: `https://${REF}.supabase.co/functions/v1/fel-api` }));
rechaza("sin FEL_AUTORIZACION_PRUEBAS_REALES", sin(bueno(), "FEL_AUTORIZACION_PRUEBAS_REALES"), "ejecutar", /AUTORIZACION/);
for (const v of ["SI", "true", "1", "yes", " si", "si "]) rechaza(`autorización con valor «${v}»`, bueno("ejecutar", { FEL_AUTORIZACION_PRUEBAS_REALES: v }));
rechaza("sin etapa autorizada", sin(bueno(), "FEL_ETAPA_AUTORIZADA"), "ejecutar", /etapa/);
rechaza("etapa autorizada distinta de la pedida (ejecutar con permiso de verificar)", bueno("verificar"), "ejecutar", /cada etapa se autoriza por separado/);
rechaza("limpiar con permiso de ejecutar", bueno("ejecutar"), "limpiar", /cada etapa/);
rechaza("verificar con permiso de limpiar", bueno("limpiar"), "verificar");
rechaza("etapa autorizada como lista", bueno("ejecutar", { FEL_ETAPA_AUTORIZADA: "verificar,ejecutar,limpiar" }));
rechaza("etapa autorizada con comodín", bueno("ejecutar", { FEL_ETAPA_AUTORIZADA: "*" }));
rechaza("sin lista de proyectos permitidos", sin(bueno(), "FEL_PROYECTOS_DEV_PERMITIDOS"), "ejecutar", /PERMITIDOS/);
rechaza("lista vacía", bueno("ejecutar", { FEL_PROYECTOS_DEV_PERMITIDOS: "" }));
rechaza("lista con otra referencia", bueno("ejecutar", { FEL_PROYECTOS_DEV_PERMITIDOS: OTRA }), "ejecutar", /no está en/);
rechaza("lista con comodín", bueno("ejecutar", { FEL_PROYECTOS_DEV_PERMITIDOS: "*" }));
rechaza("lista con comodín junto a la referencia", bueno("ejecutar", { FEL_PROYECTOS_DEV_PERMITIDOS: `${REF},*` }));
rechaza("lista con elemento vacío", bueno("ejecutar", { FEL_PROYECTOS_DEV_PERMITIDOS: `${REF},` }));
rechaza("lista con referencia corta", bueno("ejecutar", { FEL_PROYECTOS_DEV_PERMITIDOS: `${REF},abc` }));
rechaza("lista con mayúsculas", bueno("ejecutar", { FEL_PROYECTOS_DEV_PERMITIDOS: REF.toUpperCase() }));
rechaza("lista demasiado larga", bueno("ejecutar", { FEL_PROYECTOS_DEV_PERMITIDOS: [REF, OTRA, "aaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbb"].join(",") }), "ejecutar", /demasiadas/);
rechaza("lista que incluye el proyecto principal de NEXA", bueno("ejecutar", { FEL_PROYECTOS_DEV_PERMITIDOS: `${REF},${NEXA}` }), "ejecutar", /principal/);
rechaza("sin confirmar la referencia", sin(bueno(), "FEL_CONFIRMAR_REF"), "ejecutar", /CONFIRMAR_REF/);
rechaza("confirmación con otra referencia", bueno("ejecutar", { FEL_CONFIRMAR_REF: OTRA }), "ejecutar", /repetir exactamente/);
rechaza("FEL_PROYECTO_REF contradice la URL", bueno("ejecutar", { FEL_PROYECTO_REF: OTRA }), "ejecutar", /contradice/);
// ---- proyecto principal de NEXA: prohibido incluso con TODO "correcto"
rechaza("proyecto principal de NEXA con todas las autorizaciones", bueno("ejecutar", { API_URL: `https://${NEXA}.supabase.co`, DB_URL: `postgresql://postgres:x@db.${NEXA}.supabase.co:5432/postgres`, ANON_KEY: jwt({ ref: NEXA, role: "anon" }), SERVICE_ROLE_KEY: jwt({ ref: NEXA, role: "service_role" }), FEL_PROYECTOS_DEV_PERMITIDOS: NEXA, FEL_CONFIRMAR_REF: NEXA }), "ejecutar", /principal/);
rechaza("proyecto indicado como principal por variable", bueno("ejecutar", { FEL_PROYECTO_NEXA_PRINCIPAL: REF }), "ejecutar", /principal/);
rechaza("variable del proyecto principal mal formada", bueno("ejecutar", { FEL_PROYECTO_NEXA_PRINCIPAL: "x" }));
// ---- URL de Auth engañosa
for (const u of [`https://${REF}.supabase.co@evil.com`, `https://evil.com/${REF}.supabase.co`, `https://${REF}.supabase.co.evil.com`, `https://x.${REF}.supabase.co`, `https://${REF}.supabase.com`,
  `http://${REF}.supabase.co`, `https://${REF}.supabase.co:8443`, `https://${REF}.supabase.co/rest/v1`, `https://${REF}.supabase.co/?x=1`, `https://usuario:clave@${REF}.supabase.co`, `https://${REF.slice(0, 19)}.supabase.co`, "https://midominio.com", "https://nexa.example.org"])
  rechaza(`URL de Auth: ${u}`, bueno("ejecutar", { API_URL: u }));
// ---- base de datos que no es de este proyecto
for (const d of [`postgresql://postgres:x@db.${OTRA}.supabase.co:5432/postgres`, `postgresql://postgres:x@db.${REF}.supabase.co.evil.com:5432/postgres`, `postgresql://postgres:x@evil.com/${REF}`, `postgresql://postgres.${OTRA}:x@aws-0-us-east-1.pooler.supabase.com:6543/postgres`,
  `postgresql://postgres:x@aws-0-us-east-1.pooler.supabase.com:6543/postgres`, "postgresql://postgres:postgres@127.0.0.1:54322/postgres", `postgresql://postgres:x@db.${NEXA}.supabase.co:5432/postgres`])
  rechaza(`base de datos: ${d.replace(/:[^:@/]+@/, ":***@")}`, bueno("ejecutar", { DB_URL: d }));
// ---- función de la API
rechaza("función en un host ajeno", bueno("ejecutar", { FEL_API_URL: "https://evil.com/functions/v1/fel-api" }));
rechaza("función de otro proyecto", bueno("ejecutar", { FEL_API_URL: `https://${OTRA}.supabase.co/functions/v1/fel-api` }));
rechaza("función del proyecto sin la ruta de funciones", bueno("ejecutar", { FEL_API_URL: `https://${REF}.supabase.co/` }));
// ---- claves
rechaza("sin clave anon", sin(bueno(), "ANON_KEY"), "ejecutar", /falta ANON_KEY/);
rechaza("sin clave de servicio", sin(bueno(), "SERVICE_ROLE_KEY"), "ejecutar", /falta SERVICE/);
rechaza("clave de servicio de OTRO proyecto", bueno("ejecutar", { SERVICE_ROLE_KEY: jwt({ ref: OTRA, role: "service_role" }) }), "ejecutar", /otro proyecto/);
rechaza("clave anon de otro proyecto", bueno("ejecutar", { ANON_KEY: jwt({ ref: OTRA, role: "anon" }) }), "ejecutar", /otro proyecto/);
rechaza("clave de servicio del proyecto principal de NEXA", bueno("ejecutar", { SERVICE_ROLE_KEY: jwt({ ref: NEXA, role: "service_role" }) }));
rechaza("claves intercambiadas", bueno("ejecutar", { ANON_KEY: jwt({ ref: REF, role: "service_role" }), SERVICE_ROLE_KEY: jwt({ ref: REF, role: "anon" }) }), "ejecutar", /intercambiadas/);
rechaza("clave sin claim ref", bueno("ejecutar", { SERVICE_ROLE_KEY: jwt({ role: "service_role" }) }), "ejecutar", /no declara su ref/);
rechaza("clave opaca sin confirmación expresa", bueno("ejecutar", { SERVICE_ROLE_KEY: "sb_secret_abc", ANON_KEY: "sb_publishable_abc" }), "ejecutar", /opacas|no es un JWT/);
acepta("clave opaca CON confirmación expresa (el resto sigue siendo coherente)", bueno("ejecutar", { SERVICE_ROLE_KEY: "sb_secret_abc", ANON_KEY: "sb_publishable_abc", FEL_CLAVES_OPACAS_CONFIRMADAS: "si" }));
rechaza("clave que es solo texto", bueno("ejecutar", { SERVICE_ROLE_KEY: "basura.basura.basura" }));
// ---- incompletas / combinadas
rechaza("solo la URL real (todo lo demás por omisión local)", { API_URL: `https://${REF}.supabase.co` });
rechaza("URL real y autorización, sin base de datos", sin(bueno(), "DB_URL"), "ejecutar", /contradictoria/);
rechaza("varias fallas a la vez se informan todas", { API_URL: `https://${NEXA}.supabase.co`, DB_URL: `postgresql://postgres:x@db.${OTRA}.supabase.co:5432/postgres` }, "ejecutar", /principal/);
test("las razones del rechazo son legibles y no filtran claves", () => {
  const r = evaluarGuardia({ env: bueno("ejecutar", { SERVICE_ROLE_KEY: "sb_secret_MUY_SECRETA", FEL_ETAPA_AUTORIZADA: "x" }), etapa: "ejecutar" });
  assert.equal(r.permitido, false); assert.ok(!r.razones.join(" ").includes("MUY_SECRETA"));
});
test("la guardia no hace entrada/salida ni lee archivos (es una función pura)", async () => {
  const fuente = (await import("node:fs")).readFileSync(new URL("./guardia.mjs", import.meta.url), "utf8");
  assert.ok(!/\bfetch\(|readFileSync|writeFileSync|execFileSync|child_process/.test(fuente));
});
