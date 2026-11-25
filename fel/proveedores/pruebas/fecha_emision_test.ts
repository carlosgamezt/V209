// Fecha de emisión: regla única (proveedores/src/fecha_emision.ts). Sin red ni base de datos; todos los instantes se fijan a mano (nunca el reloj real).
import assert from "node:assert/strict";
import { diasEntre, FECHA_EMISION_MAX_DIAS, fechaHoraEmisionGt, fechaReal, horaGt, hoyGt, sumarDias, validarFechaEmision, ventanaEmision } from "../src/fecha_emision.ts";

/** Un instante a partir de una hora LOCAL de Guatemala (UTC-6 todo el año). */
const gt = (fechaHora: string) => new Date(`${fechaHora}-06:00`);
const AHORA = gt("2026-11-25T10:30:00");   // miércoles 25/11/2026, 10:30 en Guatemala

Deno.test("el plazo es de cinco días calendario (constante única)", () => {
  assert.equal(FECHA_EMISION_MAX_DIAS, 5);
  assert.deepEqual(ventanaEmision(AHORA), { hoy: "2026-11-25", minima: "2026-11-20", maxDias: 5 });
});

Deno.test("hoy, 1, 2, 3, 4 y 5 días atrás se aceptan; 6 días atrás y un día futuro se rechazan", () => {
  for (let n = 0; n <= 5; n++) {
    const f = sumarDias("2026-11-25", -n), r = validarFechaEmision(f, AHORA);
    assert.equal(r.ok, true, `${n} días atrás debe aceptarse`);
    if (r.ok) { assert.equal(r.fecha, f); assert.equal(r.diasAtras, n); }
  }
  const seis = validarFechaEmision("2026-11-19", AHORA);
  assert.equal(seis.ok, false); if (!seis.ok) { assert.equal(seis.codigo, "antigua"); assert.match(seis.mensaje, /no puede ser anterior al 20\/11\/2026/); assert.match(seis.mensaje, /5 días/); }
  const futura = validarFechaEmision("2026-11-26", AHORA);
  assert.equal(futura.ok, false); if (!futura.ok) { assert.equal(futura.codigo, "futura"); assert.match(futura.mensaje, /no puede ser futura/); }
});

Deno.test("formato inválido, fecha inexistente y tipos que no son texto se rechazan sin adivinar", () => {
  for (const x of ["", "25/11/2026", "2026-11-5", "2026-11-25T10:00:00", " 2026-11-25", null, undefined, 20261125, {}]) {
    const r = validarFechaEmision(x, AHORA); assert.equal(r.ok, false, String(x)); if (!r.ok) assert.equal(r.codigo, "formato");
  }
  for (const x of ["2026-02-30", "2026-13-01", "2026-00-10", "2027-02-29", "2026-11-31"]) {
    const r = validarFechaEmision(x, AHORA); assert.equal(r.ok, false, x); if (!r.ok) assert.equal(r.codigo, "inexistente");
  }
  assert.equal(fechaReal("2028-02-29"), true); assert.equal(fechaReal("2100-02-29"), false);
});

Deno.test("cambio de mes: el 2 de diciembre se admite desde el 27 de noviembre, y se avisa que es de un mes anterior", () => {
  const ahora = gt("2026-12-02T12:00:00");
  assert.equal(ventanaEmision(ahora).minima, "2026-11-27");
  const ok = validarFechaEmision("2026-11-30", ahora); assert.equal(ok.ok, true); if (ok.ok) { assert.equal(ok.mesAnterior, true); assert.equal(ok.diasAtras, 2); }
  const mismo = validarFechaEmision("2026-12-01", ahora); assert.equal(mismo.ok, true); if (mismo.ok) assert.equal(mismo.mesAnterior, false);
  assert.equal(validarFechaEmision("2026-11-27", ahora).ok, true);
  assert.equal(validarFechaEmision("2026-11-26", ahora).ok, false);
});

