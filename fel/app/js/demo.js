// Backend DE DEMOSTRACIÓN en memoria. Imita las reglas del servidor (versiones, estados, permisos, cálculo exacto) para poder
// revisar la interfaz sin conectar nada. NO guarda datos: al recargar vuelve a los de ejemplo. No hay credenciales ni red.
import { ErrorApi } from "./api.js";
import { calcular } from "./calculo.js";

const TODOS = ["empresa.ver", "usuarios.ver", "usuarios.gestionar", "clientes.ver", "clientes.escribir", "conceptos.ver", "conceptos.escribir",
  "borradores.ver", "borradores.crear", "borradores.editar", "borradores.revisar", "borradores.archivar", "historial.ver", "auditoria.ver", "fiscal.ver"];
const ROLES = {
  propietario: TODOS, administrador: TODOS,
  emisor: ["empresa.ver", "clientes.ver", "clientes.escribir", "conceptos.ver", "conceptos.escribir", "borradores.ver", "borradores.crear", "borradores.editar", "historial.ver", "fiscal.ver"],
  lector: ["empresa.ver", "clientes.ver", "conceptos.ver", "borradores.ver", "historial.ver", "fiscal.ver"],
};
const TIPOS = [
  { codigo: "NIT", nombre: "Número de Identificación Tributaria", verificado: false },
  { codigo: "CUI", nombre: "Código Único de Identificación (DPI)", verificado: false },
  { codigo: "CF", nombre: "Consumidor final", verificado: false },
  { codigo: "EXT", nombre: "Identificación de extranjero / otro", verificado: false },
];
const uuid = () => crypto.randomUUID();
const dormir = () => new Promise((r) => setTimeout(r, 40));
const copia = (x) => structuredClone(x);

