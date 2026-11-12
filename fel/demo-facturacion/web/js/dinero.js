// Importes de la capa comercial: vienen con 6 decimales exactos; se muestran sin ceros de más (mínimo 2 decimales), sin redondear.
import { quetzales as base } from "/app/js/ui.js";
export const quetzales = (t) => { if (t === null || t === undefined || t === "") return "—"; const [e, d = ""] = String(t).split("."); return base(`${e}.${d.replace(/0+$/, "")}`); };
