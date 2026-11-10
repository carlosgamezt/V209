// Guardia de seguridad del script de integración: decide, SIN tocar la red, si esta ejecución está permitida.
// Principio: por omisión solo la pila LOCAL. Contra un proyecto de desarrollo real exige autorización expresa POR ETAPA, que su referencia esté
// en una lista cerrada, que se vuelva a escribir la referencia, y que todo (URL, base de datos, claves, función) sea coherente con ese proyecto.
// Cualquier configuración incompleta, ambigua o contradictoria se RECHAZA. El proyecto principal de NEXA está prohibido siempre.

export const ETAPAS = ["verificar", "ejecutar", "limpiar"];
export const PROYECTOS_PROHIBIDOS = ["znicbyzszdztwyecydbl"];      // proyecto principal de NEXA (su URL ya es pública en la app)
const RE_REF = /^[a-z0-9]{20}$/;
const LOCAL_API = "http://127.0.0.1:54321", LOCAL_DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres", LOCAL_FEL = "http://127.0.0.1:8000";

const esHostLocal = (h) => h === "127.0.0.1" || h === "localhost";
const analizar = (txt) => { try { return new URL(txt); } catch { return null; } };
function claimsJwt(t) { try { const p = String(t).split("."); return p.length === 3 ? JSON.parse(Buffer.from(p[1], "base64url").toString()) : null; } catch { return null; } }

