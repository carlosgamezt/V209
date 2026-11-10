// Ejecutor del plan: llena campos con datos FICTICIOS y SE DETIENE. No existe ningún tipo de paso que emita, certifique o envíe.
// Falla cerrado: ante cualquier error o bloqueo de la guardia, la ejecución termina (no continúa con el resto del plan).
import { validarMapeo, validarDatos, valorDe, clasificarControl, hostPermitido } from "./guardia.mjs";
import { resolver } from "./localizar.mjs";

export class ErrorGuardia extends Error {}

const hostDe = (u) => { try { return new URL(u).hostname; } catch { return ""; } };
const rutaDe = (u) => { try { return new URL(u).pathname; } catch { return ""; } };

/**
 * @param {object} o  page, plan (mapeo), datos, registro, empresa, esperarUsuario(pregunta)->Promise<string>, local (solo autoprueba), reloj
 * @returns {{ok:boolean, detenido:boolean, resumen:object}}
 */
export async function ejecutarPlan({ page, plan, datos, registro, empresa = { alias: "sin-alias" }, esperarUsuario, local = false, reloj = () => Date.now(), timeout = 5000 }) {
  const vm = validarMapeo(plan, { local }), vd = validarDatos(datos);
  if (!vm.ok || !vd.ok) { for (const m of [...vm.errores, ...vd.errores]) registro.nota(`validación: ${m}`); return { ok: false, detenido: false, resumen: registro.resumen({ detenidoAntesDeEmitir: true }), errores_validacion: [...vm.errores, ...vd.errores] }; }

  const dominios = plan.dominios_permitidos;
  const comprobarHost = () => { const h = hostDe(page.url()); if (!hostPermitido(h, dominios)) throw new ErrorGuardia(`la pestaña está en «${h || "?"}», que no está en dominios_permitidos`); };
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) registro.navegacion({ host: hostDe(f.url()), ruta: rutaDe(f.url()) }); });
  page.on("dialog", (d) => { registro.nota(`diálogo ${d.type()} descartado`); d.dismiss().catch(() => {}); });   // descartar = cancelar: nunca se acepta nada

  let detenido = false, ok = true;
  const paso = async (p, modo, fn) => {
    const t = reloj();
    try { const detalle = (await fn()) ?? ""; registro.paso({ id: p.id, tipo: p.tipo, modo, ms: reloj() - t, resultado: "ok", detalle }); }
    catch (e) {
      const guardia = e instanceof ErrorGuardia;
      registro.paso({ id: p.id, tipo: p.tipo, modo, ms: reloj() - t, resultado: guardia ? "bloqueado" : "error", detalle: String(e.message ?? e).slice(0, 200) });
      ok = false; throw e;
    }
  };

  try {
    // 0) La sesión la inició una persona. Se confirma que corresponde a ESTA empresa (no hay forma automática segura de saberlo todavía).
    if (empresa.identidad?.confirmacion_manual !== false) {
      await paso({ id: "p-identidad", tipo: "manual" }, "manual", async () => {
        const r = await esperarUsuario(`¿La sesión abierta en Chrome corresponde a la empresa «${empresa.alias}»? (si/no)`);
        if (!/^s[ií]?$/i.test(String(r).trim())) throw new ErrorGuardia("la persona indicó que la sesión NO corresponde a esta empresa");
      });
    }
    for (const p of plan.pasos) {
      if (p.tipo === "manual") { await paso(p, "manual", async () => { await esperarUsuario(p.instruccion); }); continue; }
      if (p.tipo === "detener") {
        await paso(p, "auto", async () => { detenido = true; return "DETENIDO: la prueba termina aquí. No se emitió, certificó ni envió nada."; });
        break;
      }
      await paso(p, "auto", async () => {
        comprobarHost();
        const loc = await resolver(page, p.localizador, { timeout });
        switch (p.tipo) {
          case "esperar_visible": await loc.waitFor({ state: "visible", timeout }); return "";
          case "llenar": {
            const v = valorDe(datos, p.dato); if (v == null) throw new Error(`el dato «${p.dato}» no existe en los datos ficticios`);
            if (!(await loc.isVisible()) || !(await loc.isEnabled()) || !(await loc.isEditable())) throw new Error("el campo no está visible, habilitado y editable");
            await loc.fill(String(v));
            if (p.verificar !== false && (await loc.inputValue()) !== String(v)) throw new Error("el campo no conservó el valor escrito (el portal lo modificó o lo rechazó)");
            return `campo llenado (${p.dato})`;
          }
          case "seleccionar": {
            const v = valorDe(datos, p.dato); if (v == null) throw new Error(`el dato «${p.dato}» no existe`);
            if ((await loc.evaluate((el) => el.tagName)) !== "SELECT") throw new Error("no es un <select> nativo (los desplegables personalizados necesitan observación aparte)");
            await loc.selectOption({ label: String(v) }); return `opción elegida (${p.dato})`;
          }
          case "marcar": { const v = valorDe(datos, p.dato); await loc.setChecked(v === true || v === "true"); return `casilla (${p.dato})`; }
          case "leer": {
            const v = valorDe(datos, p.dato), real = await loc.evaluate((el) => ("value" in el && el.value !== "" ? el.value : el.textContent) ?? "");
            if (String(real).trim() !== String(v)) throw new Error(`lo leído no coincide con lo esperado (longitudes ${String(real).trim().length} vs ${String(v).length})`);
            return "lectura coincide";
          }
          case "clic_seguro": {
            const info = await loc.evaluate((el) => ({ tag: el.tagName.toLowerCase(), type: (el.getAttribute("type") || "").toLowerCase(), texto: (el.innerText || el.value || "").replace(/\s+/g, " ").trim().slice(0, 80), etiqueta: el.getAttribute("aria-label") || "", titulo: el.getAttribute("title") || "", id: el.id, nombre: el.getAttribute("name") || "", enFormulario: !!el.closest("form"), href: el.tagName === "A" ? (el.getAttribute("href") || "") : "" }));
            const c = clasificarControl(info);
            if (c.nivel === "prohibido") throw new ErrorGuardia(`clic RECHAZADO: el control ${c.razones.join("; ")}`);
            if (c.envia_formulario && p.permitir_envia_formulario !== true) throw new ErrorGuardia("clic RECHAZADO: el control puede enviar un formulario");
            if (c.nivel === "ambiguo" && !c.envia_formulario && p.ambiguo_aprobado !== true) throw new ErrorGuardia(`clic RECHAZADO: control ambiguo (${c.razones.join("; ")}) sin ambiguo_aprobado`);
            await loc.click({ timeout }); return `clic: ${p.motivo}`;
          }
          default: throw new Error(`tipo sin implementar: ${p.tipo}`);
        }
      });
    }
  } catch (e) { if (process.env.FEL_POC_DEBUG) console.error(e); /* el detalle ya quedó en el registro; se termina sin seguir */ }
  return { ok: ok && detenido, detenido, resumen: registro.resumen({ detenidoAntesDeEmitir: true }) };
}
