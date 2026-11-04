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

## 7. Servidor de pruebas con el C12 simulado, y cómo volver al arranque normal (2 nov 2026)

Para ver el C12 antes de su fecha de inicio sin tocar los archivos programados, el servidor de pruebas se arrancó con dos variables:
- `CATALOGO_LECTURA=/root/asistente-v2-pruebas/v3/data/catalogo_lectura_siguiente.json`
- `CAMPANA=/root/asistente-v2-pruebas/campana-c12-prueba.json` (copia de `campana_siguiente.json` con inicio el 2026-11-01).

**Volver al arranque normal** (misma secuencia de arranque de la sección 2, sin esas dos variables; necesita la frase `autorizo reiniciar pruebas`). Hasta el 7 nov el catálogo de pruebas será entonces el C11.

## 8. Entregas al servidor de pruebas del 2 nov (14, 15, 15b, 16, 16b)

| Entrega | Contenido | Instalación |
|---|---|---|
| 14 | Compra especial, `--correcciones`, `deploy/c12-correcciones.json` | Pruebas y producción (`actualizar.sh`; `server.js` no cambió) |
| 15 y 15b | Pantallas del Gestor (la 15b corrige un "null" en pantalla) | Solo pruebas; `public/gestor.js` se lee en cada petición, no exige reinicio |
| 16 y 16b | `scripts/respaldar-gestor.js` y `scripts/restaurar-gestor.js` | Solo pruebas |

Todas se instalan con el `entregaN_pegar.txt` (verifica huella, copia `v3-antes-N`, extrae, revisa sintaxis y corre las pruebas con Node 22). Estado de la suite: **248 pruebas** con Node 22; 212 con Node 18 (las del SQLite se omiten).

## 9. Carga del C12 en producción (hecha el 2 nov)

`actualizar.sh` (Entrega 14) → `cargar-campana.js --origen /root/c12-entrada/c12-consolidado.json --campana "C12 2026" --desde 2026-11-07 --hasta 2026-12-04 --esperados 451 --aplicar` en `/opt/yanbal-assistant` → `pm2 restart yanbal-assistant --update-env`. El registro debe decir "Campaña siguiente programada: C12 2026 (451 productos)". Reversión: borrar `data/campana_siguiente.json` y `data/catalogo_lectura_siguiente.json` y reiniciar. Después del 7 nov: `--promover --aplicar`.

## 10. Producción con Node 22 y Gestor activo (4 nov 2026)

| Elemento | Valor |
|---|---|
| Proceso | `yanbal-assistant`, PM2 **id 3** (el id cambió al recrearlo), intérprete `/opt/node22/bin/node`, directorio de ejecución `/root`, script `/opt/yanbal-assistant/src/server.js` |
| Cómo se hizo | `pm2 delete yanbal-assistant` y `pm2 start /opt/yanbal-assistant/src/server.js --name yanbal-assistant --interpreter /opt/node22/bin/node` desde `/root`, luego `pm2 save`. Antes se copió `/root/.pm2/dump.pm2` a `/root/respaldos-manuales/pm2-dump-antes-node22-20261104` |
| Prueba previa | Segunda copia temporal en el puerto 3085 con `GESTOR_LLAVE=` en blanco (para no crear `gestor.db`): salud correcta |
| Llave | `GESTOR_LLAVE` propia en `/opt/yanbal-assistant/.env` (600). Se rotó una vez; la definitiva solo está en el servidor y en el gestor de contraseñas de la usuaria |
| Respaldo | `--exclude='gestor.db*'` en el `tar` de `respaldo-yanbal.sh`; cron `10 8 * * *` con `/opt/node22/bin/node --no-warnings scripts/respaldar-gestor.js` hacia `/opt/respaldos-yanbal/gestor/` y registro `respaldo-gestor.log` |
| Gestor | Activo, sin usuarias asignadas (`admin` e `isamor` sin `manager`). Fase B tras la revisión legal |

**Reversión a Node 18 (sin tocar datos):** `pm2 delete yanbal-assistant`, luego desde `/root`: `pm2 start /opt/yanbal-assistant/src/server.js --name yanbal-assistant` y `pm2 save`. El Gestor volvería a quedar desactivado (Node 18 no trae SQLite) y `gestor.db` se conserva. Cuando el Gestor tenga datos, no volver a Node 18 sin respaldar antes la base.

**Si hay que actualizar el código de producción otra vez:** `actualizar.sh` hace `pm2 restart yanbal-assistant`, que conserva el intérprete Node 22. Verificar `pm2 describe yanbal-assistant | grep -E "interpreter|node.js version"`.

## 11. Entregas 17, 17b y 17c en pruebas (4 nov 2026) y cambio de esquema de `gestor.db`

| Entrega | Contenido |
|---|---|
| 17 | Redacción asistida de mensajes (`src/redaccion.js`), tope mensual de gasto de la IA (`src/gasto.js`, 10 USD, `data/gasto.json`) y `GET /api/admin/gasto` |
| 17b | Campo **Estilo** (cercano, formal, breve, entusiasta) y tamaño de letra de las pestañas |
| 17c | Español natural y verificación de promesas no escritas por la asesora; aviso junto al borrador; **«Mi estilo»** cifrado (`GET/PUT/DELETE /api/gestor/estilo`) |

**Cambio de esquema (versión 1 → 2):** la tabla `estilos` se crea sola al abrir la base. Procedimiento: (1) `scripts/respaldar-gestor.js` **antes** de reiniciar; (2) instalar el paquete; (3) reiniciar; (4) comprobar con `PRAGMA user_version` (esperado 2) y el número de clientas. Un respaldo antiguo (versión 1) se abre y se actualiza solo. **No se puede volver a una versión del código anterior a la 17c con una base ya migrada sin restaurar un respaldo de la versión 1** (el código antiguo ignora la tabla nueva pero conviene respaldar antes de cualquier reversión).

**Producción:** aún no tiene las Entregas 17 a 17c. Para llevarlas: paquete nuevo con la huella actual de `server.js` de producción como `HASH_ACTUAL`; respaldo de `gestor.db` antes del reinicio; la migración ocurre al arrancar; PM2 conserva Node 22 con `pm2 restart`.

**Variables nuevas (opcionales):** `TOPE_MENSUAL_USD` (10), `PRECIO_ENTRADA_USD_MTOK` (0,10), `PRECIO_SALIDA_USD_MTOK` (0,50), `LIMITE_REDACCION_DIA` (30), `GASTO` (ruta de `gasto.json`).