export function evaluarGuardia({ env = {}, etapa }) {
  const razones = [];
  const rechazar = (r) => razones.push(r);
  if (!ETAPAS.includes(etapa)) rechazar(`etapa no válida: «${etapa}» (válidas: ${ETAPAS.join(", ")})`);

  const apiTxt = env.API_URL ?? LOCAL_API, dbTxt = env.DB_URL ?? LOCAL_DB, felTxt = env.FEL_API_URL ?? LOCAL_FEL;
  const api = analizar(apiTxt), db = analizar(dbTxt), fel = analizar(felTxt);
  if (!api) rechazar("API_URL no es una URL válida");
  if (!db || !/^postgres(ql)?:$/.test(db?.protocol ?? "")) rechazar("DB_URL no es una cadena de conexión de PostgreSQL válida");
  if (!fel) rechazar("FEL_API_URL no es una URL válida");
  if (razones.length) return { permitido: false, local: false, ref: null, razones };

  // URL con usuario/contraseña, ruta, parámetros o puerto raro: casi siempre un intento de engaño (https://x.supabase.co@evil.com, …)
  if (api.username || api.password || (api.pathname !== "/" && api.pathname !== "") || api.search || api.hash) rechazar("API_URL debe ser solo el origen (sin usuario, ruta ni parámetros)");

  const apiLocal = (api.protocol === "http:" || api.protocol === "https:") && esHostLocal(api.hostname) && !api.username;
  const dbLocal = esHostLocal(db.hostname);
  const felLocal = esHostLocal(fel.hostname) && (fel.protocol === "http:" || fel.protocol === "https:") && !fel.username;

  // ---------------- pila local
  if (apiLocal && dbLocal && felLocal && !razones.length) {
    // pista contradictoria: variables de "real" presentes con todo local
    if (env.FEL_AUTORIZACION_PRUEBAS_REALES === "si" && (env.FEL_PROYECTOS_DEV_PERMITIDOS || env.FEL_CONFIRMAR_REF)) rechazar("hay variables de proyecto real pero las URL son locales: configuración contradictoria");
    return { permitido: razones.length === 0, local: true, ref: null, razones };
  }
  if (apiLocal !== dbLocal) rechazar("configuración contradictoria: la URL de Auth y la base de datos no están ambas en local ni ambas en el mismo proyecto");
  if (apiLocal && dbLocal && !felLocal) rechazar("configuración contradictoria: Auth y base de datos son locales pero FEL_API_URL no lo es");

  // ---------------- proyecto real
  const m = api.hostname.match(/^([a-z0-9]{20})\.supabase\.co$/);
  const ref = m ? m[1] : null;
  if (api.protocol !== "https:") rechazar("un proyecto real exige https");
  if (api.port && api.port !== "443") rechazar("un proyecto real no usa un puerto distinto de 443");
  if (!ref) rechazar("API_URL no es de la forma https://<ref de 20 caracteres>.supabase.co (dominios propios, subdominios extra y variantes se rechazan)");
  if (ref && (PROYECTOS_PROHIBIDOS.includes(ref) || (env.FEL_PROYECTO_NEXA_PRINCIPAL && env.FEL_PROYECTO_NEXA_PRINCIPAL === ref))) rechazar("ese es el proyecto principal de NEXA: está prohibido");
  if (env.FEL_PROYECTO_NEXA_PRINCIPAL && !RE_REF.test(env.FEL_PROYECTO_NEXA_PRINCIPAL)) rechazar("FEL_PROYECTO_NEXA_PRINCIPAL no tiene el formato de una referencia");

  if (env.FEL_AUTORIZACION_PRUEBAS_REALES !== "si") rechazar("falta FEL_AUTORIZACION_PRUEBAS_REALES=si");
  if (env.FEL_ETAPA_AUTORIZADA !== etapa) rechazar(`la autorización de etapa no coincide: se pidió «${etapa}» y FEL_ETAPA_AUTORIZADA es «${env.FEL_ETAPA_AUTORIZADA ?? "(vacía)"}» (cada etapa se autoriza por separado)`);

  const lista = (env.FEL_PROYECTOS_DEV_PERMITIDOS ?? "").split(",").map((x) => x.trim());
  if (!env.FEL_PROYECTOS_DEV_PERMITIDOS || lista.some((x) => !RE_REF.test(x))) rechazar("FEL_PROYECTOS_DEV_PERMITIDOS falta o está mal formada (solo referencias exactas de 20 caracteres, sin comodines ni vacíos)");
  else {
    if (lista.length > 3) rechazar("FEL_PROYECTOS_DEV_PERMITIDOS tiene demasiadas referencias (máximo 3)");
    if (lista.some((x) => PROYECTOS_PROHIBIDOS.includes(x))) rechazar("la lista de permitidos contiene el proyecto principal de NEXA");
    if (ref && !lista.includes(ref)) rechazar("la referencia del proyecto no está en FEL_PROYECTOS_DEV_PERMITIDOS");
  }
  if (!env.FEL_CONFIRMAR_REF || (ref && env.FEL_CONFIRMAR_REF !== ref)) rechazar("FEL_CONFIRMAR_REF debe repetir exactamente la referencia del proyecto");
  if (env.FEL_PROYECTO_REF && ref && env.FEL_PROYECTO_REF !== ref) rechazar("FEL_PROYECTO_REF contradice la URL");

  // base de datos: directa (db.<ref>.supabase.co) o por pooler con usuario postgres.<ref>
  if (ref) {
    const directa = db.hostname === `db.${ref}.supabase.co`;
    const pooler = /\.pooler\.supabase\.com$/.test(db.hostname) && decodeURIComponent(db.username) === `postgres.${ref}`;
    if (!directa && !pooler) rechazar("DB_URL no corresponde a ESTE proyecto (host db.<ref>.supabase.co o pooler con usuario postgres.<ref>)");
  }
  // función de la API: local (corriendo con Deno contra el proyecto, sin desplegar) o la del propio proyecto
  if (!felLocal && !(ref && fel.protocol === "https:" && fel.hostname === `${ref}.supabase.co` && fel.pathname.startsWith("/functions/v1/") && !fel.username)) rechazar("FEL_API_URL debe ser local o la función del propio proyecto");

  // claves: el claim `ref` debe coincidir y el rol ser el esperado; las claves opacas exigen confirmación expresa
  for (const [nombre, valor, rol] of [["ANON_KEY", env.ANON_KEY ?? env.PUBLISHABLE_KEY, "anon"], ["SERVICE_ROLE_KEY", env.SERVICE_ROLE_KEY ?? env.SECRET_KEY, "service_role"]]) {
    if (!valor) { rechazar(`falta ${nombre}`); continue; }
    const c = claimsJwt(valor);
    if (!c) { if (env.FEL_CLAVES_OPACAS_CONFIRMADAS !== "si") rechazar(`${nombre} no es un JWT con claim ref: no se puede comprobar que sea de este proyecto (confirma con FEL_CLAVES_OPACAS_CONFIRMADAS=si)`); continue; }
    if (!c.ref || (ref && c.ref !== ref)) rechazar(`${nombre} pertenece a otro proyecto o no declara su ref`);
    if (c.role !== rol) rechazar(`${nombre} no es la clave ${rol} (¿intercambiadas?)`);
    if (c.ref && PROYECTOS_PROHIBIDOS.includes(c.ref)) rechazar(`${nombre} es del proyecto principal de NEXA`);
  }
  return { permitido: razones.length === 0, local: false, ref, razones };
}
