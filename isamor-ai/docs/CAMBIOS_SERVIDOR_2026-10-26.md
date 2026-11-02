# ISAMOR AI – Registro de cambios del servidor (continuación 26 oct 2026)

> No contiene contraseñas, claves privadas ni valores de variables de entorno.
> Los comandos de reversión están aquí como documentación. **Nunca se pegan junto con otros comandos**: se ejecutan solos y con autorización expresa.

## 1. Objetivo
Cerrar el riesgo principal del Punto 4: SSH con contraseña, `root` permitido y sin fail2ban (429 intentos fallidos en 7 días).

## 2. Resumen ejecutivo
- Pasos 1 a 4 del Punto 4 **cerrados y verificados** (fail2ban, llave SSH, contraseña SSH desactivada, login del panel).
- SSH solo acepta llave. La contraseña de root ya no sirve por SSH.
- Quedan pendientes los pasos 5 (Nginx) y 6 (usuario no root).
- Un solo archivo de las aplicaciones fue modificado: el `server.js` del panel (login). Gratitud y el Asistente no se tocaron.

## 3. Cambios aplicados

| # | Cambio | Ubicación | Reversión |
|---|---|---|---|
| 1 | Instalación de fail2ban 1.0.2 (con `python3-pyasyncore`, `python3-pyinotify`, `whois`). Jail `sshd`: 5 fallos en 10 min, bloqueo 1 h. Lista blanca: `127.0.0.1/8`, `::1`, `169.254.0.0/16` (terminal de hPanel) | `/etc/fail2ban/jail.d/sshd-local.conf` | Desactivar el servicio fail2ban y retirar ese archivo |
| 2 | Llave pública ed25519 de Cris, huella `SHA256:[huella-redactada]`, comentario `cris-isamor-2026`. Archivo **separado** porque Hostinger reescribe `authorized_keys` | `/root/.ssh/authorized_keys_cris` (permisos 600) | Borrar ese archivo |
| 3 | Endurecimiento de SSH: acepta ambos archivos de llaves, `PasswordAuthentication no`, `PermitRootLogin prohibit-password`. Se lee antes que `50-cloud-init.conf` (en SSH vale el primer valor) | `/etc/ssh/sshd_config.d/01-endurecimiento.conf` | Borrar ese archivo, validar con `sshd -t` y recargar `ssh`. Restablece la contraseña (cloud-init la pone en `yes`). Requiere entrar por hPanel |
| 4 | `known_hosts` creado por una prueba hecha por error desde el servidor hacia sí mismo | `/root/.ssh/known_hosts` | Opcional: borrar el archivo. Inofensivo |
| 5 | Respaldo del `server.js` original del panel, hash `fc04d8e75096890517d0591310251a756ffc6ab86cce959e9f6155e7d9bfb282` | `/root/respaldos-manuales/login-20261026/server.js.original` | Opcional: borrar la carpeta (tras aplicar y validar el paso 4) |
| 6 | Copia de prueba del login nuevo del panel y su script de pruebas, con catálogo y contraseña ficticios | `/root/panel-staging/` (`server.js` hash `4950632ddf2781fac59715c7294bc3330bf1574a0d3d806277a13c9ff8d1b858`) | Borrar la carpeta (con autorización) |
| 7 | **Login del panel aplicado en producción:** comparación por hash (sin filtrar el largo), límite de 5 fallos en 10 min por IP con bloqueo de 15 min (429), sesiones que expiran a las 8 h en el servidor, cookie `Secure`, cuerpo del login limitado a 4 KB. Reinicio de `yanbal-admin` | `/opt/yanbal-admin-starter/yanbal-admin-starter/server.js` (hash anterior `fc04d8e75096890517d0591310251a756ffc6ab86cce959e9f6155e7d9bfb282`, nuevo `4950632d...`) | Copiar `/root/respaldos-manuales/login-20261026/server.js.original` sobre ese archivo y `pm2 restart yanbal-admin` (sin `--update-env`) |

No se modificaron `50-cloud-init.conf` ni `60-cloudimg-settings.conf`. Solo se modificó el `server.js` del panel (fila 7).

**Pruebas del login nuevo (aplicado):** con el código anterior fallaban 6 de 18 pruebas; con el nuevo pasan 18/18, también en el servidor con Node v18.19.1. Tras aplicarlo: `/health` correcto, hash en producción `4950632d...`, las tres apps online (solo `yanbal-admin` con 1 reinicio), la API responde 401 a claves cortas y largas (antes 400) y el login real de la usuaria, con cierre de sesión y reingreso, quedó aprobado. Detalle en `ESTADO_PROYECTO_Y_PENDIENTES.md`, sección 4.7.

## 4. Pruebas de aceptación