export function crearDemo({ rol = "propietario" } = {}) {
  const EMP = "10000000-0000-0000-0000-00000000000a";
  const ahora = () => new Date().toISOString();
  let rolActual = rol;
  const cli = (nombre, tipo, num, extra = {}) => ({ id: uuid(), empresa_id: EMP, tipo_identificacion: tipo, numero_identificacion: num, nombre, direccion: null, email: null, telefono: null, activo: true, version: 1, ...extra });
  const con = (codigo, descripcion, tipo, precio, extra = {}) => ({ id: uuid(), empresa_id: EMP, codigo, descripcion, tipo, unidad_medida: tipo === "bien" ? "UND" : "SRV", precio_unitario: precio, categoria_fiscal: null, activo: true, version: 1, ...extra });
  const clientes = [
    cli("Comercial Los Pinos, S.A.", "NIT", "1234567-8", { direccion: "6a avenida 12-34, zona 1, Guatemala", email: "compras@lospinos.example", telefono: "2222-3344" }),
    cli("Ferretería El Tornillo", "NIT", "7654321-K", { email: "ventas@tornillo.example", telefono: "5555-1020" }),
    cli("María Fernanda López", "CUI", "2456789120101", { email: "mf.lopez@example.com" }),
    cli("Consumidor final", "CF", "CF"),
    cli("Pacific Imports LLC", "EXT", "X1234567", { direccion: "Miami, Florida" }),
    cli("Servicios Gráficos Aurora", "NIT", "9988776-5", { activo: false }),
  ];
  const conceptos = [
    con("SRV-001", "Consultoría administrativa (hora)", "servicio", "250.00"),
    con("SRV-002", "Mantenimiento de equipo", "servicio", "450.50"),
    con("PRD-001", "Resma de papel bond carta", "bien", "42.75"),
    con("PRD-002", "Tóner negro compatible", "bien", "385.00"),
    con("PRD-003", "Cable HDMI 2 m", "bien", "59.90"),
    con("SRV-003", "Capacitación (sesión de 3 h)", "servicio", "1200.00"),
    con("PRD-004", "Archivador de palanca", "bien", "28.333333"),
    con("SRV-004", "Soporte remoto", "servicio", "180.00", { activo: false }),
  ];
  const docs = [];
  let siguiente = 1;
  const nuevoDoc = (cliente, lineas, prep = "borrador", fecha = "2026-11-10", obs = null) => {
    const c = calcular(lineas.map((l) => ({ descuento_tipo: "ninguno", descuento_valor: "0", ...l })));
    const d = { id: uuid(), empresa_id: EMP, tipo_documento: "factura", estado_preparacion: prep, estado_fiscal: "ninguno", numero_borrador: siguiente++,
      cliente_id: cliente?.id ?? null, cliente_snapshot: cliente ? { nombre: cliente.nombre, tipo_identificacion: cliente.tipo_identificacion, numero_identificacion: cliente.numero_identificacion } : null,
      fecha_emision_prevista: fecha, observaciones: obs, subtotal: c.subtotal, descuento_total: c.descuento_total, base_imponible: c.base_imponible, impuestos: null, total: null,
      calculo: c.meta, version: 1, serie: null, numero_fiscal: null, autorizacion_sat: null, actualizado_en: ahora(),
      lineas: lineas.map((l, i) => ({ orden: i + 1, descuento_tipo: "ninguno", descuento_valor: "0", importes: c.lineas[i], ...l })) };
    docs.push(d); return d;
  };
  nuevoDoc(clientes[0], [{ concepto_id: conceptos[0].id, descripcion: conceptos[0].descripcion, cantidad: "8", precio_unitario: "250.00", descuento_tipo: "porcentaje", descuento_valor: "10" },
    { concepto_id: conceptos[2].id, descripcion: conceptos[2].descripcion, cantidad: "20", precio_unitario: "42.75" }], "revisado", "2026-11-08", "Entrega en bodega central.");
  nuevoDoc(clientes[1], [{ concepto_id: conceptos[4].id, descripcion: conceptos[4].descripcion, cantidad: "12", precio_unitario: "59.90" }]);
  nuevoDoc(clientes[3], [{ concepto_id: conceptos[3].id, descripcion: conceptos[3].descripcion, cantidad: "2", precio_unitario: "385.00", descuento_tipo: "monto", descuento_valor: "20" }]);
  nuevoDoc(clientes[2], [{ concepto_id: conceptos[5].id, descripcion: conceptos[5].descripcion, cantidad: "1", precio_unitario: "1200.00" }], "archivado", "2026-10-30");

  const permisos = () => ROLES[rolActual];
  const exigir = (p) => { if (!permisos().includes(p)) throw new ErrorApi("No tienes permiso para esta operación.", "no_autorizado", 403); };
  const texto = (v, campo, min, max) => { const t = String(v ?? "").trim(); if (t.length < min || t.length > max) throw new ErrorApi(`${campo}: entre ${min} y ${max} caracteres.`, "entrada_invalida"); return t; };
  const opc = (v) => { const t = String(v ?? "").trim(); return t === "" ? null : t; };
  const buscarVersion = (lista, id, version, que) => {
    const r = lista.find((x) => x.id === id);
    if (!r) throw new ErrorApi(`${que} no encontrado.`, "no_encontrado", 404);
    if (version !== r.version) throw new ErrorApi(`El ${que.toLowerCase()} cambió mientras lo editabas; recarga e intenta de nuevo.`, "conflicto", 409);
    return r;
  };

  return {
    modo: "demo",
    roles: Object.keys(ROLES),
    cambiarRol(r) { rolActual = r; },
    async sesion() {
      await dormir();
      return { usuario: { email: "demo@nexa.test" }, empresas: [{ empresa: { id: EMP, nombre_comercial: "Distribuidora Demo", razon_social: "Distribuidora Demo, S.A.", nit: "1111111-1", emision_real_habilitada: false }, rol: rolActual, permisos: permisos() }] };
    },
    async tiposIdentificacion() { return copia(TIPOS); },

    async listarClientes(_e, { buscar = "", inactivos = false } = {}) {
      exigir("clientes.ver"); await dormir();
      const q = buscar.trim().toLowerCase();
      return copia(clientes.filter((c) => (inactivos || c.activo) && (!q || `${c.nombre} ${c.numero_identificacion} ${c.email ?? ""}`.toLowerCase().includes(q))).sort((a, b) => a.nombre.localeCompare(b.nombre)));
    },
    async guardarCliente(_e, d) {
      exigir("clientes.escribir"); await dormir();
      const tipo = String(d.tipo_identificacion ?? "").toUpperCase();
      if (!TIPOS.some((t) => t.codigo === tipo)) throw new ErrorApi("Tipo de identificación no permitido.", "regla", 422);
      const num = tipo === "CF" ? "CF" : texto(d.numero_identificacion, "Número de identificación", 1, 30).toUpperCase();
      if (!/^[0-9A-Z-]+$/.test(num)) throw new ErrorApi("El número solo admite letras, números y guion.", "dato_invalido", 422);
      const nombre = texto(d.nombre, "Nombre", 1, 200);
      const email = opc(d.email);
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ErrorApi("El correo no es válido.", "entrada_invalida");
      if (tipo !== "CF" && clientes.some((c) => c.id !== d.id && c.tipo_identificacion === tipo && c.numero_identificacion === num)) throw new ErrorApi("Ya existe un cliente con esa identificación.", "duplicado", 409);
      const campos = { tipo_identificacion: tipo, numero_identificacion: num, nombre, direccion: opc(d.direccion), email, telefono: opc(d.telefono) };
      if (!d.id) { const c = { id: uuid(), empresa_id: EMP, activo: true, version: 1, ...campos }; clientes.push(c); return copia(c); }
      const c = buscarVersion(clientes, d.id, d.version, "Cliente"); Object.assign(c, campos, { version: c.version + 1 }); return copia(c);
    },
    async estadoCliente(_e, id, activo) { exigir("clientes.escribir"); await dormir(); const c = clientes.find((x) => x.id === id); c.activo = activo; c.version++; },

    async listarConceptos(_e, { buscar = "", inactivos = false } = {}) {
      exigir("conceptos.ver"); await dormir();
      const q = buscar.trim().toLowerCase();
      return copia(conceptos.filter((c) => (inactivos || c.activo) && (!q || `${c.codigo} ${c.descripcion}`.toLowerCase().includes(q))).sort((a, b) => a.codigo.localeCompare(b.codigo)));
    },
    async guardarConcepto(_e, d) {
      exigir("conceptos.escribir"); await dormir();
      const codigo = texto(d.codigo, "Código", 1, 40), descripcion = texto(d.descripcion, "Descripción", 1, 300);
      if (!["bien", "servicio"].includes(d.tipo)) throw new ErrorApi("El tipo debe ser bien o servicio.", "entrada_invalida");
      if (!/^\d{1,12}(\.\d{1,6})?$/.test(String(d.precio_unitario))) throw new ErrorApi("El precio debe ser un monto no negativo con hasta 6 decimales.", "entrada_invalida");
      if (conceptos.some((c) => c.id !== d.id && c.codigo === codigo)) throw new ErrorApi("Ya existe un concepto con ese código.", "duplicado", 409);
      const campos = { codigo, descripcion, tipo: d.tipo, unidad_medida: opc(d.unidad_medida) ?? "UND", precio_unitario: String(d.precio_unitario), categoria_fiscal: opc(d.categoria_fiscal) };
      if (!d.id) { const c = { id: uuid(), empresa_id: EMP, activo: true, version: 1, ...campos }; conceptos.push(c); return copia(c); }
      const c = buscarVersion(conceptos, d.id, d.version, "Concepto"); Object.assign(c, campos, { version: c.version + 1 }); return copia(c);
    },
    async estadoConcepto(_e, id, activo) { exigir("conceptos.escribir"); await dormir(); const c = conceptos.find((x) => x.id === id); c.activo = activo; c.version++; },

    async listarDocumentos() {
      exigir("borradores.ver"); await dormir();
      return copia(docs.map(({ lineas: _l, ...r }) => r).sort((a, b) => b.numero_borrador - a.numero_borrador));
    },
    async obtenerDocumento(_e, id) {
      exigir("borradores.ver"); await dormir();
      const d = docs.find((x) => x.id === id); if (!d) throw new ErrorApi("Documento no encontrado.", "no_encontrado", 404); return copia(d);
    },
    async guardarDocumento(_e, d) {
      exigir(d.id ? "borradores.editar" : "borradores.crear"); await dormir();
      let c;
      try { c = calcular(d.lineas.map((l) => ({ descuento_tipo: "ninguno", descuento_valor: "0", ...l }))); } catch (e) { throw new ErrorApi(e.message, "entrada_invalida"); }
      const cliente = d.cliente_id ? clientes.find((x) => x.id === d.cliente_id && x.activo) : null;
      if (d.cliente_id && !cliente) throw new ErrorApi("Cliente no encontrado o inactivo.", "no_encontrado", 404);
      const datos = {
        cliente_id: cliente?.id ?? null, cliente_snapshot: cliente ? { nombre: cliente.nombre, tipo_identificacion: cliente.tipo_identificacion, numero_identificacion: cliente.numero_identificacion } : null,
        fecha_emision_prevista: d.fecha_emision_prevista || null, observaciones: opc(d.observaciones), subtotal: c.subtotal, descuento_total: c.descuento_total, base_imponible: c.base_imponible,
        calculo: c.meta, actualizado_en: ahora(),
        lineas: d.lineas.map((l, i) => ({ orden: i + 1, concepto_id: l.concepto_id ?? null, descripcion: texto(l.descripcion, "Descripción de la línea", 1, 300), cantidad: l.cantidad, precio_unitario: l.precio_unitario,
          descuento_tipo: l.descuento_tipo ?? "ninguno", descuento_valor: l.descuento_valor ?? "0", importes: c.lineas[i] })),
      };
      let doc;
      if (!d.id) { doc = { id: uuid(), empresa_id: EMP, tipo_documento: "factura", estado_preparacion: "borrador", estado_fiscal: "ninguno", numero_borrador: siguiente++, impuestos: null, total: null, version: 1, serie: null, numero_fiscal: null, autorizacion_sat: null, ...datos }; docs.push(doc); }
      else {
        doc = buscarVersion(docs, d.id, d.version, "Documento");
        if (doc.estado_preparacion !== "borrador" || doc.estado_fiscal !== "ninguno") throw new ErrorApi("Solo se edita un borrador sin estado fiscal.", "regla", 422);
        Object.assign(doc, datos, { version: doc.version + 1 });
      }
      return copia(doc);
    },
    async cambiarPreparacion(_e, id, estado, motivo, version) {
      exigir({ revisado: "borradores.revisar", archivado: "borradores.archivar" }[estado] ?? "borradores.editar"); await dormir();
      const doc = buscarVersion(docs, id, version, "Documento");
      if (doc.estado_fiscal !== "ninguno") throw new ErrorApi("Un documento con vida fiscal no cambia su estado de preparación.", "regla", 422);
      if (estado === "revisado" && (!doc.cliente_id || !doc.lineas.length)) throw new ErrorApi("Para revisar hace falta cliente y al menos una línea.", "regla", 422);
      if (estado === "archivado" && String(motivo ?? "").trim().length < 5) throw new ErrorApi("El motivo es obligatorio (mínimo 5 caracteres).", "regla", 422);
      const ok = { borrador: ["revisado", "archivado"], revisado: ["borrador", "archivado"], archivado: ["borrador"] }[doc.estado_preparacion] ?? [];
      if (!ok.includes(estado)) throw new ErrorApi("Transición de preparación no permitida.", "regla", 422);
      doc.estado_preparacion = estado; doc.version++; doc.actualizado_en = ahora();
    },
  };
}
