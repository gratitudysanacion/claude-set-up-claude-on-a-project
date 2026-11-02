#!/usr/bin/env bash
# Actualización de producción de una v2 a otra v2 más nueva (código solamente).
# - No toca datos: ni data/, ni .env, ni usuarios.json. Solo sobrescribe archivos de código.
# - Respalda COMPLETA la versión actual antes de instalar, y ejecuta las pruebas del paquete antes de tocar producción.
# - Si la verificación posterior falla, se detiene y explica cómo volver (revertir-actualizacion.sh).
# - Nunca imprime el contenido de .env ni de usuarios.json.
# Uso (como root, desde la carpeta del paquete):  bash deploy/actualizar.sh
set -euo pipefail

APP="${APP:-/opt/yanbal-assistant}"
PAQUETE="$(cd "$(dirname "$0")/.." && pwd)"
RESPALDOS="${RESPALDOS:-/root/respaldos-manuales}"
PM2_NOMBRE="${PM2_NOMBRE:-yanbal-assistant}"
PUERTO="${PUERTO:-3080}"
ESPERADOS="${ESPERADOS:-437}"
HASH_ACTUAL="${HASH_ACTUAL:-21f6d9734dd8635c}"   # server.js en producción tras el 2 nov 2026 (Entrega 13). Cámbialo al instalar una versión nueva.
RESTART_CMD="${RESTART_CMD:-}"                    # solo para pruebas; en producción se usa PM2
FECHA="$(date +%Y%m%d-%H%M%S)"

paso() { echo; echo "[$1] $2"; }
abortar() { echo; echo "ABORTADO: $1"; echo "El código de producción no se modificó y el servicio sigue con la versión anterior."; exit 1; }

paso "1/8" "Verificando que producción tiene la versión esperada"
[ -d "$APP" ] || abortar "no existe $APP"
H="$(sha256sum "$APP/src/server.js" | cut -c1-16)"
[ "$H" = "$HASH_ACTUAL" ] || abortar "src/server.js ($H) no coincide con la versión esperada ($HASH_ACTUAL). Alguien la cambió o ya se actualizó."
for f in .env data/usuarios.json data/catalogo_lectura.json data/campana.json; do [ -f "$APP/$f" ] || abortar "falta $f en producción."; done
echo "  versión esperada confirmada; datos presentes."

paso "2/8" "Pruebas automáticas del paquete (antes de tocar producción)"
RESULTADO="$(cd "$PAQUETE" && npm test 2>&1 | grep -E '^# (tests|pass|fail)' | tr '\n' ' ')"
echo "  $RESULTADO"
echo "$RESULTADO" | grep -q '# fail 0' || abortar "hay pruebas fallidas."
for f in "$PAQUETE"/src/*.js "$PAQUETE"/scripts/*.js "$PAQUETE"/public/*.js; do node --check "$f" || abortar "error de sintaxis en $f"; done

paso "3/8" "Copia de respaldo completa de la versión actual"
mkdir -p "$RESPALDOS"
DEST="$RESPALDOS/asistente-v2-antes-$FECHA"
cp -a "$APP" "$DEST"
diff -r "$APP" "$DEST" > /dev/null || abortar "la copia de respaldo no coincide con el original."
(cd "$DEST" && find . -type f -print0 | sort -z | xargs -0 sha256sum > "$DEST.sha256")
echo "$DEST" > "$RESPALDOS/ULTIMO_RESPALDO_V2"
echo "  Respaldo: $DEST ($(find "$DEST" -type f | wc -l) archivos, huellas en $DEST.sha256)"

paso "4/8" "Instalando el código nuevo (sobrescribe archivos de código; no borra nada ni toca datos)"
mkdir -p "$APP/src" "$APP/public" "$APP/scripts" "$APP/test"
cp -p "$PAQUETE"/src/*.js "$APP/src/"
for f in index.html app.js styles.css usuarios.js; do [ -f "$PAQUETE/public/$f" ] && cp -p "$PAQUETE/public/$f" "$APP/public/"; done
cp -p "$PAQUETE"/scripts/*.js "$APP/scripts/"
cp -p "$PAQUETE"/test/*.js "$APP/test/"
cp -p "$PAQUETE/package.json" "$PAQUETE/.gitignore" "$APP/"
echo "  código instalado."

paso "5/8" "Reiniciando el asistente"
if [ -n "$RESTART_CMD" ]; then bash -c "$RESTART_CMD"; else pm2 restart "$PM2_NOMBRE"; fi
sleep 3

paso "6/8" "Verificando la salud del servicio"
SALUD="$(curl -s -m 8 "http://127.0.0.1:$PUERTO/health" || true)"
echo "  $SALUD"
if ! echo "$SALUD" | grep -q '"ai":"connected"' || ! echo "$SALUD" | grep -q "\"productos\":$ESPERADOS"; then
  echo; echo "FALLÓ LA VERIFICACIÓN. No se guardó la configuración de PM2."
  echo "Para volver a la versión anterior pide el script revertir-actualizacion.sh; el respaldo está en $DEST."
  exit 1
fi
for r in /app.js /usuarios.js; do
  CODIGO="$(curl -s -m 8 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PUERTO$r" || true)"
  [ "$CODIGO" = "200" ] || { echo "  $r respondió $CODIGO"; echo "FALLÓ LA VERIFICACIÓN del contenido estático."; exit 1; }
done
curl -s -m 8 "http://127.0.0.1:$PUERTO/api/sesion" | grep -q '"admin":false' || { echo "FALLÓ LA VERIFICACIÓN de /api/sesion."; exit 1; }

paso "7/8" "Guardando la configuración de PM2"
if [ -z "$RESTART_CMD" ]; then pm2 save; else echo "  (omitido en modo prueba)"; fi

paso "8/8" "Comprobando que los datos no cambiaron"
for f in .env data/usuarios.json data/catalogo_lectura.json data/campana.json; do
  cmp -s "$APP/$f" "$DEST/$f" || { echo "  AVISO: $f cambió durante la actualización (puede ser normal si alguien inició sesión: se actualiza el último acceso)."; }
done
echo "  comprobación terminada."

echo; echo "ACTUALIZACIÓN COMPLETADA."
echo "  Versión instalada: server.js $(sha256sum "$APP/src/server.js" | cut -c1-16)"
echo "  Respaldo de la versión anterior: $DEST"
