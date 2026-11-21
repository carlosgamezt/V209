// Puerto LIBRE asignado por el sistema operativo para los servidores que lanzan los e2e. Un número al azar dentro de un rango (los rangos de varias pruebas se solapaban) podía repetirse
// y el servidor terminaba con «Address already in use». Los servidores de una misma prueba se arrancan uno tras otro, así que el anterior ya escucha cuando se pide el siguiente.
const net = require("net");
exports.puertoLibre = () => new Promise((ok, mal) => {
  const sv = net.createServer(); sv.on("error", mal);
  sv.listen(0, "127.0.0.1", () => { const p = sv.address().port; sv.close(() => ok(p)); });
});
