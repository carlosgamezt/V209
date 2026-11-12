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
  if (r.status === 401 && datos?.codigo === "no_sesion") document.dispatchEvent(new Event("fel-sesion-vencida"));
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
  certificar: (id, clave, escenario, proveedor) => llamar("POST", `/api/documentos/${id}/certificar`, { clave, escenario, ...(proveedor ? { proveedor } : {}) }),
  consultarProveedor: (id) => llamar("GET", `/api/documentos/${id}/consultar-proveedor`),
  anular: (id, clave, motivo, escenario) => llamar("POST", `/api/documentos/${id}/anular`, { clave, motivo, escenario }),
  conciliarAnulacion: (op) => llamar("POST", `/api/operaciones/${op}/conciliar-anulacion`, {}),
  plan: () => llamar("GET", "/api/plan"),
  panel: () => llamar("GET", "/api/panel"), usuarios: () => llamar("GET", "/api/usuarios"), crearUsuario: (u) => llamar("POST", "/api/usuarios", u), actualizarUsuario: (id, cambios) => llamar("POST", `/api/usuarios/${id}/actualizar`, cambios),
  sesion: () => llamar("GET", "/api/sesion"),
  entrar: (usuario, clave, recordar, codigo) => llamar("POST", "/api/sesion/entrar", { usuario, clave, recordar, codigo }),
  salir: () => llamar("POST", "/api/sesion/salir", {}),
  pl: {
    resumen: () => llamar("GET", "/api/plataforma/resumen"), planes: () => llamar("GET", "/api/plataforma/planes"), empresaPlan: (id) => llamar("GET", `/api/plataforma/empresas/${id}/plan`),
    crearEmpresa: (d) => llamar("POST", "/api/plataforma/empresas", d), estadoEmpresa: (id, estado, motivo) => llamar("POST", `/api/plataforma/empresas/${id}/estado`, { estado, motivo }),
    crearPlan: (d) => llamar("POST", "/api/plataforma/planes", d), crearVersion: (codigo, d) => llamar("POST", `/api/plataforma/planes/${codigo}/versiones`, d),
    contrato: (empresa, plan_version) => llamar("POST", "/api/plataforma/contratos", { empresa, plan_version }), pago: (empresa, monto, referencia, clave) => llamar("POST", "/api/plataforma/pagos", { empresa, monto, referencia, clave }),
    cuenta: (empresa, estado, cupo, motivo) => llamar("POST", "/api/plataforma/cuentas", { empresa, estado, cupo, motivo }),
    cobroGenerar: (empresa) => llamar("POST", "/api/plataforma/cobros/generar", { empresa }), cobroEmitir: (cobro, referencia, monto_total) => llamar("POST", "/api/plataforma/cobros/emitir", { cobro, referencia, monto_total }),
    bolson: () => llamar("GET", "/api/plataforma/bolson"), lote: (cuenta, unidades, costo_total, referencia) => llamar("POST", "/api/plataforma/bolson/lotes", { cuenta, unidades, costo_total, referencia }),
    conciliaciones: () => llamar("GET", "/api/plataforma/bolson/conciliaciones"), importarExtracto: (cuenta) => llamar("POST", "/api/plataforma/bolson/extractos/importar", { cuenta }),
    proponer: (extracto) => llamar("POST", "/api/plataforma/bolson/conciliaciones/proponer", { extracto }), decidir: (id, aprobar, nota) => llamar("POST", `/api/plataforma/bolson/conciliaciones/${id}/decidir`, { aprobar, nota }),
    resolverPartida: (id, accion, empresa, motivo) => llamar("POST", `/api/plataforma/bolson/partidas/${id}/resolver`, { accion, empresa, motivo }), simulador: (accion) => llamar("POST", "/api/plataforma/bolson/simulador", { accion }),
    resolverAlerta: (id, nota) => llamar("POST", `/api/plataforma/bolson/alertas/${id}/resolver`, { nota }), revisar: () => llamar("POST", "/api/plataforma/bolson/revisar", {}),
  },
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
