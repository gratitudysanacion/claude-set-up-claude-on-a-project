#!/usr/bin/env bash
# Réplica local de producción (la v2 desplegada el 2 nov) para ensayar actualizar.sh y revertir-actualizacion.sh. Datos ficticios.
set -uo pipefail
RAIZ="$(cd "$(dirname "$0")" && pwd)"
ANTES="$RAIZ/paquete-final"      # v2 desplegada ayer
NUEVO="${NUEVO:-$RAIZ/paquete-13}"
SB="$RAIZ/sandbox-actualizacion"
rm -rf "$SB"; mkdir -p "$SB/opt/yanbal-assistant/data" "$SB/respaldos"
APP="$SB/opt/yanbal-assistant"
FALLOS=0
ok()  { echo "OK   $1"; }
mal() { echo "FALLA $1"; FALLOS=$((FALLOS+1)); }
chk() { if eval "$2"; then ok "$1"; else mal "$1"; fi; }

# --- producción = v2 de ayer ---
for d in src public scripts test; do cp -a "$ANTES/$d" "$APP/$d"; done
cp "$ANTES/package.json" "$ANTES/.gitignore" "$APP/"
cp "$ANTES/data/campana.json" "$APP/data/"
export ANTES SB APP
node -e '
const {productos}=require(process.env.ANTES+"/test/fixtures"); const fs=require("fs");
const {crearRegistroUsuario}=require(process.env.ANTES+"/src/auth");
fs.writeFileSync(process.env.APP+"/data/catalogo_lectura.json",JSON.stringify({productos:productos.map(p=>({id:p.id,nombre:p.nombre,referencia:p.referencia,categoria:p.categoria,presentacion:p.presentacion,precio_normal:p.precio_normal,precio_oferta:p.precio_oferta,promocion:p.promocion,vigencia_desde:"",vigencia_hasta:"",pagina_origen:p.pagina_origen,estado:p.estado}))}),{mode:0o600});
crearRegistroUsuario("clave-de-prueba-123").then(r=>{
  fs.writeFileSync(process.env.APP+"/data/usuarios.json",JSON.stringify({usuarios:{isa:{...r,modulos:["sales","content"],rol:"admin"}}}),{mode:0o600});
  fs.writeFileSync(process.env.APP+"/.env","ANTHROPIC_API_KEY=sk-ant-api03-FALSA-0000000000000000\n",{mode:0o600});
  console.log(productos.length);
});' > "$SB/n.txt"
N="$(cat "$SB/n.txt")"
cp -a "$SB/opt" "$SB/opt-original"
HASH="$(sha256sum "$APP/src/server.js" | cut -c1-16)"

PUERTO=3098
RESTART="[ -f '$SB/pid' ] && kill \$(cat '$SB/pid') 2>/dev/null; sleep 1; ( cd '$APP' && PORT=$PUERTO exec node src/server.js ) > '$SB/server.log' 2>&1 & echo \$! > '$SB/pid'"
STOP="[ -f '$SB/pid' ] && kill \$(cat '$SB/pid') 2>/dev/null; true"
eval "$RESTART"; sleep 1.5
chk "la réplica de ayer responde con la IA conectada" "curl -s -m 5 http://127.0.0.1:$PUERTO/health | grep -q '\"ai\":\"connected\"'"
chk "la réplica de ayer NO tiene la pantalla de usuarios" "[ \$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$PUERTO/usuarios.js) = 404 ]"

run_act() { env APP="$APP" RESPALDOS="$SB/respaldos" PUERTO="$PUERTO" ESPERADOS="${2:-$N}" HASH_ACTUAL="${1:-$HASH}" RESTART_CMD="$RESTART" bash "$NUEVO/deploy/actualizar.sh" 2>&1; }
run_rev() { env APP="$APP" RESPALDOS="$SB/respaldos" PUERTO="$PUERTO" RESTART_CMD="$RESTART" STOP_CMD="$STOP" bash "$NUEVO/deploy/revertir-actualizacion.sh" 2>&1; }

