# ISAMOR AI – Guía de despliegue, actualización y servidor de pruebas
## Versión 1 · 2 de noviembre de 2026 · Probada en el despliegue y la actualización del 2 nov

> Procedimientos repetibles. No contiene claves ni valores de variables de entorno. Cada cambio en el servidor requiere la frase de autorización de la usuaria (regla 14) y los comandos de reversión se entregan en un mensaje aparte (regla 8).

## 1. Dos entornos en el mismo servidor

| | Pruebas | Producción |
|---|---|---|
| Carpeta | `/root/asistente-v2-pruebas/v3` | `/opt/yanbal-assistant` |
| Puerto | 3082, solo `127.0.0.1` (se accede con túnel SSH) | 3080, tras Nginx (`yanbal.gratitudysanacion.com`) |
| Proceso | `nohup`/`setsid` manual | PM2 `yanbal-assistant` |
| Node | 22 (`/opt/node22/bin/node`): Gestor activo | 18 (del sistema): Gestor desactivado |
| Usuarios y `.env` propios | Sí (con `GESTOR_LLAVE` de pruebas) | Sí (**sin** variables `GESTOR_*`) |

## 2. Servidor de pruebas

**Arranque** (cuatro líneas separadas; el `cd` va en línea aparte):
```
kill $(cat /root/asistente-v2-pruebas/v3/pid-pruebas)
cd /root/asistente-v2-pruebas/v3
PORT=3082 setsid nohup /opt/node22/bin/node src/server.js > server-pruebas.log 2>&1 < /dev/null &
sleep 3; pgrep -f '/opt/node22/bin/node src/server.js' > pid-pruebas; tail -n 2 server-pruebas.log; ss -ltnp | grep 3082; cat pid-pruebas
```
Esperado: `Gestor: activo` y el mismo número en `ss` y en `pid-pruebas`. Con `$!` no vale: `setsid` bifurca y `$!` no es el PID de `node`.

**Si se cae:** copiar `server-pruebas.log` a `server-pruebas.anterior.log` **antes** de reiniciar (se sobrescribe). Se cayó solo dos veces el 2 nov sin causa registrada.

**Túnel desde el PC** (PowerShell; la ventana queda en blanco y no debe cerrarse):
```
ssh -N -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -i "$env:USERPROFILE\.ssh\isamor_ed25519" -L 3082:127.0.0.1:3082 root@IP_DEL_SERVIDOR
```
Luego `http://localhost:3082`. Diagnóstico: `ERR_CONNECTION_REFUSED` en el navegador = túnel cerrado; el túnel abierto con `channel 2: open failed … Connection refused` = el servidor de pruebas no está escuchando.

**Instalar una entrega** (`entregaN_pegar.txt`): se pega completa en la terminal; verifica la huella, crea la copia `v3-antes-N`, extrae sobre `v3`, comprueba la sintaxis y corre las pruebas. **No reinicia**: se reinicia aparte. Resultado esperado con Node 18: `# fail 0` y las del Gestor omitidas; con Node 22: todas.

## 3. Desplegar v1 → v2 (hecho el 2 nov)

1. **D0 (solo lectura):** `pm2 list`, salud (`"ai":"not_connected"` en la v1), huellas de `server.js` e `index.html` de la v1 (`765f5dfe…` y `e60c694a…`), espacio libre y presencia del catálogo del panel y del `.env` y usuarios de pruebas.
2. **D1 (no toca producción):** pegar `produccion_pegar.txt`; crea `/root/produccion-v2` con el código congelado y verifica su huella.
3. **D2 (con `autorizo desplegar`):** `cd /root/produccion-v2 && bash deploy/desplegar.sh`. Nueve pasos: verifica la v1, corre las pruebas, respalda completo (`/root/respaldos-manuales/asistente-v1-FECHA`), exporta el catálogo del panel (`--esperados 437`), copia usuario y `.env` **sin `GESTOR_*`**, instala el código, reinicia, comprueba `"ai":"connected"` y 437 productos, y guarda PM2.
4. **D3:** `pm2 list`, salud y registro; prueba en el navegador con una consulta real.
5. **D4 (opcional):** ajustar los módulos del usuario de producción.

El script **no borra nada** y **aborta sin cambiar nada** si la v1 fue alterada, si el catálogo no trae lo esperado o si falta la llave de IA. Reversión: `deploy/revertir.sh`.

## 4. Actualizar v2 → v2 (hecho el 2 nov con la administración de usuarios)

1. **Paso previo (no toca producción):** extraer el paquete verificando su huella en una carpeta nueva (`/root/actualizacion-usuarios`) y comprobar la partida: salud correcta y huella de `server.js` igual a la que el script espera (`HASH_ACTUAL`; por defecto `21f6d973…`, la instalada tras la administración de usuarios).
2. **Con `autorizo actualizar`:** `cd /root/actualizacion-usuarios && bash deploy/actualizar.sh`. Ocho pasos: verifica la versión y que existan los datos, corre las pruebas del paquete, respalda completo (`/root/respaldos-manuales/asistente-v2-antes-FECHA`), sobrescribe **solo código** (no toca `.env`, usuarios, catálogo ni campaña), reinicia, verifica salud, `/app.js`, `/usuarios.js` y `/api/sesion`, guarda PM2 y compara los datos.
3. **Después de cada actualización:** cambiar `HASH_ACTUAL` en `deploy/actualizar.sh` a la huella de `server.js` recién instalada (la que imprime el script al final), o el script de la siguiente vez abortará en el paso 1. Su valor actual, `21f6d973…`, corresponde a la actualización del 2 nov.
4. Reversión: `deploy/revertir-actualizacion.sh` (mueve la versión fallida a `asistente-v2-fallido-FECHA`, restaura el respaldo y reinicia). Los usuarios vuelven al estado del respaldo; el archivo más reciente queda en la carpeta fallida.

## 5. Ensayos antes de tocar producción

`verificacion/prueba-despliegue.sh` (23 comprobaciones) y `verificacion/prueba-actualizacion.sh` (19) montan una réplica local de producción con datos ficticios y ejecutan los scripts reales, incluidos los casos de aborto y la reversión. Se ejecutan con `PAQ=` o `NUEVO=` apuntando al paquete a ensayar y, para simular el Node 18 de producción, con `NODE_OPTIONS=--no-experimental-sqlite`.

## 6. Lecciones

| Lección | Detalle |
|---|---|
| La frase de autorización | El despliegue D2 se ejecutó sin ella; salió bien por el respaldo y el ensayo, pero no es la práctica |
| `.env` de pruebas ≠ producción | La llave de cifrado del Gestor de pruebas no debe viajar a producción |
| Reinicios y sesiones | Reiniciar el asistente cierra las sesiones abiertas y limpia los bloqueos de intentos |
| `usuarios.json` al arrancar | Se lee al arrancar: editarlo a mano exige reiniciar; desde el módulo Usuarios no |
| Registro de pruebas | Se sobrescribe en cada reinicio |
