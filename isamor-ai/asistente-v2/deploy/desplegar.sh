#!/usr/bin/env bash
# ==== HISTÓRICO — NO REUTILIZAR ====
# Migración v1→v2 de oct 2026. Tiene valores fijos que ya no son ciertos (437 productos, huellas de la v1, lista fija de public/).
# Para actualizar producción use deploy/actualizar.sh; para revertir, deploy/revertir-actualizacion.sh.
[ "${FORZAR_HISTORICO:-}" = "si" ] || { echo "Script histórico: use deploy/actualizar.sh"; exit 2; }
# Despliegue del Asistente comercial v2 sobre el asistente actual (v1).
# - No borra nada: solo copia y sobrescribe archivos de código. La versión anterior queda respaldada.
# - Ejecuta las pruebas ANTES de tocar producción y verifica la salud DESPUÉS de reiniciar.
# - Los datos (catálogo, usuario, llave) se preparan ANTES de instalar el código: si algo falla, el código viejo sigue intacto.
# - Nunca imprime el contenido de .env ni de usuarios.json.
# Uso (como root, desde la carpeta del paquete):  bash deploy/desplegar.sh
set -euo pipefail

APP="${APP:-/opt/yanbal-assistant}"
PAQUETE="$(cd "$(dirname "$0")/.." && pwd)"
RESPALDOS="${RESPALDOS:-/root/respaldos-manuales}"
PRUEBAS="${PRUEBAS:-/root/asistente-v2-pruebas/v3}"
PM2_NOMBRE="${PM2_NOMBRE:-yanbal-assistant}"
PUERTO="${PUERTO:-3080}"
ESPERADOS="${ESPERADOS:-437}"
ORIGEN="${ORIGEN_CATALOGO:-/opt/yanbal-admin-starter/yanbal-admin-starter/data/catalogo.json}"
RESTART_CMD="${RESTART_CMD:-}"        # solo para pruebas; en producción se usa PM2
FECHA="$(date +%Y%m%d-%H%M%S)"
HASH_SERVER_V1="765f5dfee7040030"
HASH_INDEX_V1="e60c694a7f9c817b"

paso() { echo; echo "[$1] $2"; }
abortar() { echo; echo "ABORTADO: $1"; echo "El código de producción no se modificó y el servicio sigue con la versión anterior."; exit 1; }

paso "1/9" "Verificando que el asistente actual es la versión conocida (v1)"
[ -d "$APP" ] || abortar "no existe $APP"
H1="$(sha256sum "$APP/src/server.js" | cut -c1-16)"
H2="$(sha256sum "$APP/public/index.html" | cut -c1-16)"
[ "$H1" = "$HASH_SERVER_V1" ] && [ "$H2" = "$HASH_INDEX_V1" ] || abortar "src/server.js o public/index.html no coinciden con la v1 conocida (server $H1, index $H2)."
echo "  v1 confirmada."