# --- negativos ---
OUT="$(run_act deadbeefdeadbeef)"; COD=$?
chk "aborta si producción no tiene la versión esperada" "[ $COD -ne 0 ] && echo \"\$OUT\" | grep -q 'ABORTADO' && [ ! -d '$SB/respaldos/ULTIMO_RESPALDO_V2' ]"
chk "no tocó nada al abortar" "diff -r '$SB/opt-original' '$SB/opt' >/dev/null && [ ! -e '$APP/public/usuarios.js' ]"
mv "$APP/.env" "$APP/.env.oculto"
OUT="$(run_act)"; COD=$?
chk "aborta si falta un archivo de datos (.env)" "[ $COD -ne 0 ] && echo \"\$OUT\" | grep -q 'falta .env' && [ ! -e '$APP/public/usuarios.js' ]"
mv "$APP/.env.oculto" "$APP/.env"
OUT="$(run_act '' 437)"; COD=$?
chk "si tras reiniciar no hay 437 productos, avisa que falló y NO guarda PM2" "[ $COD -ne 0 ] && echo \"\$OUT\" | grep -q 'FALLÓ LA VERIFICACIÓN' && echo \"\$OUT\" | grep -q 'revertir-actualizacion.sh'"
echo "--- revierto el intento fallido para seguir con el caso positivo"
run_rev > /dev/null
rm -rf "$SB/respaldos"; mkdir "$SB/respaldos"; cp -a "$SB/opt-original/yanbal-assistant/." "$APP/" ; eval "$RESTART"; sleep 1.5

# --- positivo ---
OUT="$(run_act)"; COD=$?
echo "$OUT" | sed 's/^/    | /' | tail -32
chk "actualización completada con código 0" "[ $COD -eq 0 ] && echo \"\$OUT\" | grep -q 'ACTUALIZACIÓN COMPLETADA'"
chk "ahora sí se sirve la pantalla de usuarios y /api/sesion informa admin" "[ \$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$PUERTO/usuarios.js) = 200 ] && curl -s http://127.0.0.1:$PUERTO/api/sesion | grep -q '\"admin\":false'"
chk "el usuario existente sigue entrando con su clave" "[ \$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{\"usuario\":\"isa\",\"clave\":\"clave-de-prueba-123\"}' http://127.0.0.1:$PUERTO/api/login) = 200 ]"
chk "el respaldo de la versión anterior es idéntico a la instantánea original" "diff -r '$SB/opt-original/yanbal-assistant' \"\$(cat '$SB/respaldos/ULTIMO_RESPALDO_V2')\" >/dev/null"
chk ".env, catálogo y campaña no cambiaron (ni su contenido ni sus permisos)" "cmp -s '$APP/.env' '$SB/opt-original/yanbal-assistant/.env' && cmp -s '$APP/data/catalogo_lectura.json' '$SB/opt-original/yanbal-assistant/data/catalogo_lectura.json' && cmp -s '$APP/data/campana.json' '$SB/opt-original/yanbal-assistant/data/campana.json' && [ \$(stat -c %a '$APP/.env') = 600 ]"
chk "usuarios.json conserva a sus usuarios y mantiene permisos 600" "grep -q '\"isa\"' '$APP/data/usuarios.json' && [ \$(stat -c %a '$APP/data/usuarios.json') = 600 ]"
chk "la salida no contiene la llave ni hashes de claves" "! echo \"\$OUT\" | grep -qE 'sk-ant|scrypt|FALSA'"
chk "no se borró nada del árbol anterior" "(cd '$SB/opt-original/yanbal-assistant' && find . -type f | sort) | while read f; do [ -e '$APP/'\"\$f\" ] || exit 1; done"

OUT="$(run_act)"; COD=$?
chk "una segunda actualización se rechaza (ya no es la versión de ayer)" "[ $COD -ne 0 ] && echo \"\$OUT\" | grep -q 'ABORTADO'"

# --- reversión ---
OUT="$(run_rev)"; COD=$?
echo "$OUT" | sed 's/^/    | /'
chk "reversión completada con código 0" "[ $COD -eq 0 ] && echo \"\$OUT\" | grep -q 'REVERSIÓN COMPLETADA'"
chk "tras revertir, producción vuelve a ser idéntica a la de ayer" "diff -r '$SB/opt-original/yanbal-assistant' '$APP' >/dev/null"
chk "tras revertir, ya no hay pantalla de usuarios y el servicio responde" "[ \$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$PUERTO/usuarios.js) = 404 ] && curl -s http://127.0.0.1:$PUERTO/health | grep -q '\"ai\":\"connected\"'"
chk "la versión fallida se conservó (no se borró)" "ls -d '$SB'/respaldos/asistente-v2-fallido-* >/dev/null 2>&1"

[ -f "$SB/pid" ] && kill "$(cat "$SB/pid")" 2>/dev/null
echo; if [ $FALLOS -eq 0 ]; then echo "TODO OK"; else echo "$FALLOS FALLO(S)"; fi
exit $FALLOS
