#!/usr/bin/env bash
# ==== HISTÓRICO — NO REUTILIZAR ====
# Migración v1→v2 de oct 2026. Tiene valores fijos que ya no son ciertos (437 productos, huellas de la v1, lista fija de public/).
# Para actualizar producción use deploy/actualizar.sh; para revertir, deploy/revertir-actualizacion.sh.
[ "${FORZAR_HISTORICO:-}" = "si" ] || { echo "Script histórico: use deploy/actualizar.sh"; exit 2; }
# Reversión: vuelve a la versión anterior (v1) respaldada por desplegar.sh.
# No borra nada: la versión fallida se MUEVE a una carpeta aparte para poder analizarla.
set -euo pipefail

APP="${APP:-/opt/yanbal-assistant}"
RESPALDOS="${RESPALDOS:-/root/respaldos-manuales}"
PM2_NOMBRE="${PM2_NOMBRE:-yanbal-assistant}"
PUERTO="${PUERTO:-3080}"
RESTART_CMD="${RESTART_CMD:-}"
STOP_CMD="${STOP_CMD:-}"
FECHA="$(date +%Y%m%d-%H%M%S)"

DEST="$(cat "$RESPALDOS/ULTIMO_RESPALDO_V1" 2>/dev/null || true)"
[ -n "$DEST" ] && [ -d "$DEST" ] || { echo "ABORTADO: no encuentro el respaldo de la v1 ($RESPALDOS/ULTIMO_RESPALDO_V1)."; exit 1; }
[ -f "$DEST/src/server.js" ] || { echo "ABORTADO: el respaldo $DEST no parece completo."; exit 1; }

echo "[1/4] Deteniendo el asistente"
if [ -n "$STOP_CMD" ]; then bash -c "$STOP_CMD"; else pm2 stop "$PM2_NOMBRE"; fi

echo "[2/4] Moviendo la versión fallida a un lado (no se borra)"
FALLIDO="$RESPALDOS/asistente-v2-fallido-$FECHA"
mv "$APP" "$FALLIDO"

echo "[3/4] Restaurando la v1 desde $DEST"
cp -a "$DEST" "$APP"

echo "[4/4] Reiniciando"
if [ -n "$RESTART_CMD" ]; then bash -c "$RESTART_CMD"; else pm2 restart "$PM2_NOMBRE"; fi
sleep 3
echo "  $(curl -s -m 8 "http://127.0.0.1:$PUERTO/health" || true)"
echo; echo "REVERSIÓN COMPLETADA. La versión fallida quedó en $FALLIDO."
