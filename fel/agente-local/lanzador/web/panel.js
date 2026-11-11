// Panel del agente NEXA FEL. El contenido dinámico se inserta siempre con textContent (nunca innerHTML).
(() => {
  const $ = (x) => document.getElementById(x);
  const mostrar = (cual) => { for (const s of ["paso-vincular", "paso-estado", "paso-cerrado"]) $(s).hidden = s !== cual; };
  const llamar = async (ruta, cuerpo) => {
    const r = await fetch(`api/${ruta}`, { method: "POST", headers: { "content-type": "application/json", "x-panel": "1" }, body: JSON.stringify(cuerpo ?? {}) });
    let j = null; try { j = await r.json(); } catch { /* sin cuerpo */ } return { ok: r.ok, estado: r.status, json: j };
  };
  const COLOR = { esperando: "ok", trabajando: "ok", vista_previa: "aviso", emitida: "ok", pausado: "aviso", descartada: "aviso", incierta: "mal", fallida: "mal", perdida: "mal", revocado: "mal", error: "mal", sin_vincular: "aviso" };
  let cerrado = false;
  function pintar(e) {
    if (cerrado) return;
    if (!e.vinculado) { mostrar("paso-vincular"); return; }
    mostrar("paso-estado");
    $("mensaje").textContent = e.mensaje; $("punto").className = `punto ${COLOR[e.fase] ?? ""}`;
    const pausado = e.fase === "pausado"; $("btn-pausar").hidden = pausado; $("btn-reanudar").hidden = !pausado;
    const ul = $("eventos"); ul.replaceChildren();
    for (const ev of [...e.eventos].reverse()) { const li = document.createElement("li"); li.textContent = `${new Date(ev.t).toLocaleTimeString("es-GT")} · ${ev.texto}`; ul.append(li); }
  }
  async function refrescar() { try { const r = await fetch("api/estado"); if (r.ok) pintar(await r.json()); } catch { if (!cerrado) { $("mensaje").textContent = "No se puede hablar con el agente. Es posible que se haya cerrado."; } } }
  $("btn-vincular").addEventListener("click", async () => {
    $("btn-vincular").disabled = true; $("error-vincular").hidden = true;
    const r = await llamar("vincular", { codigo: $("codigo").value });
    if (r.ok) pintar(r.json); else { $("error-vincular").textContent = r.json?.mensaje ?? "No se pudo vincular."; $("error-vincular").hidden = false; }
    $("btn-vincular").disabled = false;
  });
  $("btn-pausar").addEventListener("click", async () => { const r = await llamar("pausar"); if (r.ok) pintar(r.json); });
  $("btn-reanudar").addEventListener("click", async () => { const r = await llamar("reanudar"); if (r.ok) pintar(r.json); });
  $("btn-cerrar").addEventListener("click", async () => { $("btn-cerrar").disabled = true; await llamar("cerrar"); cerrado = true; mostrar("paso-cerrado"); });
  refrescar(); setInterval(refrescar, 1200);
})();