| Prueba | Resultado |
|---|---|
| Configuración efectiva (`sshd -T`) | `passwordauthentication no`, `permitrootlogin without-password` |
| A: llave desde el PC con passphrase | `CONEXION_POR_LLAVE_OK` |
| B: intento por contraseña desde el PC | `Permission denied (publickey)` sin pedir contraseña |
| C: terminal de hPanel nueva tras el cambio | Abre sesión |
| fail2ban | Jail `sshd` activo, 1 fallo contabilizado, 0 bloqueos |
| Aplicaciones (`pm2 status`, tras fail2ban) | `gratitud`, `yanbal-assistant`, `yanbal-admin` online, 0 reinicios |

## 5. Hallazgos y correcciones a análisis anteriores

1. **Hostinger reescribe `authorized_keys` en cada sesión de la terminal del navegador.** Escribe una llave temporal (~777 bytes) al abrirla y la vacía poco después. Corrige la afirmación previa de que existía una llave autorizada permanente. Consecuencia: las llaves propias deben ir en otro archivo, y `.ssh/authorized_keys` **debe mantenerse** en `AuthorizedKeysFile` o se rompe la terminal de hPanel.
2. `169.254.0.1` es la terminal del navegador de hPanel. Las IP `[IP-REDACTADA]` y `[IP-REDACTADA]` son de Cris (cambio de IP de su conexión). No hubo incidente de acceso.
3. fail2ban arranca automáticamente al instalarse, antes de que exista el archivo de configuración propio, y `systemctl enable --now` no recarga un servicio ya activo. Hace falta `fail2ban-client reload` y verificar el valor efectivo.
4. Dos llaves erróneas, **ninguna activa nunca**:
   - Un par ed25519 generado por error **en el servidor** (huella `SHA256:[huella-redactada]`), con nombre literal `%USERPROFILE%\.ssh\isamor_ed25519` dentro de `/root`. Eliminado y verificado.
   - Una llave pública sin comentario (huella `SHA256:[huella-redactada]`) pegada por error desde el portapapeles. Origen no determinado. Sobrescrita con la correcta antes de habilitar el archivo.
5. Copiar y pegar llaves por el portapapeles falló dos veces. Método fiable: `scp` del `.pub` y comparar huellas antes de habilitar.
6. Archivos creados en Windows terminan líneas con CR+LF (99 bytes en vez de 98). Se normalizó con `sed`.

## 6. Riesgos residuales

| Riesgo | Mitigación |
|---|---|
| Pérdida de la llave privada o de su passphrase | Copia del archivo privado fuera del PC y passphrase en gestor de contraseñas. Acceso de rescate: terminal de hPanel |
| Cambio futuro de Hostinger en su inyección de llave | Revisar si la terminal de hPanel deja de abrir tras una actualización |
| 60 paquetes sin actualizar, 1 no instalado automáticamente | Actualizaciones de seguridad con respaldo previo |
| Apps corriendo como `root` | Paso 6 del Punto 4 (usuario no root). El login del panel ya quedó corregido |

## 7. Plan de acción

| # | Acción | Estado |
|---|---|---|
| 1 | Corregir login del panel: comparar hashes, cookie `Secure`, límite de intentos, expiración de sesión en servidor | **Hecho (26 oct)** |
| 2 | Nginx: `server_tokens off` y `limit_req` en el login | Pendiente |
| 3 | Revisar `/var/log/unattended-upgrades/unattended-upgrades.log` y aplicar actualizaciones de seguridad. **No** actualizar a Ubuntu 26.04 | Pendiente |
| 4 | Usuario no root con sudo y apps sin privilegios; Gratitud en 127.0.0.1 (requiere autorización expresa) | Fase posterior |
| 5 | Git en los proyectos Yanbal (sin borrar los respaldos existentes) | Pendiente |
| 6 | Cris: 27 oct después de las 03:00 hora Colombia, `tail -5 /opt/respaldos-yanbal/respaldo.log` debe terminar en `OK` | Pendiente |
| 7 | Cris: descargar `baseline-20261026`, guardar `ADMIN_USER` y `ADMIN_PASSWORD` en un gestor, revisar snapshots en hPanel, indicar si `/opt/cursos` era un proyecto planeado | Pendiente |
| 8 | Cris: copia de seguridad del archivo privado `isamor_ed25519` fuera del PC | Pendiente |

## 8. Conclusiones
La puerta de entrada del servidor quedó protegida: acceso solo por llave con passphrase, root sin contraseña y fail2ban activo con rescate garantizado por hPanel. Ningún módulo comercial es todavía un agente funcional; el siguiente bloque es el login del panel y, solo después, la migración del catálogo y el Asistente comercial.
