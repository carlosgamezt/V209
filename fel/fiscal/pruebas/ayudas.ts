// Ayudas de prueba: DTE de ejemplo sintético (sin datos reales) y utilidades.
import { cargarRecursos, type Recursos } from "../src/recursos.ts";
import type { Dte } from "../src/modelo.ts";
export const TOL = "0.01"; // tolerancia de PRUEBA, elegida aquí; el motor no tiene valor predeterminado
export const rec: Recursos = await cargarRecursos();
export const clon = <T>(x: T): T => structuredClone(x);
/** FACT con un ítem con IVA 12 %: 112 = 100 + 12 (cifras exactas). Datos inventados. */
export function dteBase(): Dte {
  return {
    DatosGenerales: { Tipo: "FACT", FechaHoraEmision: "2026-11-12T10:00:00-06:00", CodigoMoneda: "GTQ" },
    Emisor: { NITEmisor: "1234567", NombreEmisor: "EMISOR DE PRUEBA, S.A.", CodigoEstablecimiento: 1, NombreComercial: "PRUEBA", AfiliacionIVA: "GEN", DireccionEmisor: { Direccion: "Ciudad", CodigoPostal: 1001, Municipio: "GUATEMALA", Departamento: "GUATEMALA", Pais: "GT" } },
    Receptor: { IDReceptor: "CF", NombreReceptor: "Consumidor final" },
    Frases: [{ TipoFrase: 1, CodigoEscenario: 1 }],
    Items: [{ NumeroLinea: 1, BienOServicio: "B", Cantidad: "1", Descripcion: "Artículo de prueba", PrecioUnitario: "112", Precio: "112", Descuento: "0",
      Impuestos: [{ NombreCorto: "IVA", CodigoUnidadGravable: 1, MontoGravable: "100", MontoImpuesto: "12" }], Total: "112" }],
    Totales: { TotalImpuestos: [{ NombreCorto: "IVA", TotalMontoImpuesto: "12" }], GranTotal: "112" },
  };
}
