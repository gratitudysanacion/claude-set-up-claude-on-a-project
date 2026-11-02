#!/usr/bin/env bash
# Réplica local del layout de producción para probar desplegar.sh y revertir.sh. Datos ficticios.
set -uo pipefail
RAIZ="$(cd "$(dirname "$0")" && pwd)"
PAQ="${PAQ:-$RAIZ/asistente-v2}"
SB="$RAIZ/sandbox-despliegue"
rm -rf "$SB"; mkdir -p "$SB"
FALLOS=0
ok()  { echo "OK   $1"; }
mal() { echo "FALLA $1"; FALLOS=$((FALLOS+1)); }
chk() { if eval "$2"; then ok "$1"; else mal "$1"; fi; }

# --- Réplica de /opt/yanbal-assistant (v1 real) ---
APP="$SB/opt/yanbal-assistant"
mkdir -p "$APP/src/routes" "$APP/src/services" "$APP/public" "$APP/data" "$APP/logs"
cp "$RAIZ/asistente-original/server.js" "$APP/src/server.js"
cp "$RAIZ/asistente-original/server.js" "$APP/src/server.js.backup-20261019-221314"
cp "$RAIZ/asistente-original/index.html" "$APP/public/index.html"
cp "$RAIZ/asistente-original/index.html" "$APP/public/index.html.backup-20261019-221852"
printf 'LOGOFALSO' > "$APP/public/yanbal-logo.jpg"
cp "$RAIZ/asistente-original/package.json" "$APP/package.json"
: > "$APP/.gitignore"

# --- Panel falso y carpeta de pruebas ---
export PAQ SB
node -e '
const {productos}=require(process.env.PAQ+"/test/fixtures");
const fs=require("fs"); const {crearRegistroUsuario}=require(process.env.PAQ+"/src/auth");
fs.mkdirSync(process.env.SB+"/opt/panel",{recursive:true});
fs.writeFileSync(process.env.SB+"/opt/panel/catalogo.json",JSON.stringify({version:"t",moneda:"COP",productos,historial:[]}));
fs.mkdirSync(process.env.SB+"/pruebas/data",{recursive:true});
crearRegistroUsuario("clave-de-prueba-123").then(r=>{
  fs.writeFileSync(process.env.SB+"/pruebas/data/usuarios.json",JSON.stringify({usuarios:{isa:r}}),{mode:0o600});
  fs.writeFileSync(process.env.SB+"/pruebas/.env","ANTHROPIC_API_KEY=sk-ant-api03-FALSA-0000000000000000\nGESTOR_LLAVE=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n",{mode:0o600});
  console.log(productos.length);
});' > "$SB/n.txt"
N="$(cat "$SB/n.txt")"
cp -a "$SB/opt" "$SB/opt-original"          # instantánea para comparar

PUERTO=3099
export APP PUERTO
RESTART="[ -f '$SB/pid' ] && kill \$(cat '$SB/pid') 2>/dev/null; sleep 1; ( cd '$APP' && PORT=$PUERTO exec node src/server.js ) > '$SB/server.log' 2>&1 & echo \$! > '$SB/pid'"
STOP="[ -f '$SB/pid' ] && kill \$(cat '$SB/pid') 2>/dev/null; true"
eval "$RESTART"; sleep 1
V1="$(curl -s -m 5 http://127.0.0.1:$PUERTO/health)"
chk "la v1 de la réplica responde como la de producción" "echo '$V1' | grep -q '\"ai\":\"not_connected\"'"

run_deploy() { env APP="$APP" PRUEBAS="$SB/pruebas" RESPALDOS="$SB/respaldos" ORIGEN_CATALOGO="$SB/opt/panel/catalogo.json" ESPERADOS="${1:-$N}" PUERTO="$PUERTO" RESTART_CMD="$RESTART" bash "$PAQ/deploy/desplegar.sh" 2>&1; }
run_revert() { env APP="$APP" RESPALDOS="$SB/respaldos" PUERTO="$PUERTO" RESTART_CMD="$RESTART" STOP_CMD="$STOP" bash "$PAQ/deploy/revertir.sh" 2>&1; }

# --- Caso negativo 1: la v1 fue alterada -> aborta sin cambiar nada ---
echo "// alterado" >> "$APP/src/server.js"
OUT="$(run_deploy)"; COD=$?
chk "aborta si la versión actual no es la v1 conocida" "[ $COD -ne 0 ] && echo \"\$OUT\" | grep -q 'ABORTADO'"
chk "no creó respaldo ni tocó datos al abortar" "[ ! -d '$SB/respaldos' ] && [ ! -f '$APP/data/catalogo_lectura.json' ]"
cp "$RAIZ/asistente-original/server.js" "$APP/src/server.js"

