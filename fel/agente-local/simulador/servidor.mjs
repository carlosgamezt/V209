// SERVIDOR del SIMULADOR LOCAL del formulario FEL: solo escucha en 127.0.0.1, no contacta ningún host externo, sin credenciales.
// Dos superficies separadas:
//   · /f/<sesión>…  → la que usa el NAVEGADOR (formulario). Aquí —y solo aquí— puede confirmarse.
//   · /control/…    → la que usa el agente/las pruebas, con un token de control. Puede crear sesiones, consultar estados/eventos/libro e interrumpir; NUNCA confirmar.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { crearNucleo, ErrorSim, esEmpresaValida, esReferenciaValida } from "./nucleo.mjs";

const WEB = fileURLToPath(new URL("./web/", import.meta.url));
const ESTATICOS = { "/estilo.css": ["estilo.css", "text/css; charset=utf-8"], "/app.js": ["app.js", "text/javascript; charset=utf-8"] };
const MAX_CUERPO = 64 * 1024;
const CABECERAS = {
  "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-frame-options": "DENY",
  "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
};
const igual = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };

export async function iniciarSimulador({ puerto = 0, ahora, demoraLentoMs = 1500 } = {}) {
  const nucleo = crearNucleo({ ahora });
  const tokenControl = randomBytes(24).toString("hex");
  let host = "127.0.0.1", port = 0;

  const responder = (res, estado, cuerpo, tipo = "application/json; charset=utf-8", extra = {}) => {
    res.writeHead(estado, { ...CABECERAS, "content-type": tipo, ...extra });
    res.end(typeof cuerpo === "string" || Buffer.isBuffer(cuerpo) ? cuerpo : JSON.stringify(cuerpo));
  };
  const error = (res, estado, codigo, mensaje) => responder(res, estado, { error: codigo, mensaje });
  const leerJson = (req) => new Promise((ok, ko) => {
    if (!/^application\/json(\s*;|$)/i.test(req.headers["content-type"] ?? "")) return ko(new ErrorSim("TIPO", "-", "Se esperaba JSON"));
    let n = 0; const trozos = [];
    let excedido = false;
    req.on("data", (c) => { n += c.length; if (excedido) return; if (n > MAX_CUERPO) { excedido = true; trozos.length = 0; ko(new ErrorSim("TAMANO", "-", "Cuerpo demasiado grande")); } else trozos.push(c); });   // se descarta el resto sin cortar la conexión: así el cliente recibe el 413
    req.on("end", () => { if (excedido) return; try { const v = JSON.parse(Buffer.concat(trozos).toString("utf8")); ok(v !== null && typeof v === "object" ? v : {}); } catch { ko(new ErrorSim("JSON", "-", "JSON no válido")); } });
    req.on("error", ko);
  });
  const hostValido = (req) => { const h = req.headers.host; return h === `127.0.0.1:${port}` || h === `localhost:${port}`; };   // anti DNS-rebinding
  const origenValido = (req) => { const o = req.headers.origin; return o === undefined || o === `http://127.0.0.1:${port}` || o === `http://localhost:${port}`; };
  const autorizadoControl = (req) => igual(req.headers["x-control-token"] ?? "", tokenControl);
  const vistaEstado = (s) => ({ id: s.id, empresa: s.empresa, referencia: s.referencia, estado: s.estado, fallo: s.fallo, total: s.resumen?.total ?? null });
  const mapaErr = { DATOS: 400, TIPO: 415, TAMANO: 413, JSON: 400, ESTADO: 409, CSRF: 403, SOLO_HUMANO: 403, YA_CONFIRMADA: 409, ERROR_SERVIDOR: 500 };

  const servidor = http.createServer(async (req, res) => {
    try {
      if (!hostValido(req)) return error(res, 421, "HOST", "Host no permitido");
      const url = new URL(req.url, `http://127.0.0.1:${port}`), ruta = url.pathname, m = req.method;
      const ses = /^\/f\/([0-9a-f]{32})(\/[a-z-]+)?$/.exec(ruta);

      // --- estáticos y página del formulario
      if (m === "GET" && ESTATICOS[ruta]) { const [f, t] = ESTATICOS[ruta]; return responder(res, 200, await readFile(WEB + f), t); }
      if (m === "GET" && ses && !ses[2]) {
        const s = nucleo.sesion(ses[1]); if (!s) return error(res, 404, "NO_EXISTE", "Sesión no encontrada");
        if (s.estado === "creada") nucleo.abrir(s);
        return responder(res, 200, await readFile(WEB + "formulario.html"), "text/html; charset=utf-8");
      }
      if (m === "GET" && ses && ses[2] === "/estado") { const s = nucleo.sesion(ses[1]); return s ? responder(res, 200, vistaEstado(s)) : error(res, 404, "NO_EXISTE", "Sesión no encontrada"); }

      // --- acciones del navegador (únicas que pueden confirmar)
      if (m === "POST" && ses && ses[2]) {
        if (!origenValido(req)) return error(res, 403, "ORIGEN", "Origen no permitido");
        const s = nucleo.sesion(ses[1]); if (!s) return error(res, 404, "NO_EXISTE", "Sesión no encontrada");
        const origen = req.headers["x-control-token"] !== undefined ? "agente" : "humano";   // cualquier petición que lleve el token de control se trata como del agente
        const cuerpo = await leerJson(req);
        if (ses[2] === "/vista-previa") { const r = nucleo.previsualizar(s, cuerpo.formulario); return responder(res, r.ok ? 200 : 422, r); }
        if (ses[2] === "/editar") { nucleo.volver(s); return responder(res, 200, vistaEstado(s)); }
        if (ses[2] === "/descartar") { nucleo.descartar(s, cuerpo.csrf); return responder(res, 200, vistaEstado(s)); }
        if (ses[2] === "/confirmar") {
          const r = nucleo.confirmar(s, { csrf: cuerpo.csrf, origen });
          if (r.cortar) { req.socket.destroy(); return; }                                  // corte de conexión SIMULADO tras registrar: el navegador no recibe respuesta
          if (s.fallo === "lento") await new Promise((ok) => setTimeout(ok, demoraLentoMs));
          const { id, serie, numero, autorizacion, t } = r.emision; return responder(res, 200, { emision: { id, serie, numero, autorizacion, t } });
        }
        return error(res, 404, "NO_EXISTE", "Ruta no encontrada");
      }

      // --- control (agente / pruebas)
      if (ruta.startsWith("/control/")) {
        if (!autorizadoControl(req)) return error(res, 401, "NO_AUTORIZADO", "Token de control no válido");
        const empresa = url.searchParams.get("empresa") ?? "";
        if (m === "POST" && ruta === "/control/sesiones") {
          const c = await leerJson(req); const s = nucleo.crearSesion({ empresa: c.empresa, referencia: c.referencia, fallo: c.fallo });
          return responder(res, 201, { ...vistaEstado(s), url: `http://127.0.0.1:${port}/f/${s.id}` });
        }
        const cs = /^\/control\/sesiones\/([0-9a-f]{32})(\/interrumpir)?$/.exec(ruta);
        if (cs) {
          if (!esEmpresaValida(empresa)) return error(res, 400, "DATOS", "empresa requerida");
          const s = nucleo.sesionDeEmpresa(cs[1], empresa); if (!s) return error(res, 404, "NO_EXISTE", "Sesión no encontrada");   // otra empresa ⇒ como si no existiera
          if (m === "GET" && !cs[2]) return responder(res, 200, vistaEstado(s));
          if (m === "POST" && cs[2]) { nucleo.interrumpir(s, "control"); return responder(res, 200, vistaEstado(s)); }
        }
        if (m === "GET" && ruta === "/control/eventos") { if (!esEmpresaValida(empresa)) return error(res, 400, "DATOS", "empresa requerida"); return responder(res, 200, nucleo.eventos({ empresa, sesion: url.searchParams.get("sesion") ?? undefined })); }
        if (m === "GET" && ruta === "/control/emisiones") {
          if (!esEmpresaValida(empresa)) return error(res, 400, "DATOS", "empresa requerida");
          const ref = url.searchParams.get("referencia") ?? undefined; if (ref !== undefined && !esReferenciaValida(ref)) return error(res, 400, "DATOS", "referencia no válida");
          return responder(res, 200, nucleo.emisiones({ empresa, referencia: ref }));
        }
        // Nada de «confirmar» por control: no existe esa ruta a propósito.
        return error(res, 404, "NO_EXISTE", "Ruta no encontrada");
      }
      return error(res, 404, "NO_EXISTE", "Ruta no encontrada");
    } catch (e) {
      if (e instanceof ErrorSim) return error(res, mapaErr[e.codigo] ?? 400, e.codigo, e.message);
      return error(res, 500, "ERROR", "Error interno");                                     // nunca se filtra el detalle
    }
  });
  await new Promise((ok, ko) => { servidor.once("error", ko); servidor.listen(puerto, host, ok); });
  port = servidor.address().port;
  return {
    puerto: port, url: `http://127.0.0.1:${port}`, tokenControl, nucleo,
    detener: () => new Promise((ok) => { servidor.close(() => ok()); servidor.closeAllConnections?.(); }),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const s = await iniciarSimulador({ puerto: Number(process.env.FEL_SIM_PUERTO ?? 0) });
  console.log(`Simulador FEL (SIMULADO - SIN VALOR FISCAL) en ${s.url}`);
  console.log(`Token de control: ${s.tokenControl}`);
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, async () => { await s.detener(); process.exit(0); });
}
