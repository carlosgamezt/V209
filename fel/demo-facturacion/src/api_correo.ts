// Rutas de la API para el envío de facturas por correo. Todo ocurre en el servidor: el navegador solo manda la intención (destinatario, clave de la solicitud, confirmación) y recibe el resultado.
// La empresa, la persona y los permisos salen de la SESIÓN; nunca de lo que mande el navegador. Ni claves ni adjuntos viajan por aquí.
import type { CtxDigifact } from "./api_digifact.ts";
import { ErrorCorreo, type ServicioCorreo } from "./correo/servicio.ts";

const NO_HABILITADO = { codigo: "correo_no_habilitado", mensaje: "El envío por correo no está habilitado en este servidor." };

/** Atiende las rutas de correo. Devuelve null si la ruta no es de este módulo. */
export async function rutasCorreo(c: CtxDigifact, svc: ServicioCorreo | undefined): Promise<Response | null> {
  const { m, ruta } = c; let r: RegExpExecArray | null;
  const esEstado = m === "GET" && ruta === "/api/correo/estado";
  const esHistorial = m === "GET" && (r = /^\/api\/documentos\/([^/]+)\/correos$/.exec(ruta));
  const esEnvio = m === "POST" && (r = /^\/api\/documentos\/([^/]+)\/correo$/.exec(ruta));
  if (!esEstado && !esHistorial && !esEnvio) return null;
  try {
    const permisos = await c.permisos();
    if (esEstado) {
      const disponible = !!svc && await svc.disponible();
      return c.json({ habilitado: disponible, proveedor: svc?.proveedorNombre ?? null, automatico: !!svc?.automatico && disponible, ambiente: "TEST",
        puedeVer: permisos.includes("correos.ver"), puedeEnviar: permisos.includes("correos.enviar"), puedeReenviar: permisos.includes("correos.reenviar") });
    }
    if (!svc || !(await svc.disponible())) return c.json(NO_HABILITADO, 503);
    const ctx = { empresaId: c.empresa, actorId: c.a.id, permisos };
    const docId = c.id(r![1]);
    if (esHistorial) return c.json({ envios: await svc.historial(ctx, docId) });
    const b = await c.cuerpo();
    const res = await svc.enviar(ctx, { documentoId: docId, destinatario: typeof b.destinatario === "string" ? b.destinatario : undefined, clave: String(b.clave ?? ""),
      reenvio: b.reenvio === true, confirmacion: typeof b.confirmacion === "string" ? b.confirmacion : undefined, origen: "manual" });
    return c.json(res, res.repetido ? 200 : 201);
  } catch (e) {
    if (e instanceof ErrorCorreo) return c.json({ codigo: e.codigo, mensaje: e.message }, e.status);
    throw e;
  }
}
