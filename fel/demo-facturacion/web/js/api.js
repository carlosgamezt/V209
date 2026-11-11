// Cliente HTTP de la demostración. Todas las operaciones pasan por el servidor local, que usa las funciones SQL y el orquestador reales.
export class ErrorApi extends Error {
  constructor(mensaje, codigo = "error", status = 0) { super(mensaje); this.codigo = codigo; this.status = status; }
}
let usuario = "ana";
try { const g = localStorage.getItem("fel_demo_usuario"); if (g && ["ana", "luis", "marta", "pedro"].includes(g)) usuario = g; } catch { /* sin almacenamiento: se usa el predeterminado */ }
export const usuarioActual = () => usuario;
export function cambiarUsuario(u) { usuario = u; try { localStorage.setItem("fel_demo_usuario", u); } catch { /* ignorado */ } }

export async function llamar(metodo, ruta, cuerpo) {
  let r;
  try {
    r = await fetch(ruta, { method: metodo, headers: { "x-demo": "1", "x-demo-usuario": usuario, "content-type": "application/json" }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  } catch { throw new ErrorApi("No hay conexión con el servidor de la demostración.", "red", 0); }
  let datos = null; try { datos = await r.json(); } catch { /* sin cuerpo */ }
  if (!r.ok) throw new ErrorApi(datos?.mensaje || "No se pudo completar la operación.", datos?.codigo || "error", r.status);
  return datos;
}
export const api = {
  estado: () => llamar("GET", "/api/estado"),
  clientes: () => llamar("GET", "/api/clientes"),
  guardarCliente: (c) => llamar("POST", "/api/clientes", c),
  frecuenteCliente: (id, frecuente) => llamar("POST", `/api/clientes/${id}/frecuente`, { frecuente }),
  estadoCliente: (id, activo) => llamar("POST", `/api/clientes/${id}/estado`, { activo }),
  estadoConcepto: (id, activo) => llamar("POST", `/api/conceptos/${id}/estado`, { activo }),
  guardarEmpresa: (e) => llamar("POST", "/api/empresa", e),
  conceptos: () => llamar("GET", "/api/conceptos"),
  guardarConcepto: (c) => llamar("POST", "/api/conceptos", c),
  configuracion: () => llamar("GET", "/api/configuracion"),
  guardarEstablecimiento: (e) => llamar("POST", "/api/establecimientos", e),
  documentos: () => llamar("GET", "/api/documentos"),
  documento: (id) => llamar("GET", `/api/documentos/${id}`),
  guardar: (d) => llamar("POST", "/api/documentos", d),
  estadoPreparacion: (id, estado, version, motivo) => llamar("POST", `/api/documentos/${id}/estado`, { estado, version, motivo }),
  reabrir: (id, version) => llamar("POST", `/api/documentos/${id}/reabrir`, { version }),
  validar: (id) => llamar("POST", `/api/documentos/${id}/validar`, {}),
  certificar: (id, clave, escenario) => llamar("POST", `/api/documentos/${id}/certificar`, { clave, escenario }),
  conciliar: (op) => llamar("POST", `/api/operaciones/${op}/conciliar`, {}),
  proponer: (op, tipo, evidencia, datos) => llamar("POST", `/api/operaciones/${op}/conciliacion`, { tipo, evidencia, datos }),
  decidir: (id, aprobar, nota) => llamar("POST", `/api/conciliaciones/${id}/decidir`, { aprobar, nota }),
  resolverAlerta: (id, nota) => llamar("POST", `/api/alertas/${id}/resolver`, { nota }),
  liberarTardios: () => llamar("POST", "/api/demo/liberar-tardios", {}),
  auditar: () => llamar("POST", "/api/demo/auditar", {}),
  recuperar: () => llamar("POST", "/api/demo/recuperar", {}),
  completarHumana: (operacion) => llamar("POST", "/api/demo/completar-humana", { operacion }),
  caida: (documento, clave, escenario, punto) => llamar("POST", "/api/demo/caida", { documento, clave, escenario, punto }),
};
