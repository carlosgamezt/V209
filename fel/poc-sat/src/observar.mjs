// Observación (solo lectura): inventario de los controles de la página activa para que una persona construya el mapeo con
// lo que REALMENTE existe. No hace clic, no escribe, no lee valores de campos, no toca cookies ni almacenamiento.
import { clasificarControl, textoProhibido } from "./guardia.mjs";

/* Se ejecuta DENTRO de la página. Devuelve solo estructura: etiquetas, tipos y atributos; NUNCA el valor de un campo. */
function recoger({ incluirOpciones }) {
  const txt = (s, n = 80) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const etiquetaDe = (el) => {
    let t = "";
    if (el.labels && el.labels.length) t = [...el.labels].map((l) => l.innerText).join(" ");
    if (!t && el.getAttribute("aria-labelledby")) t = el.getAttribute("aria-labelledby").split(/\s+/).map((i) => document.getElementById(i)?.innerText || "").join(" ");
    if (!t) t = el.getAttribute("aria-label") || "";
    return txt(t);
  };
  const rolDe = (el) => {
    const r = el.getAttribute("role"); if (r) return r;
    const tag = el.tagName.toLowerCase(), ty = (el.getAttribute("type") || "text").toLowerCase();
    if (tag === "button") return "button";
    if (tag === "select") return el.multiple ? "listbox" : "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input") return ["button", "submit", "reset", "image"].includes(ty) ? "button" : ty === "checkbox" ? "checkbox" : ty === "radio" ? "radio" : ["hidden", "file", "range", "color"].includes(ty) ? "" : "textbox";
    return "";
  };
  const idGenerado = (id) => !id || /^(:r|ember|ng-|mat-|react|rc-|radix|headlessui|[0-9a-f]{8}-[0-9a-f]{4})/i.test(id) || /\d{4,}/.test(id);
  const els = [...document.querySelectorAll("input,select,textarea,button,[role=button],[role=tab],[role=combobox],[role=checkbox],[role=radio],[role=switch],[role=textbox]")]
    .filter((el) => !(el.tagName === "INPUT" && (el.getAttribute("type") || "").toLowerCase() === "hidden"));
  const datos = els.map((el) => {
    const tag = el.tagName.toLowerCase(), type = (el.getAttribute("type") || "").toLowerCase();
    const esBoton = tag === "button" || (tag === "input" && ["submit", "button", "reset", "image"].includes(type)) || ["button", "tab"].includes(el.getAttribute("role") || "");
    const texto = esBoton ? txt(el.innerText || el.value || el.getAttribute("aria-label")) : "";
    const o = {
      tag, type, rol: rolDe(el), visible: visible(el), deshabilitado: !!el.disabled, soloLectura: !!el.readOnly, requerido: !!(el.required || el.getAttribute("aria-required") === "true"),
      enFormulario: !!el.closest("form"), etiqueta: etiquetaDe(el), texto, titulo: txt(el.getAttribute("title")), nombre: txt(el.getAttribute("name")), id: idGenerado(el.id) ? "" : txt(el.id),
      id_generado: !!el.id && idGenerado(el.id), marcador: txt(el.getAttribute("placeholder")), href: el.tagName === "A" ? txt(el.getAttribute("href"), 120) : "",
      autocompletar: txt(el.getAttribute("autocomplete"), 30),
    };
    if (tag === "select") { o.opciones_n = el.options.length; if (incluirOpciones) o.opciones = [...el.options].slice(0, 30).map((x) => txt(x.textContent, 40)); }
    return o;
  });
  // unicidad de cada candidato dentro de ESTE documento
  const cuenta = (f) => datos.filter(f).length;
  for (const o of datos) {
    const c = [];
    if (o.etiqueta) c.push({ estrategia: "etiqueta", valor: o.etiqueta, exacto: true, unico: cuenta((x) => x.etiqueta === o.etiqueta) === 1 });
    if (o.rol && (o.etiqueta || o.texto)) { const n = o.etiqueta || o.texto; c.push({ estrategia: "rol", rol: o.rol, valor: n, exacto: true, unico: cuenta((x) => x.rol === o.rol && (x.etiqueta || x.texto) === n) === 1 }); }
    if (o.id) c.push({ estrategia: "id", valor: o.id, unico: document.querySelectorAll(`[id="${o.id.replace(/"/g, '\\"')}"]`).length === 1 });
    if (o.nombre) c.push({ estrategia: "nombre", valor: o.nombre, unico: cuenta((x) => x.nombre === o.nombre) === 1 });
    if (o.marcador) c.push({ estrategia: "marcador", valor: o.marcador, exacto: true, unico: cuenta((x) => x.marcador === o.marcador) === 1 });
    o.candidatos = c;
  }
  const todos = [...document.querySelectorAll("*")];
  const captcha = !!document.querySelector('iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="turnstile"],.g-recaptcha,.h-captcha,[class*="captcha" i],[id*="captcha" i]');
  const frameworks = [];
  if (document.querySelector("[ng-version]") || window.angular) frameworks.push("angular");
  if (document.querySelector("[data-reactroot]") || window.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers?.size) frameworks.push("react");
  if (window.Vue || document.querySelector("[data-v-app]")) frameworks.push("vue");
  if (window.jQuery) frameworks.push("jquery");
  return { controles: datos, shadow_abierto: todos.filter((e) => e.shadowRoot).length, contenteditable: document.querySelectorAll("[contenteditable=true]").length, captcha, frameworks };
}