Deno.test("cambio de año y año bisiesto", () => {
  const ene = gt("2027-01-03T09:00:00");
  assert.equal(ventanaEmision(ene).minima, "2026-12-29");
  assert.equal(validarFechaEmision("2026-12-31", ene).ok, true); assert.equal(validarFechaEmision("2026-12-29", ene).ok, true); assert.equal(validarFechaEmision("2026-12-28", ene).ok, false);
  const mar = gt("2028-03-02T09:00:00");   // 2028 es bisiesto: el 29 de febrero existe
  assert.equal(ventanaEmision(mar).minima, "2028-02-26"); assert.equal(validarFechaEmision("2028-02-29", mar).ok, true); assert.equal(sumarDias("2028-03-01", -1), "2028-02-29");
  assert.equal(diasEntre("2026-12-31", "2027-01-02"), 2);
});

Deno.test("zona horaria: entre las 18:00 y las 23:59 de Guatemala UTC ya marca el día siguiente, pero «hoy» NO cambia", () => {
  for (const h of ["18:00:00", "20:15:30", "23:59:59"]) {
    const ahora = gt(`2026-11-24T${h}`);
    assert.equal(ahora.toISOString().slice(0, 10), "2026-11-25", `UTC ya es el 25 a las ${h} de Guatemala`);   // lo que haría new Date().toISOString().slice(0, 10)
    assert.equal(hoyGt(ahora), "2026-11-24", `en Guatemala sigue siendo el 24 a las ${h}`);
    assert.equal(horaGt(ahora), h);
    assert.equal(validarFechaEmision("2026-11-24", ahora).ok, true);
    const manana = validarFechaEmision("2026-11-25", ahora); assert.equal(manana.ok, false); if (!manana.ok) assert.equal(manana.codigo, "futura");   // con UTC se habría aceptado un día futuro
  }
  assert.equal(hoyGt(gt("2026-11-25T00:00:00")), "2026-11-25"); assert.equal(hoyGt(gt("2026-11-24T23:59:59")), "2026-11-24"); assert.equal(horaGt(gt("2026-11-25T00:00:00")), "00:00:00");
});

Deno.test("cambio de día con un borrador abierto: lo que era «hoy» pasa a «ayer» y sigue valiendo; una fecha de hace 5 días vence al día siguiente y NO se cambia sola", () => {
  const noche = gt("2026-11-24T23:50:00"), pasada = gt("2026-11-25T00:10:00");
  const f = hoyGt(noche); assert.equal(f, "2026-11-24");
  const despues = validarFechaEmision(f, pasada); assert.equal(despues.ok, true); if (despues.ok) assert.equal(despues.diasAtras, 1);
  const limite = sumarDias(hoyGt(noche), -5);   // 2026-11-19: el último día válido a las 23:50
  assert.equal(validarFechaEmision(limite, noche).ok, true);
  const vencida = validarFechaEmision(limite, pasada); assert.equal(vencida.ok, false); if (!vencida.ok) assert.equal(vencida.codigo, "antigua");
});

Deno.test("Header.IssuedDateTime: la fecha ELEGIDA con la hora local de Guatemala y el desfase -06:00 (nunca la fecha de UTC)", () => {
  const ahora = gt("2026-11-24T22:30:00");   // en UTC ya es 2026-11-25T04:30:00Z
  assert.equal(fechaHoraEmisionGt("2026-11-24", ahora), "2026-11-24T22:30:00-06:00");
  assert.equal(fechaHoraEmisionGt("2026-11-21", ahora), "2026-11-21T22:30:00-06:00");
  for (const f of ["2026-11-25", "2026-11-22", "2026-11-20"]) assert.match(fechaHoraEmisionGt(f, AHORA), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-06:00$/);
  assert.equal(fechaHoraEmisionGt("2026-11-25", AHORA).slice(0, 10), "2026-11-25");
});