# --- Caso negativo 2: catálogo con conteo distinto -> aborta antes de instalar el código ---
OUT="$(run_deploy 437)"; COD=$?
chk "aborta si la exportación no trae el número esperado de productos" "[ $COD -ne 0 ] && echo \"\$OUT\" | grep -q 'Se esperaban 437'"
chk "el código de producción sigue siendo el original tras ese aborto" "diff -q '$APP/src/server.js' '$RAIZ/asistente-original/server.js' >/dev/null && [ ! -f '$APP/src/ia.js' ] && [ ! -f '$APP/public/app.js' ]"
chk "y el servicio sigue respondiendo con la v1" "curl -s -m 5 http://127.0.0.1:$PUERTO/health | grep -q not_connected"

# --- Caso negativo 3: falta usuario y llave en pruebas ---
mv "$SB/pruebas/.env" "$SB/pruebas/.env.oculto"
OUT="$(run_deploy)"; COD=$?
chk "aborta si falta la llave de IA, sin instalar el código" "[ $COD -ne 0 ] && echo \"\$OUT\" | grep -q 'falta .env' && [ ! -f '$APP/src/ia.js' ]"
mv "$SB/pruebas/.env.oculto" "$SB/pruebas/.env"
rm -rf "$SB/respaldos" "$APP/data/catalogo_lectura.json"

# --- Caso positivo ---
OUT="$(run_deploy)"; COD=$?
echo "$OUT" | sed 's/^/    | /' | tail -45
chk "despliegue completado con código 0" "[ $COD -eq 0 ] && echo \"\$OUT\" | grep -q 'DESPLIEGUE COMPLETADO'"
SALUD="$(curl -s -m 5 http://127.0.0.1:$PUERTO/health)"
chk "salud: IA conectada y $N productos" "echo '$SALUD' | grep -q '\"ai\":\"connected\"' && echo '$SALUD' | grep -q '\"productos\":$N'"
chk "se sirve la interfaz nueva" "curl -s http://127.0.0.1:$PUERTO/ | grep -q 'styles.css' && [ \$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$PUERTO/app.js) = 200 ]"
chk "el login funciona con el usuario copiado" "[ \$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{\"usuario\":\"isa\",\"clave\":\"clave-de-prueba-123\"}' http://127.0.0.1:$PUERTO/api/login) = 200 ]"
chk "el respaldo de la v1 es idéntico a la instantánea original" "diff -r '$SB/opt-original/yanbal-assistant' \"\$(cat '$SB/respaldos/ULTIMO_RESPALDO_V1')\" >/dev/null"
chk "la llave del Gestor de pruebas NO viajó a producción, pero la de IA sí" "! grep -q GESTOR_ '$APP/.env' && grep -q '^ANTHROPIC_API_KEY=' '$APP/.env'"
chk "permisos 600 en .env, usuarios y catálogo" "[ \$(stat -c %a '$APP/.env') = 600 ] && [ \$(stat -c %a '$APP/data/usuarios.json') = 600 ] && [ \$(stat -c %a '$APP/data/catalogo_lectura.json') = 600 ]"
chk "la salida del despliegue no contiene la llave ni hashes de claves" "! echo \"\$OUT\" | grep -qE 'sk-ant|scrypt|FALSA'"
chk "se conservaron los archivos .backup y el logo antiguos" "[ -f '$APP/public/index.html.backup-20261019-221852' ] && [ -f '$APP/src/server.js.backup-20261019-221314' ] && [ -f '$APP/public/yanbal-logo.jpg' ]"
chk "no se borró nada del árbol original (todo lo anterior sigue existiendo)" "(cd '$SB/opt-original/yanbal-assistant' && find . -type f | sort) | while read f; do [ -e '$APP/'\"\$f\" ] || exit 1; done"
chk "el servidor nuevo no registra el texto de los mensajes" "! grep -q 'mensaje' '$SB/server.log'"

# --- Segundo despliegue: no debe repetirse sobre la v2 (la v1 ya no está) ---
OUT="$(run_deploy)"; COD=$?
chk "un segundo despliegue se rechaza porque ya no es la v1" "[ $COD -ne 0 ] && echo \"\$OUT\" | grep -q 'ABORTADO'"

# --- Reversión ---
OUT="$(run_revert)"; COD=$?
echo "$OUT" | sed 's/^/    | /'
chk "reversión completada con código 0" "[ $COD -eq 0 ] && echo \"\$OUT\" | grep -q 'REVERSIÓN COMPLETADA'"
chk "tras revertir, producción es idéntica a la instantánea original" "diff -r '$SB/opt-original/yanbal-assistant' '$APP' >/dev/null"
chk "tras revertir, el servicio responde como la v1" "curl -s -m 5 http://127.0.0.1:$PUERTO/health | grep -q not_connected"
chk "la versión fallida se conservó (no se borró)" "ls -d '$SB'/respaldos/asistente-v2-fallido-* >/dev/null 2>&1"

[ -f "$SB/pid" ] && kill "$(cat "$SB/pid")" 2>/dev/null
echo; if [ $FALLOS -eq 0 ]; then echo "TODO OK"; else echo "$FALLOS FALLO(S)"; fi
exit $FALLOS