const sinQuery = (u) => { try { const x = new URL(u); return { host: x.hostname, ruta: x.pathname }; } catch { return { host: "", ruta: "" }; } };

export async function inventariar(page, { incluirOpciones = false } = {}) {
  const marcos = page.frames(), controles = [], informe = [];
  let n = 0;
  for (const [i, f] of marcos.entries()) {
    const u = sinQuery(f.url());
    try {
      const r = await f.evaluate(recoger, { incluirOpciones });
      informe.push({ indice: i, principal: f === page.mainFrame(), ...u, controles: r.controles.length, shadow_abierto: r.shadow_abierto, contenteditable: r.contenteditable, captcha: r.captcha, frameworks: r.frameworks });
      for (const c of r.controles) {
        const cl = clasificarControl(c);
        const cand = c.candidatos.map((k) => (f === page.mainFrame() ? k : { ...k, marco: { url_contiene: u.host + u.ruta } }));
        controles.push({ n: `c${String(++n).padStart(3, "0")}`, marco: i, ...c, candidatos: cand, mejor: cand.find((k) => k.unico) ?? null, clasificacion: cl.nivel, envia_formulario: cl.envia_formulario, razones: cl.razones });
      }
    } catch (e) { informe.push({ indice: i, ...u, error: String(e.message ?? e).slice(0, 120) }); }
  }
  const u = sinQuery(page.url());
  return {
    version: 1, generado: new Date().toISOString(), pagina: { ...u, titulo: String((await page.title().catch(() => "")) ?? "").slice(0, 80) },
    marcos: informe, total_controles: controles.length,
    senales_sesion: { campo_clave_visible: controles.some((c) => c.type === "password" && c.visible), nota: "Si esta página es la de inicio de sesión, campo_clave_visible será true. Observa también la página ya con sesión iniciada para elegir un indicador de «sesión activa»." },
    sin_candidato_unico: controles.filter((c) => !c.mejor && c.tag !== "button").length,
    con_riesgo_de_emision: controles.filter((c) => c.clasificacion !== "ok").length,
    controles,
    advertencia: "Esta observación no contiene valores de campos. Revísala antes de compartirla: puede contener etiquetas con nombres de tu empresa. No incluye controles dentro de shadow DOM cerrado ni de marcos que Chrome no deje inspeccionar.",
  };
}

/** Borrador de mapeo A PARTIR de lo observado. Todo sale con verificado=false y dato=null: una persona decide qué dato va en cada campo y lo confirma. */
export function borradorMapeo(inv) {
  const omitidos = [], pasos = [{ id: "p000-sesion", tipo: "manual", instruccion: "Abre tú mismo el formulario FEL de PRUEBA en la sesión ya iniciada (sin emitir) y pulsa Enter." }];
  for (const c of inv.controles) {
    if (!["input", "select", "textarea"].includes(c.tag) || !c.visible || c.deshabilitado || c.soloLectura) continue;
    if (["hidden", "submit", "button", "reset", "image", "file", "password"].includes(c.type)) { if (c.type === "password") omitidos.push({ n: c.n, motivo: "campo de contraseña: nunca se automatiza" }); continue; }
    if (c.clasificacion === "prohibido" || c.envia_formulario) { omitidos.push({ n: c.n, motivo: c.razones.join("; ") }); continue; }
    if (!c.mejor) { omitidos.push({ n: c.n, motivo: "sin localizador único: hay que decidirlo a mano" }); continue; }
    const tipo = c.tag === "select" ? "seleccionar" : ["checkbox", "radio"].includes(c.type) ? "marcar" : "llenar";
    pasos.push({ id: `p${String(pasos.length).padStart(3, "0")}-${c.n}`, tipo, comentario: `observado: ${c.etiqueta || c.marcador || c.nombre || c.id}`, localizador: c.mejor, dato: null, verificado: false });
  }
  pasos.push({ id: "p999-detener", tipo: "detener" });
  const dominios = [...new Set(inv.marcos.filter((m) => m.principal && m.host).map((m) => m.host))];
  return { version: 1, comentario: "BORRADOR generado a partir de una observación. Rellena «dato» con rutas del archivo de datos ficticios, confirma cada localizador contra el portal real y cambia verificado a true. Confirma también dominios_permitidos y completa «sesion» con lo que observes (páginas de inicio de sesión e indicadores de sesión activa; ninguno se inventa).", dominios_permitidos: dominios, permitir_post: [], sesion: { hosts_login: [], rutas_login: [], indicadores_sesion_activa: [], indicadores_login: [], campo_clave_visible: true }, pasos, omitidos_por_riesgo: omitidos };
}
export const controlesDeRiesgo = (inv) => inv.controles.filter((c) => c.clasificacion !== "ok").map((c) => ({ n: c.n, texto: c.texto || c.etiqueta, nivel: c.clasificacion, razones: c.razones }));
export { textoProhibido };
