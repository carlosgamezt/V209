// Datos de PRUEBA (TEST) para las pruebas del cliente de Digifact Guatemala. NO son reglas fiscales de NEXA ni datos de ninguna empresa real:
//  · NIT/establecimiento/frase: los que Digifact entregó para TEST (NIT 5888492, afiliación GEN, establecimiento 2, frase tipo 1 escenario 2).
//  · La dirección del establecimiento es la del EJEMPLO oficial de la documentación; la real del establecimiento 2 está pendiente de confirmar.
//  · Los montos de IVA están desglosados a mano para un total de Q100.00 (89.285714 + 10.714286 = 100.000000): sirven solo para que el NUC sea coherente. NEXA no calcula IVA.
import type { FacturaGt } from "../src/nuc_gt.ts";

export const REF_PRUEBA = "6f1c2f6e-3b7a-4c52-9d0e-0a1b2c3d4e5f";
export function facturaPrueba(extra: Partial<FacturaGt> = {}): FacturaGt {
  return {
    tipoDoc: "FACT", fechaEmision: "2026-11-14T10:30:00-06:00", moneda: "GTQ", referenciaInterna: REF_PRUEBA,
    emisor: {
      nit: "5888492", nombre: "EMISOR DE PRUEBA NEXA FEL", afiliacionIva: "GEN", frases: [{ tipo: 1, escenario: 2 }],
      establecimiento: { codigo: 2, nombre: "ESTABLECIMIENTO DE PRUEBA", direccion: { direccion: "4 AVENIDA 15-70 ZONA 10 LOCAL 3 EDIFICIO PALADIUM", codigoPostal: "01010", municipio: "Guatemala", departamento: "Guatemala", pais: "GT" } },
    },
    receptor: { tipoId: "CF", id: "CF", nombre: "CONSUMIDOR FINAL", direccion: { direccion: "CIUDAD", codigoPostal: "01010", municipio: "GUATEMALA", departamento: "GUATEMALA", pais: "GT" } },
    items: [{
      tipo: "Servicio", descripcion: "Servicio de prueba NEXA FEL", cantidad: "1", unidad: "SER", precioUnitario: "100", descuento: "0",
      impuestos: [{ codigoUnidadGravable: 1, nombre: "IVA", gravable: "89.285714", monto: "10.714286" }], totalItem: "100",
    }],
    ...extra,
  };
}
