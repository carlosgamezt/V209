#!/usr/bin/env bash
# Instala PostgreSQL 17 (cliente y, si se pide, servidor) en un ejecutor Ubuntu/Debian desde el repositorio OFICIAL de PostgreSQL (PGDG) con la cadena de confianza VERIFICADA:
#   1. la clave de firma se descarga por HTTPS y se comprueba que su huella sea EXACTAMENTE la oficial (B97B 0AFC AA1A 47F0 44F2 44A0 7FCC 7D46 ACCC 4CF8) y que sea la única clave del archivo; si no, no se instala nada;
#   2. el repositorio se declara con «signed-by» solo con esa clave (apt verifica la firma de cada paquete);
#   3. la versión MAYOR queda fijada en 17 (el servidor hospedado de nexa-demo es 17: pg_dump no puede volcar un servidor más nuevo que él); la versión exacta instalada se imprime en el registro;
#   4. no se crea ni arranca ningún clúster al instalar (create_main_cluster = false);
#   5. al terminar se comprueba que existen las herramientas y que su versión mayor es 17.
# Uso: bash fel/tools/instalar-postgresql-17.sh instalar [true|false]      (true = también el servidor: initdb y pg_ctl)
#      bash fel/tools/instalar-postgresql-17.sh verificar-clave ARCHIVO     (solo comprueba la huella; lo usan las pruebas)
set -euo pipefail
HUELLA_PGDG="B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8"; MAYOR=17; URL_CLAVE="https://www.postgresql.org/media/keys/ACCC4CF8.asc"; BIN="/usr/lib/postgresql/$MAYOR/bin"

verificar_huella() {   # 0 solo si el archivo trae UNA sola clave primaria y su huella es EXACTAMENTE la oficial
  local f="$1" salida primarias huella
  salida="$(gpg --batch --show-keys --with-colons "$f" 2>/dev/null)" || return 1
  primarias="$(printf '%s\n' "$salida" | grep -c '^pub:' || true)"
  huella="$(printf '%s\n' "$salida" | awk -F: '$1=="pub"{p=1; next} p && $1=="fpr"{print $10; exit}')"
  [ "$primarias" = "1" ] && [ "$huella" = "$HUELLA_PGDG" ]
}
verificar_instalacion() {   # $1 = true|false (servidor)
  local h faltan="" v
  for h in psql pg_dump pg_restore; do [ -x "$BIN/$h" ] || faltan="$faltan $h"; done
  [ "$1" != "true" ] || for h in initdb pg_ctl; do [ -x "$BIN/$h" ] || faltan="$faltan $h"; done
  [ -z "$faltan" ] || { echo "Faltan herramientas en $BIN:$faltan"; return 1; }
  for h in psql pg_dump pg_restore; do v="$("$BIN/$h" --version | grep -oE '[0-9]+' | head -1)"; [ "$v" = "$MAYOR" ] || { echo "$h es de la versión $v, se esperaba $MAYOR"; return 1; }; done
  return 0
}
instalar() {
  local servidor="${1:-false}" pkgs
  [ "$servidor" = "true" ] || [ "$servidor" = "false" ] || { echo "Uso: instalar [true|false]"; exit 2; }
  if verificar_instalacion "$servidor" 2>/dev/null; then echo "PostgreSQL $MAYOR ya está instalado en $BIN: no se reinstala"; return 0; fi
  command -v gpg >/dev/null && command -v curl >/dev/null || { sudo apt-get update -qq && sudo apt-get install -y -qq --no-install-recommends gnupg curl ca-certificates >/dev/null; }
  . /etc/os-release; [ -n "${VERSION_CODENAME:-}" ] || { echo "No se pudo determinar la versión de la distribución"; exit 1; }
  TMP="$(mktemp -d)"; trap 'rm -rf -- "$TMP"' EXIT
  curl -fsSL --retry 3 --max-time 60 -o "$TMP/pgdg.asc" "$URL_CLAVE"
  verificar_huella "$TMP/pgdg.asc" || { echo "La clave descargada NO es la oficial de PostgreSQL (huella distinta o archivo con más de una clave). No se instala nada."; exit 1; }
  echo "Clave de PGDG verificada: huella oficial $HUELLA_PGDG"
  sudo install -d -m 0755 /usr/share/keyrings
  gpg --batch --yes --dearmor -o "$TMP/pgdg.gpg" "$TMP/pgdg.asc"; sudo install -m 0644 "$TMP/pgdg.gpg" /usr/share/keyrings/pgdg.gpg
  echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" | sudo tee /etc/apt/sources.list.d/pgdg.list >/dev/null
  sudo apt-get update -qq -o Dir::Etc::sourcelist="sources.list.d/pgdg.list" -o Dir::Etc::sourceparts="-" -o APT::Get::List-Cleanup="0"
  sudo apt-get install -y -qq --no-install-recommends postgresql-common >/dev/null
  sudo mkdir -p /etc/postgresql-common; echo "create_main_cluster = false" | sudo tee /etc/postgresql-common/createcluster.conf >/dev/null   # que al instalar no se cree ni arranque ningún clúster
  pkgs="postgresql-client-$MAYOR"; [ "$servidor" != "true" ] || pkgs="$pkgs postgresql-$MAYOR"
  sudo apt-get install -y -qq --no-install-recommends $pkgs >/dev/null
  verificar_instalacion "$servidor" || exit 1
  echo "Instalado: $(dpkg-query -W -f='${Package} ${Version}' "postgresql-client-$MAYOR") · $("$BIN/pg_dump" --version)"
}
[ "${BASH_SOURCE[0]}" = "$0" ] || return 0   # al hacer «source» (pruebas) solo se cargan las funciones
case "${1:-}" in
  instalar) instalar "${2:-false}";;
  verificar-clave) [ -f "${2:-}" ] || { echo "Falta el archivo de clave"; exit 2; }; verificar_huella "$2" && echo "huella oficial" || { echo "La clave NO es la oficial"; exit 1; };;
  *) echo "Uso: bash fel/tools/instalar-postgresql-17.sh instalar [true|false] | verificar-clave ARCHIVO"; exit 2;;
esac