paso "2/9" "Pruebas automáticas del paquete (antes de tocar producción)"
RESULTADO="$(cd "$PAQUETE" && npm test 2>&1 | grep -E '^# (tests|pass|fail)' | tr '\n' ' ')"
echo "  $RESULTADO"
echo "$RESULTADO" | grep -q '# fail 0' || abortar "hay pruebas fallidas."
for f in "$PAQUETE"/src/*.js "$PAQUETE"/scripts/*.js "$PAQUETE"/public/app.js; do node --check "$f" || abortar "error de sintaxis en $f"; done

paso "3/9" "Copia de respaldo completa de la versión actual"
mkdir -p "$RESPALDOS"
DEST="$RESPALDOS/asistente-v1-$FECHA"
cp -a "$APP" "$DEST"
diff -r "$APP" "$DEST" > /dev/null || abortar "la copia de respaldo no coincide con el original."
(cd "$DEST" && find . -type f -print0 | sort -z | xargs -0 sha256sum > "$DEST.sha256")
echo "$DEST" > "$RESPALDOS/ULTIMO_RESPALDO_V1"
echo "  Respaldo: $DEST ($(find "$DEST" -type f | wc -l) archivos, huellas en $DEST.sha256)"

paso "4/9" "Exportando el catálogo de lectura desde el panel (solo lectura)"
mkdir -p "$APP/data"
node "$PAQUETE/scripts/exportar-lectura.js" --origen "$ORIGEN" --destino "$APP/data/catalogo_lectura.json" --esperados "$ESPERADOS" || abortar "la exportación falló."

paso "5/9" "Usuario y llave de IA (se copian desde pruebas solo si no existen; nunca se imprimen)"
for f in data/usuarios.json .env; do   # primero se valida todo; solo después se copia
  [ -f "$APP/$f" ] || [ -f "$PRUEBAS/$f" ] || abortar "falta $f y no existe en $PRUEBAS."
done
for f in data/usuarios.json .env; do
  if [ -f "$APP/$f" ]; then
    echo "  $f ya existe en producción: se conserva."
  elif [ "$f" = ".env" ]; then
    # La llave de cifrado del Gestor (GESTOR_*) es de PRUEBAS y nunca viaja a producción: producción tendrá la suya propia.
    ( umask 077; grep -v '^GESTOR_' "$PRUEBAS/.env" > "$APP/.env" )
    chmod 600 "$APP/.env"
    grep -q '^ANTHROPIC_API_KEY=.' "$APP/.env" || abortar "el .env de pruebas no trae ANTHROPIC_API_KEY."
    echo "  .env copiado desde pruebas SIN variables GESTOR_* (permisos $(stat -c %a "$APP/.env"))."
  else
    cp -p "$PRUEBAS/$f" "$APP/$f"; chmod 600 "$APP/$f"
    echo "  $f copiado desde pruebas (permisos $(stat -c %a "$APP/$f"))."
  fi
done

paso "6/9" "Instalando el código nuevo (sobrescribe archivos; no borra nada)"
mkdir -p "$APP/src" "$APP/public" "$APP/scripts" "$APP/test"
cp -p "$PAQUETE"/src/*.js "$APP/src/"
cp -p "$PAQUETE/public/index.html" "$PAQUETE/public/app.js" "$PAQUETE/public/styles.css" "$APP/public/"
cp -p "$PAQUETE"/scripts/*.js "$APP/scripts/"
cp -p "$PAQUETE"/test/*.js "$APP/test/"
cp -p "$PAQUETE/package.json" "$PAQUETE/.gitignore" "$APP/"
if [ -f "$APP/data/campana.json" ]; then echo "  data/campana.json ya existe: se conserva."; else cp -p "$PAQUETE/data/campana.json" "$APP/data/campana.json"; echo "  data/campana.json instalado."; fi

paso "7/9" "Reiniciando el asistente"
if [ -n "$RESTART_CMD" ]; then bash -c "$RESTART_CMD"; else pm2 restart "$PM2_NOMBRE"; fi
sleep 3

paso "8/9" "Verificando la salud del servicio"
SALUD="$(curl -s -m 8 "http://127.0.0.1:$PUERTO/health" || true)"
echo "  $SALUD"
if ! echo "$SALUD" | grep -q '"ai":"connected"' || ! echo "$SALUD" | grep -q "\"productos\":$ESPERADOS"; then
  echo; echo "FALLÓ LA VERIFICACIÓN. No se guardó la configuración de PM2."
  echo "Para volver a la versión anterior pide el script de reversión (revertir.sh); el respaldo está en $DEST."
  exit 1
fi
CODIGO="$(curl -s -m 8 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PUERTO/app.js" || true)"
[ "$CODIGO" = "200" ] || { echo "  /app.js respondió $CODIGO"; echo "FALLÓ LA VERIFICACIÓN del contenido estático."; exit 1; }

paso "9/9" "Guardando la configuración de PM2"
if [ -z "$RESTART_CMD" ]; then pm2 save; else echo "  (omitido en modo prueba)"; fi

echo; echo "DESPLIEGUE COMPLETADO."
echo "  Versión instalada: server.js $(sha256sum "$APP/src/server.js" | cut -c1-16)"
echo "  Respaldo de la v1: $DEST"
