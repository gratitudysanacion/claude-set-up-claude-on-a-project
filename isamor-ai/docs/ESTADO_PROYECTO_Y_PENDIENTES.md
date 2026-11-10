# ISAMOR AI – Plataforma comercial Yanbal
## Estado del proyecto, trabajo ejecutado y pendientes

**Fecha de corte:** 2 de noviembre de 2026. Las secciones 1 a 10 conservan el detalle del 26 oct (seguridad de acceso); la sección 11 resume el avance del 27 al 30 oct (asistente v2, Estudio de contenido, Gestor de ventas, catálogo C12) y la 12 el registro de cambios del servidor en esa etapa. **Las secciones 13 y 14 recogen el 1 y 2 de noviembre: despliegue a producción, administración de usuarios y código en GitHub.**
**Servidor:** VPS Hostinger (Ubuntu 24.04), usuario root
**Regla de seguridad del documento:** no contiene contraseñas, claves ni valores de variables de entorno.

---

## 1. Resumen ejecutivo

- La infraestructura existe y funciona: 3 aplicaciones en producción (Gratitud y Sanación, Asistente Yanbal, Panel administrativo Yanbal), sin reinicios en los últimos 3 días.
- **Actualización 2 nov:** el asistente v2 **ya está en producción** (ver sección 13). **Actualización 30 oct (histórica):** en **producción** el asistente seguía siendo la versión original (solo interfaz). En el servidor de **pruebas** ya funcionan el Asistente comercial y el Estudio de contenido con IA conectada (207 pruebas automáticas aprobadas) y el motor del Gestor de ventas (base SQLite cifrada). El despliegue a producción está previsto para el **lunes 2 de noviembre**. Ver sección 11. (Lo escrito a continuación en esta sección describe la situación del 26 oct.)
- Los 4 módulos comerciales **eran solo interfaz el 26 oct**. No había IA conectada, el asistente no consultaba el catálogo y el Gestor de ventas no tenía almacenamiento.
- Se ejecutó la auditoría de solo lectura de los puntos 1 a 3 y el punto 4 (seguridad) avanzó: **los pasos 1 a 4 están CERRADOS y verificados** (fail2ban, llave SSH, contraseña SSH desactivada, login del panel). Los cambios autorizados están en la sección 8.
- **Riesgo principal anterior, CERRADO:** SSH ya solo acepta llave, `root` no puede entrar con contraseña y fail2ban está activo. Hubo 429 intentos fallidos en 7 días (427 desde una sola IP); no hubo accesos no autorizados. La usuaria confirmó que las IP de los accesos exitosos son suyas.
- **Segundo riesgo, CERRADO (26 oct):** el login del panel ya no filtra el largo de la contraseña, limita los intentos por IP, expira las sesiones en el servidor y marca la cookie `Secure`. Corrección aplicada en producción y verificada: 18/18 pruebas en el servidor con Node 18, prueba por API y login real de la usuaria (ver 4.7).
- **Sin riesgos críticos abiertos en el acceso.** Siguen pendientes de menor severidad: Nginx (paso 5), actualizaciones de seguridad, usuario no root y los hallazgos A y B de la importación.

---

## 2. Objetivo y alcance

**Objetivo:** convertir el prototipo actual en una plataforma comercial asistida por IA para consultoras de catálogo, iniciando con Yanbal y diseñada para extenderse a cualquier empresa de ventas por catálogo.

**Alcance de este documento:** registrar lo auditado y ejecutado a la fecha, los hallazgos, las decisiones tomadas y lo que sigue pendiente.

**Restricciones vigentes (no negociables):**
- No modificar Gratitud y Sanación sin autorización expresa.
- Conservar el asistente original y sus respaldos; todo cambio requiere autorización y plan de reversión.
- No importar, corregir ni eliminar los 437 productos sin autorización.
- No mostrar ni copiar secretos en la conversación ni en registros.
- La IA no debe inventar precios, vigencias, ingredientes ni beneficios.

---

## 3. Antecedentes: estado técnico confirmado

| Componente | Estado | Puerto / Dominio |
|---|---|---|
| Gratitud y Sanación | Producción (PM2 `gratitud`) | 3000, escucha en todas las interfaces (protegido por firewall) |
| Asistente Yanbal | Producción (PM2 `yanbal-assistant`), solo interfaz y rutas `/health` y `/api` | 3080, solo localhost |
| Panel administrativo | Producción (PM2 `yanbal-admin`), catálogo de 437 registros | 3081, solo localhost |
| Nginx | 3 sitios publicados, HTTPS con redirección | 80 / 443 |
| Firewall UFW | Activo: solo 80, 443 y SSH | |
| Acceso SSH | Solo llave (con passphrase). Contraseña desactivada. `root` solo con llave. Rescate: terminal del navegador de hPanel | 22 |
| fail2ban | Activo, jail `sshd` (5 fallos en 10 min, bloqueo 1 h). Lista blanca: `127.0.0.1/8`, `::1`, `169.254.0.0/16` (hPanel) | |
| Certificados | Válidos hasta enero 2027, renovación automática activa | |

**Catálogo:** 437 registros importados (396 Válido, 31 Doble, 10 No informado), todos pendientes de revisión. "Válido" no significa precio ni referencia verificados. La importación masiva sigue pausada por decisión de la usuaria.

**Decisión de arquitectura de datos (de la usuaria):** catálogo compartido entre consultoras con esquema multi-empresa, en un proyecto Supabase nuevo (`catalogo-agentes`).
> **Corrección del 30 oct:** el proyecto **sí existe** (creado el 20 oct): esquema multiempresa, 427 productos validados de C11 y una función `catalog-api` de solo lectura. **No lo usa ningún servicio todavía.** Ver sección 11.6.

---

## 4. Trabajo ejecutado

### 4.1 Punto 1: auditoría del `.env` del panel. CERRADO

| Verificación | Resultado |
|---|---|
| Permisos del `.env` del panel | 600, correcto |
| Variables que contiene | Solo `ADMIN_USER` y `ADMIN_PASSWORD` |
| ¿Se sirve por web? | No: 404 en ambos dominios Yanbal |
| ¿Cómo recibe el proceso las variables? | El código no carga el archivo; las variables llegan al proceso y quedan guardadas en el volcado de PM2 |
| `gratitudysanacion.com/.env` respondía 200 | **Falso positivo**: la app devuelve su página principal para cualquier ruta (mismo tamaño y tipo en una ruta inexistente; 0 líneas `VARIABLE=`) |
| Copias de `.env` en respaldos | No hay |

**Cambios aplicados (autorizados y ejecutados por la usuaria):**
- `chmod 600 /root/.pm2/dump.pm2` (estaba en 644)
- `chmod 600 /opt/gratitud/app/.env` (estaba en 644)
- Verificado: ambos en 600, las 3 apps siguen online.

Nota: la contraseña admin existe en dos lugares (`.env` y volcado de PM2). Si se rota, hay que actualizar ambos.

### 4.2 Punto 2: auditoría del `.venv`. CERRADO

- Contiene solo `openpyxl` (y su dependencia). Creado el 20 oct 2026, 7 minutos después de subir el Excel del catálogo.
- No hay scripts `.py`, ni referencias en el código Node, ni cron de Yanbal, ni procesos Python propios.
- **Veredicto:** entorno huérfano de uso puntual (importación del Excel). Se conserva; se retira cuando el flujo de importación se rediseñe para Supabase.
- Consecuencia: **el proceso de importación no quedó documentado ni es reproducible**.

### 4.3 Punto 3: inventario de carpetas y respaldos. CERRADO

- `/opt/cursos` está **vacío** (creado el 24 jun 2026, sin sitio publicado, sin puerto, sin `.env`). Corrige el inventario anterior que lo listaba como aplicación.
- No hay servicios ocultos: solo las 3 apps, PM2, el agente antimalware de Hostinger y el agente del hipervisor.
- Asistente original (versión de 933 bytes): 3 copias válidas (2 tar.gz con integridad verificada y 1 carpeta).
- Asistente actual en producción: sin copia independiente (solo versiones intermedias dentro de su propia carpeta).
- Panel: 7 carpetas de respaldo. Las 5 hermanas contienen el código anterior al importador; el `server.js` actual (9.368 bytes) no coincide con ninguna.
- `catalogo.json` actual (272.593 bytes): era la única copia.
- Archivos `.backup` del asistente y del panel: no se sirven por web (404).
- Disco al 8 % (44 GB libres). Ningún proyecto Yanbal tiene Git.

### 4.4 Sistema de respaldo nuevo. INSTALADO Y VERIFICADO

| Elemento | Detalle |
|---|---|
| Carpeta | `/opt/respaldos-yanbal/` (permisos 700) |
| Script | `respaldo-yanbal.sh`: valida que el catálogo sea JSON legible, copia catálogo y código (sin `.env`, `node_modules`, `.venv` ni carpetas de respaldo), verifica integridad con `gzip -t`, registra checksums, rota a 14 días solo dentro de su carpeta |
| Programación | Cron diario a las 08:00 UTC (03:00 hora Colombia) |
| Baseline | `/opt/respaldos-yanbal/baseline-20261026/` (nunca se rota) |
| Prueba de restauración | `server.js` restaurado con hash idéntico al de producción; catálogo idéntico byte a byte |
| Cron previo guardado | `crontab-antes.txt` |

**Incidente durante la instalación:** al pegar el mensaje completo, los comandos de reversión (`crontab` anterior y `rm -rf /opt/respaldos-yanbal`) se ejecutaron. Se revirtió solo lo nuevo; producción y catálogo no se afectaron (verificado). Se reinstaló con una versión corregida.

**Defecto detectado y corregido antes de que fallara:** la primera versión usaba `cp -p`, que conserva la fecha del archivo original; la rotación por antigüedad habría borrado todos los respaldos del catálogo a los 14 días. La versión instalada usa `cp` sin `-p` (verificado: la copia lleva la fecha del día).

### 4.5 Punto 4: revisión de seguridad inicial (solo lectura)

**Controles correctos:**
- HTTPS con redirección 301, HSTS, CSP restrictiva, `nosniff`, `frame-ancestors 'none'`.
- Cookie de sesión `HttpOnly` y `SameSite=Strict`, 8 horas.
- `/data/catalogo.json` y archivos `.backup` no accesibles por web.
- Certificados válidos con renovación automática.
- Solo existe el usuario `root` con shell.

**Hallazgos abiertos:**

| # | Hallazgo | Severidad | Confianza |
|---|---|---|---|
| 1 | SSH: `PasswordAuthentication yes` rige (el archivo `50-cloud-init.conf` se lee antes que `60-cloudimg-settings.conf`) y `PermitRootLogin yes` | Alta | Seguro |
| 2 | fail2ban inactivo; 429 intentos fallidos en 7 días, 427 desde [IP-REDACTADA] | Alta | Seguro |
| 3 | El login responde 400 si el largo de la contraseña difiere y 401 si coincide en largo: filtra el largo | Media | Seguro |
| 4 | Sin límite de intentos de login (ni en el código ni en Nginx) | Media-baja | Seguro |
| 5 | Cookie sin atributo `Secure` | Baja | Seguro |
| 6 | Nginx expone su versión (`server_tokens` comentado) | Baja | Seguro |
| 7 | Las 3 apps corren como `root` | Media | Seguro |
| 8 | Las sesiones no expiran en el servidor: `authed()` solo comprueba que el token exista | Media | Seguro |
| 9 | Gratitud escucha en todas las interfaces (mitigado por UFW) | Baja | Seguro |

**Verificación de intrusión (solo lectura):**
- La IP atacante tiene **0 accesos exitosos**.
- Accesos exitosos: 12 por llave desde una dirección interna (corresponde a la terminal del navegador de Hostinger) y 6 por contraseña desde [IP-REDACTADA] los días 19 y 20 oct (probablemente la conexión de la usuaria; **pendiente de confirmar**).
- Sin procesos extraños, sin tareas programadas inesperadas, sin llaves en otros usuarios.
- Límite: no se descartan rootkits ni cambios a archivos del sistema.
- Se afirmó que existía al menos una llave autorizada en `/root/.ssh/authorized_keys`. **Corrección posterior (26 oct):** ese archivo está vacío; Hostinger escribe una llave temporal al abrir la terminal del navegador y la borra poco después (ver 4.6).

### 4.6 Punto 4, pasos 1 a 3: ejecución. CERRADOS Y VERIFICADOS

| Paso | Qué se hizo | Verificación |
|---|---|---|
| 1. fail2ban | Instalado (1.0.2). Jail `sshd`: 5 fallos en 10 min, bloqueo 1 h. Lista blanca `127.0.0.1/8`, `::1`, `169.254.0.0/16`. Archivo `/etc/fail2ban/jail.d/sshd-local.conf` | Servicio activo y habilitado; valores efectivos 3600 / 600 / 5; el filtro detecta 780 líneas de intentos fallidos en el journal; las 3 apps siguen online |
| 2. Llave SSH | Llave ed25519 con passphrase creada en el computador de la usuaria. La pública se instaló en `/root/.ssh/authorized_keys_cris` (huella `SHA256:[huella-redactada]`, comentario `cris-isamor-2026`). Archivo separado porque Hostinger reescribe `authorized_keys` | Conexión por llave desde el PC: `CONEXION_POR_LLAVE_OK` |
| 3. Contraseña SSH desactivada | `/etc/ssh/sshd_config.d/01-endurecimiento.conf` con `AuthorizedKeysFile .ssh/authorized_keys .ssh/authorized_keys_cris`, `PasswordAuthentication no`, `PermitRootLogin prohibit-password`. Se lee antes que `50-cloud-init.conf` (en SSH vale el primer valor) | Prueba A: la llave entra. Prueba B: la contraseña se rechaza sin pedirla (`Permission denied (publickey)`). Prueba C: la terminal de hPanel abre sesiones nuevas |

**Hallazgos de la ejecución:**
- **Hostinger reescribe `authorized_keys` en cada sesión de la terminal del navegador** (escribe ~777 bytes al abrirla y lo vacía en ~1 minuto). Consecuencia: las llaves propias van en otro archivo, y `.ssh/authorized_keys` **debe mantenerse** en `AuthorizedKeysFile` o se rompe el acceso de rescate.
- IP confirmadas como de la usuaria: `[IP-REDACTADA]` y `[IP-REDACTADA]` (cambio de IP de su conexión). `169.254.0.1` es la terminal de hPanel. **No hubo incidente de acceso.**
- Dos llaves erróneas, **ninguna activa nunca**: (a) un par generado por error en el servidor (huella `SHA256:[huella-redactada]`), eliminado y verificado; (b) una llave pública sin comentario (huella `SHA256:[huella-redactada]`) pegada por error desde el portapapeles, de origen no determinado y sobrescrita antes de habilitar el archivo.
- fail2ban arranca solo al instalarse, antes de existir el archivo propio, y `systemctl enable --now` no recarga un servicio ya activo: hizo falta `fail2ban-client reload` y comprobar los valores efectivos.
- Se creó `/root/.ssh/known_hosts` por una prueba hecha por error desde el servidor hacia sí mismo (inofensivo).
- El banner del servidor informa **60 actualizaciones pendientes**, 4 de seguridad ESM Apps, 1 actualización no instalada automáticamente (ver `/var/log/unattended-upgrades/unattended-upgrades.log`) y la versión Ubuntu 26.04.1 disponible. **No actualizar a 26.04.**

**Estado de los hallazgos de 4.5:**

| # | Estado |
|---|---|
| 1 SSH con contraseña y root | **Cerrado** |
| 2 fail2ban inactivo | **Cerrado** |
| 3 Login filtra el largo de la clave | **Cerrado** (26 oct) |
| 4 Sin límite de intentos | **Cerrado** (26 oct): 5 fallos en 10 min por IP, bloqueo 15 min |
| 5 Cookie sin `Secure` | **Cerrado** (26 oct) |
| 6 Nginx expone su versión | Pendiente (paso 5) |
| 7 Las 3 apps corren como `root` | Pendiente (paso 6) |
| 8 Sesiones sin expiración en servidor | **Cerrado** (26 oct): expiran a las 8 h en el servidor |
| 9 Gratitud escucha en todas las interfaces | Pendiente (requiere autorización expresa) |

### 4.7 Punto 4, paso 4: login del panel. CERRADO Y VERIFICADO (26 oct)

**Cambios (23 líneas, solo en la zona de autenticación de `server.js`):**
- Comparación de usuario y clave por hash SHA-256 con `timingSafeEqual`: respuesta siempre 401, sin filtrar el largo.
- Límite de intentos por IP: 5 fallos en 10 min, bloqueo de 15 min, respuesta 429 con `Retry-After`.
- Sesiones con expiración en el servidor (8 h) y limpieza de las vencidas.
- Cookie con `HttpOnly; Secure; SameSite=Strict`.
- Cuerpo del login limitado a 4 KB (antes 2 MB sin sesión).
- No cambian: contraseña, usuario, `.env`, `app.js`, importación, productos, CSV ni datos.

**Pruebas:** con el código actual fallan 6 de 18 (reproducen los defectos); con el nuevo pasan 18/18, tanto en el entorno de desarrollo como en el servidor con Node v18.19.1, usando catálogo y contraseña ficticios y el puerto 3099.

**Dependencia de Nginx (verificada):** el límite usa `X-Real-IP`. La configuración del sitio del panel ya fija `proxy_set_header X-Real-IP $remote_addr;`, por lo que la cabecera no se puede falsificar. El sitio no tiene `limit_req` ni `server_tokens off` (paso 5).

| Elemento | Detalle |
|---|---|
| `server.js` actual (original) | 9.368 bytes, hash `fc04d8e75096890517d0591310251a756ffc6ab86cce959e9f6155e7d9bfb282` |
| `server.js` nuevo | 11.282 bytes, hash `4950632ddf2781fac59715c7294bc3330bf1574a0d3d806277a13c9ff8d1b858`, en `/root/panel-staging/server.js` |
| Respaldo del original | `/root/respaldos-manuales/login-20261026/server.js.original` (hash verificado idéntico al de producción) |
| Aplicación (26 oct) | Se copió el nuevo sobre el `server.js` del panel, con comprobación previa de hashes, respaldo y sintaxis, y `pm2 restart yanbal-admin` (sin `--update-env`; el panel conservó sus variables). Cerró las sesiones abiertas |
| Verificación | Hash en producción `4950632d...`; `/health` correcto; `gratitud` y `yanbal-assistant` online sin reinicios; `yanbal-admin` online con 1 reinicio; API: claves incorrectas cortas y largas responden 401 (antes 400); login real de la usuaria, cierre de sesión y reingreso aprobados |
| Reversión (no fue necesaria) | Restaurar `/root/respaldos-manuales/login-20261026/server.js.original` y reiniciar `yanbal-admin` |
| Autorización | Dada por la usuaria: "aplicar el login del panel" |

**Hallazgos adicionales de la lectura del código (no incluidos en este cambio):**

| # | Hallazgo | Severidad |
|---|---|---|
| A | La importación (`/api/import/preview` y `/confirm`) lee el catálogo preparado desde `/tmp/yanbal_catalogo_consolidado.json`. `/tmp` es compartida y se vacía sola: si el archivo desaparece, la importación falla; si se reemplaza, se importaría ese contenido (el endpoint exige 437 registros, ids únicos y la frase exacta) | Media |
| B | `/api/import/confirm` sigue activo (protegido por login y por la frase `IMPORTAR 437 PRODUCTOS`). La pausa de la importación es hoy una decisión, no un bloqueo técnico | Baja |
| C | No hay token anti-CSRF (mitigado por `SameSite=Strict`) | Baja |

---

## 5. Análisis

- **El mayor riesgo operativo no es técnico sino de datos:** el catálogo de 437 registros, que será revisado a mano, vive en un solo archivo. El respaldo diario nuevo mitiga esto dentro del VPS, pero no ante la pérdida del servidor.
- **El esfuerzo real de desarrollo es mayor al que sugiere "ya hay algo construido":** el servidor del asistente tiene unas 110 líneas, sirve HTML y no tiene lógica comercial.
- **Tres capas de datos sin fuente única de verdad** (Excel, JSON, y Supabase futuro) pueden generar inconsistencias de precios.
- **Datos personales de clientes** (Gestor de ventas): implican obligaciones de protección de datos personales (Ley 1581 de 2012 en Colombia). No está contemplado aún.

---

## 6. Riesgos

| Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|
| Acceso no autorizado por SSH con contraseña | ~~Media~~ **Mitigado el 26 oct** | Crítico (control total de las 3 apps) | fail2ban activo, llave SSH, contraseña desactivada (ver 4.6) |
| Pérdida del VPS sin copia externa | Baja-media | Alto | Descargar baseline, revisar snapshots en hPanel, copia externa automática |
| Fallo del respaldo automático sin que se note | Media | Alto | Verificar el log cada día durante la primera semana |
| Cambio de SSH que deje sin acceso | Baja | Alto | Mantener sesión abierta mientras se prueba; hPanel como rescate |
| Credenciales admin perdidas (no están en los respaldos) | Media | Medio | Guardarlas en gestor de contraseñas |
| Cookie de sesión reutilizable indefinidamente | Baja | Media | Expiración en servidor (**aplicada el 26 oct**; riesgo mitigado) |
| Flujo de importación no reproducible | Media | Medio | Rediseñarlo en la migración a Supabase |
| Pérdida de la llave privada SSH o de su passphrase | Baja-media | Alto (queda solo el acceso de rescate por hPanel) | Copia del archivo privado fuera del PC y passphrase en gestor de contraseñas |
| Hostinger cambia su mecanismo de inyección de llaves y la terminal de hPanel deja de abrir | Baja | Alto (se pierde el acceso de rescate) | Revisar la terminal de hPanel tras actualizaciones del proveedor; mantener `.ssh/authorized_keys` en `AuthorizedKeysFile` |
| 60 actualizaciones pendientes, 1 no instalada automáticamente | Media | Medio | Revisar el log de unattended-upgrades; aplicar con respaldo previo; no pasar a Ubuntu 26.04 |
| Importación dependiente de un archivo en `/tmp` | Media | Medio | Rediseñar el flujo de importación (hallazgo A, 4.7) |

---

## 7. Plan de acción: pendientes

> **Actualización del 30 oct 2026:** la lista vigente de pendientes está en la sección **11.8**. Las tablas 7.1 a 7.6 conservan el estado del 26 oct; en 7.5 la frase "nada implementado todavía" ya no es cierta (ver 11.1 y 11.2).

### 7.1 Inmediatos (usuaria)

| # | Acción | Estado |
|---|---|---|
| 1 | Mañana (27 oct), después de las 03:00 hora Colombia: ejecutar `tail -5 /opt/respaldos-yanbal/respaldo.log` y confirmar que termina en `OK` | Pendiente |
| 2 | Descargar `baseline-20261026` a su computador con `scp` y guardarlo fuera de ese equipo | Pendiente |
| 3 | Guardar `ADMIN_USER` y `ADMIN_PASSWORD` en un gestor de contraseñas | Pendiente |
| 4 | Revisar en hPanel si el plan incluye snapshots o copias automáticas del VPS | Pendiente |
| 5 | Confirmar si [IP-REDACTADA] es su IP | **Hecho (26 oct):** `[IP-REDACTADA]` y `[IP-REDACTADA]` son de la usuaria; sin incidente |
| 6 | Indicar si `/opt/cursos` era un proyecto planeado (para documentarlo) | Pendiente |
| 7 | Copia de seguridad del archivo **privado** `isamor_ed25519` fuera del PC, y la passphrase en el gestor de contraseñas | Pendiente |
| 8 | Autorizar la aplicación del login del panel | **Hecho (26 oct)** |

### 7.2 Punto 4: endurecimiento de seguridad (orden obligatorio)

| Paso | Acción | Riesgo | Autorización |
|---|---|---|---|
| 1 | Instalar y activar fail2ban (con la red de hPanel en lista blanca) | Bajo | **CERRADO (26 oct)** |
| 2 | Crear e instalar la llave de la usuaria; probarla en una sesión nueva | Bajo | **CERRADO (26 oct)** |
| 3 | `PermitRootLogin prohibit-password` y desactivar contraseña | Medio | **CERRADO (26 oct)** |
| 4 | Corregir el login del panel: comparar hashes (elimina la filtración del largo), cookie `Secure`, límite de intentos, expiración de sesión en el servidor | Medio | **CERRADO (26 oct)**: aplicado y verificado, con respaldo del código anterior |
| 5 | Nginx: `server_tokens off` y `limit_req` en el login (el sitio ya fija `X-Real-IP`) | Bajo | Pendiente |
| 6 | Fase posterior: usuario no root con sudo y apps sin privilegios; Gratitud en 127.0.0.1 (toca su código, requiere autorización expresa) | Medio | Pendiente |
| 7 | Revisar `/var/log/unattended-upgrades/unattended-upgrades.log` y aplicar actualizaciones de seguridad con respaldo previo. **No actualizar a Ubuntu 26.04** | Medio | Pendiente |
| 8 | Limpieza posterior al paso 4: `/root/panel-staging/` y `/root/.ssh/known_hosts` (requiere autorización) | Bajo | Pendiente |

### 7.3 Respaldos y versionado

- Evaluar copia externa automática (snapshots de hPanel, `scp` manual o rclone a Drive) una vez validado el catálogo.
- Prueba de restauración completa (arrancar la app desde el respaldo) en un entorno aparte.
- Implementar Git en los proyectos Yanbal para reemplazar las carpetas de respaldo improvisadas; **no borrar las existentes** hasta tenerlo.

### 7.4 Datos y catálogo

- Decidir cuándo reanudar la importación masiva (hoy pausada). Antes, rediseñar el flujo para que no dependa de `/tmp` y decidir si `/api/import/confirm` debe permanecer activo mientras esté pausada (hallazgos A y B, 4.7).
- Revisar manualmente los 437 registros; resolver 31 dobles y 10 sin informar.
- Enriquecer el catálogo (descripciones, ingredientes, instrucciones oficiales) para el Asesor de belleza.
- Definir estados de revisión por producto para no presentar como oferta algo no confirmado.
- Formalizar el flujo PDF, artefacto de Claude, Excel, panel admin, e integrar el artefacto a la aplicación.
- Planificar la **migración del JSON a Supabase** (cuenta nueva, proyecto `catalogo-agentes`, modelo multi-empresa).

### 7.5 Arquitectura y desarrollo de módulos

**Asistente comercial (módulo 1): decisiones del 26 oct 2026.** Primero interno con login y luego clientas finales con límites; canal web ahora y WhatsApp después; MVP = buscar un producto y mostrar precio normal, oferta y vigencia, y decir "no tengo ese dato" cuando falte; los precios se muestran con la advertencia de "pendiente de revisión" mientras no estén revisados. Diseño v1.1 en `DISENO_ASISTENTE_COMERCIAL_v1.md` (**aprobado el 27 oct 2026**; escenario B del plan: construir y probar con C11 y apuntar a la campaña C12; nada implementado todavía). Principio: el modelo redacta y el código decide (vigencias y disponibilidad de precio se calculan en código, con verificador de importes). **Perfil del catálogo (26 oct, solo conteos):** 437 productos, 44 sin precio normal, 427 con oferta y **ninguno con fecha de vigencia**. Los precios son de la campaña C11 2026, vigente del 10 de octubre al 6 de noviembre de 2026 (dato corregido el 27 oct); el diseño v1.1 maneja la vigencia con un archivo de campaña (`campana.json`) y una regla de "campaña vencida". Otros hallazgos: 0 referencias repetidas entre las no vacías, 34 productos con oferta y sin precio normal, y `promocion` es texto libre con importes (se mostrará literal y se verificará su coherencia con el precio). Verificado contra la página 102-103 del catálogo impreso: las referencias 670, 750 y 306 coinciden (precio normal, oferta, texto y página), y 18 promociones mencionan "gratis". Fechas de campaña confirmadas por la usuaria. Coherencia texto-precio verificada: no hay incoherencias reales (los 8 sets suman su precio de oferta; 22 textos de promoción están incompletos y 2 productos solo se venden dentro de un set). Decididos el 27 oct: proveedor = **API de Anthropic** y tope = **el saldo disponible en la consola (3,45 USD al 27 oct), sin agregar fondos ni recarga automática** (uso interno; se redefine al abrirlo a más usuarias). **Construcción iniciada el 27 oct** (ver `DISENO_TECNICO_ASISTENTE_v1.md`): leído el asistente actual (solo interfaz, sin POST ni sesiones) y terminado el núcleo (reglas de vigencia y coherencia, búsqueda y verificador de importes) con **33 pruebas aprobadas** en copia aislada; nada desplegado ni tocado en el servidor. Hecho el 27 oct: workspace `isamor-ai` con límite de gasto de 3 USD y clave de API ligada a ese workspace, con vencimiento el **30 abr 2027** (guardada en el gestor de la usuaria; nunca pasa por el chat ni por Git; renovar antes de esa fecha). Pendientes: modelo de IA (tras las pruebas), usuario y contraseña del asistente, lectura del asistente actual (`server.js`, `index.html`, `package.json`) y el procedimiento de carga de campaña (C12).

1. Contrato de API de **solo lectura** del catálogo (campos autorizados). El asistente nunca recibe credenciales admin.
2. Elegir proveedor de IA y modelo, con análisis de costo por consulta.
3. Asistente comercial (primero): IA + catálogo, con pruebas de precios incompletos y promociones vencidas.
4. Estudio de contenido.
5. Asesor de belleza (depende del catálogo enriquecido).
6. Gestor de ventas (modelo de datos, persistencia, permisos, respaldo y cumplimiento de protección de datos).
7. Pruebas integrales, despliegue gradual con reversión y documentación.

### 7.6 Documentación

Actualizar `/opt/DOCUMENTACION_ISAMOR_AI/` con: hallazgos de esta auditoría, sistema de respaldo y su restauración, origen de las credenciales, el hecho de que `/opt/cursos` está vacío, el `.venv` como entorno de importación puntual, y el CHANGELOG de los cambios del 26 oct. El detalle del endurecimiento de SSH (con reversiones) está en `CAMBIOS_SERVIDOR_2026-10-26.md`.

---

## 8. Registro de cambios aplicados al servidor (26 oct 2026)

| Cambio | Reversión |
|---|---|
| `chmod 600` en `/root/.pm2/dump.pm2` | `chmod 644` |
| `chmod 600` en `/opt/gratitud/app/.env` | `chmod 644` |
| Creación de `/opt/respaldos-yanbal/` con script, baseline y checksums | Eliminar la carpeta |
| Línea de cron a las 08:00 UTC | Restaurar `crontab-antes.txt` |
| Instalación de fail2ban y `/etc/fail2ban/jail.d/sshd-local.conf` (jail `sshd`, lista blanca de hPanel) | Desactivar el servicio y retirar ese archivo |
| `/root/.ssh/authorized_keys_cris` con la llave pública de la usuaria | Borrar el archivo |
| `/etc/ssh/sshd_config.d/01-endurecimiento.conf` (acepta ambos archivos de llaves, sin contraseña, root solo con llave) | Borrar el archivo, validar con `sshd -t` y recargar `ssh`. Restablece la contraseña (cloud-init la pone en `yes`); exige entrar por hPanel |
| `/root/.ssh/known_hosts` (prueba accidental desde el servidor hacia sí mismo) | Opcional: borrar el archivo |
| `/root/respaldos-manuales/login-20261026/server.js.original` (respaldo del panel) y `/root/panel-staging/` (código nuevo del panel y pruebas, con datos ficticios) | Opcional: borrar las carpetas (con autorización) |
| `server.js` del panel (`/opt/yanbal-admin-starter/yanbal-admin-starter/server.js`): login con hash, límite de intentos, expiración de sesión, cookie `Secure`. Hash anterior `fc04d8e7...`, nuevo `4950632d...`. Reinicio de `yanbal-admin` | Copiar `/root/respaldos-manuales/login-20261026/server.js.original` sobre ese archivo y `pm2 restart yanbal-admin` |

Un único archivo de producción fue modificado en su contenido: el `server.js` del panel (4.7). Gratitud y el Asistente no se tocaron.

---

## 9. Correcciones a análisis anteriores

1. Los respaldos `.tar.gz` de 882 bytes del asistente **no eran incompletos**: contienen todo lo que existía en ese momento.
2. El panel tiene **7** carpetas de respaldo, no 6 (dos están dentro del proyecto).
3. ~~Sí existe al menos una llave SSH autorizada.~~ **Corrección del 26 oct:** `authorized_keys` está vacío; Hostinger escribe una llave temporal en cada sesión de su terminal y la borra después.
4. `/opt/cursos` está vacío; no es una aplicación.
5. El error de `cp -p` del primer script de respaldo, detectado y corregido antes de que causara pérdida.
6. Un comando de reversión viajó en el mismo mensaje que los pasos de instalación y se ejecutó. Regla desde entonces: ningún comando de borrado o reversión va junto a comandos que se quieren ejecutar.
7. Se atribuyó el fallo de la lista blanca de fail2ban a la herencia de `ignoreip` en esa versión. La causa real: el servicio arrancó al instalarse, antes de existir el archivo propio, y `enable --now` no lo recarga. Regla: tras crear un archivo de configuración, recargar y comprobar el valor efectivo.
8. Se afirmó que a fail2ban le bastaba leer el historial para bloquear la IP atacante. Solo revisa hacia atrás el tiempo de `findtime` (10 min): los intentos pasados no cuentan.
9. Se esperaba que el archivo de la llave pública pesara 98 bytes; creado en Windows pesa 99 (fin de línea CR+LF). Se normalizó con `sed`.
10. Las instrucciones de la llave SSH se dieron primero en PowerShell; la usuaria usaba `cmd`, y varios comandos se ejecutaron en la ventana equivocada (PC frente a servidor). Regla: indicar siempre en qué ventana se ejecuta cada comando y cómo reconocerla (`C:\Users\...>` frente a `root@srv...`).
11. Copiar y pegar la llave pública por el portapapeles falló dos veces (se pegó otra llave). Método fiable: transferir el archivo con `scp` y comparar la huella antes de habilitarlo. Para código: bloques base64 en el terminal y verificación de hash.

---

## 10. Conclusiones (26 oct 2026; ver la sección 11 para el estado actual)

La base técnica es estable, con respaldo diario verificado, y la puerta de entrada del servidor quedó protegida: SSH solo con llave y passphrase, `root` sin contraseña y fail2ban activo, con la terminal de hPanel como acceso de rescate. El login del panel, el otro riesgo abierto, quedó corregido y verificado el mismo día. La prioridad inmediata es seguir con Nginx (paso 5) y las actualizaciones de seguridad, y solo después continuar con la migración del catálogo y la construcción de los módulos. Hasta entonces, ningún módulo debe considerarse un agente funcional.

---

## 11. Avance del 27 al 30 de octubre de 2026

### 11.1 Resumen

| Módulo | Estado al 30 oct |
|---|---|
| 1 Asistente comercial | **Construido y aprobado en pruebas.** Producción sigue con la versión original; despliegue previsto lunes 2 nov |
| 3 Estudio de contenido | **Construido y aprobado en pruebas** |
| 4 Gestor de ventas | **Motor activo en pruebas** (SQLite cifrada, API y permisos). Faltan pantallas (Entrega 13) y redacción asistida con IA (Entrega 14) |
| 2 Asesor de belleza | **Bloqueado**: faltan datos oficiales de productos |

El menú lateral es: Asistente comercial (1.º), Asesor de belleza (2.º), **Estudio de contenido (3.º)**, Gestor de ventas (4.º). Durante las pruebas varias consultas de contenido se hicieron por error en el módulo comercial; el registro del servidor (`"modulo":"sales"` o `"content"`) permite comprobarlo.

### 11.2 Entregas instaladas en el servidor de pruebas (`/root/asistente-v2-pruebas/v3`)

Cada entrega se pegó como bloque base64 con huella verificada, copia previa `v3-antes-N` y pruebas automáticas; ninguna reinicia el asistente (se hace aparte).

| Entrega | Contenido |
|---|---|
| 1 a 2b | Núcleo (reglas, catálogo, verificador de importes), servidor con login y límites, cliente de IA real (Haiku 5.5), respuesta de respaldo sin IA, scripts de exportación de la copia de lectura, de usuario y de llave |
| 3 a 3d | **Regla 2 x 1** (si el catálogo da un solo precio y la promoción dice "2 x 1 por $X", el precio normal es el del catálogo y el comprador recibe 2 por ese precio), **regla de obsequios** (sin precio y con texto que empieza por "Obsequio"; se entrega gratis con la compra indicada), auditor del catálogo, lectura de respaldo y firewall |
| 4 a 7 | **Módulos con permisos por usuario** (`sales`, `content`, `beauty`, `manager`; por defecto solo `sales`), **motor genérico de agentes** (`agente.js`), **Estudio de contenido** (`contenido.js`) con reglas de marca verificadas por código (términos prohibidos, afirmaciones no documentadas como duración o resistencia, escasez y reservas, código de campaña, reintento con corrección exacta, botón "Copiar texto"), y **campaña programada** (la siguiente entra sola a las 00:00 hora de Colombia de su fecha de inicio) con `cargar-campana.js` |
| 8 | Tope de tokens corregido (el razonamiento oculto del modelo gasta del tope y cortaba respuestas: 2.500 en comercial y 4.500 en contenido), nota de marca automática y el módulo comercial remite al Estudio de contenido cuando le piden redactar anuncios |
| 9 y 9b | La **vigencia va junto al precio de oferta**, nunca junto al normal; el verificador rechaza letras de otros alfabetos (un hashtag salió con letras cirílicas disfrazadas de latinas) |
| 10 | **Gestor de ventas, parte 1:** `cifrado.js`, `enmascarar.js`, `gestor.js`, API en el servidor, rol de administradora, scripts `crear-llave-gestor.js` y `asignar-rol.js` |
| 11 | **Node 22.22.0 en paralelo** en `/opt/node22` (script con tres huellas coincidentes: descargada, fijada y publicada) |
| Activación del Gestor | Llave creada, `admin` marcado administradora con módulo `manager`, asistente de pruebas reiniciado con Node 22 (`Gestor: activo`) |
| 12 | **Conversor del Excel del catálogo** (`xlsx-a-consolidado.js`), regla de **sets sin marca** del C12, permisos 600 de la base del Gestor |

Pruebas: **207 de 207** con Node 22; con el Node 18 del sistema pasan 184 y se omiten 23 (las del Gestor, que necesitan SQLite integrado). Cada función nueva se comprobó con mutaciones (romper el código a propósito y verificar que una prueba falla).

### 11.3 Decisiones de la usuaria (30 oct y anteriores)

| Tema | Decisión |
|---|---|
| Plan | Adelantar el desarrollo al máximo antes del 3 nov (créditos de Claude en la nube); despliegue del módulo 1 el lunes 2 nov con respaldo y reversión; módulos 2 a 4 desplegados detrás de permisos por usuario |
| Marca | Prohibido prometer milagros o curas; usar hashtags y descripción para redes; **los precios van en los textos** |
| Regla 2 x 1 y obsequios | Aprobadas |
| Gestor: datos | Nombre, teléfono, dirección de envío, cédula (opcional) y notas, que alimentan a la IA para redacción; teléfono cifrado (se extendió a cédula, dirección y notas) |
| Gestor: almacenamiento | **SQLite** (decisión de la usuaria; implica Node 22 en paralelo) |
| Gestor: acceso de la administradora | Puede **leer** los datos de todas (da soporte); cada lectura queda registrada; no puede modificarlos |
| Gestor: otros | Cédula y dirección opcionales; recordatorios solo dentro de la aplicación; etapas: nueva, contactada, interesada, pedido en curso, cliente, recompra, inactiva; texto de consentimiento propuesto aprobado |
| n8n | Alternativas aprobadas: monitoreo con servicio gratuito, WhatsApp en noviembre con diseño de seguridad, sin esfuerzo en la prueba de n8n |
| Panel de carga | Mejoras **aplazadas** (la usuaria prefirió el Gestor) |
| Límite de gasto de la API | El que ya tiene la consola (3 USD al mes, compartido). Se retiró la recomendación de 10 USD por innecesaria |
| Compra especial (60099, 60100, 60121, 60124) | **Pendiente de decisión** |

### 11.4 Costos reales del modelo (Haiku 5.5: 0,10 USD entrada y 0,50 USD salida por millón de tokens)

- Una consulta comercial cuesta unos **0,0008 USD**; una de contenido unos **0,002 USD** (más tokens de razonamiento).
- Gasto del mes al 27 oct: 0,45 USD de 3 USD; la llave del asistente explica 0,02 USD. **Quedan ~0,43 USD sin explicar** (otro uso de la misma organización): pendiente revisar el desglose de Costo en la consola.
- Hallazgo técnico: Haiku 5.5 razona por defecto y esos tokens cuentan contra `max_tokens`; por eso se cortaban respuestas y se subieron los topes.

### 11.5 Catálogo C12 (vigencia del 7 de noviembre al 4 de diciembre de 2026)

**Flujo real del catálogo** (descubierto el 30 oct, antes sin documentar): PDF del catálogo → artefacto de Claude **"Lista de precios del catálogo"** (`claude.ai/artifact/Nz3wtshDmLt58ECgvXY15G`, lee el PDF en el navegador, Claude extrae los productos y el artefacto **comprueba cada precio y código contra el texto de su página**, marcando "Revisar" lo que no coincide) → Excel con hojas *Productos* y *Sin precio* → `xlsx-a-consolidado.js` → `cargar-campana.js`. El panel y Supabase del C11 salieron de ese mismo artefacto.

Resultado con el Excel real del C12 (probado en el entorno de trabajo; el archivo está en el servidor con la misma huella):

| Dato | Valor |
|---|---|
| Productos | 452 (425 con precio y 27 sin precio) |
| 2 x 1 | 22 |
| Obsequios | 11 |
| Sets | 24, todos con la suma de componentes igual al precio del set (tras corregir una regla que solo conocía el formato del C11) |
| Filas "Revisar" | **14**, solo en las páginas 26 (colonias Soy, $32.500 / $65.000) y 56 (bases líquidas, $60.500 / $110.000) |
| "Sin ningún precio" no obsequio | 16 (en C11 eran 3); algunos son vendibles sin código: Esmalte $19.500, Kids Jabón $12.500, Instamate $38.500, 4 BB Cream en pág. 100 |
| Atención | **5104** (Delineador) pasó de 2 x 1 a $28.000 **dentro de un set** (pág. 66) y **43891** a $24.000 dentro de un set (pág. 113): verificar que no se presenten como precio suelto. Bolsas y cajas "compra especial" de $3.000 a $3.500 (60099, 60100, 60121, 60124) |

El procedimiento completo está en `GUIA_CARGA_CAMPANA.md`.

### 11.6 Supabase `catalogo-agentes` (hallazgo del 30 oct, lectura de solo estructura y un conteo)

| Elemento | Detalle |
|---|---|
| Proyecto | `catalogo-agentes`, región us-east-1, creado el 20 oct 2026, activo |
| Esquema | Multiempresa: empresas, cuentas, miembros, **campañas**, productos, **precios por campaña**, leads, seguimientos, conversaciones, mensajes, borradores de contenido, llaves de API, límites y registro de auditoría. RLS activo en todas las tablas |
| Datos | 427 productos validados, 427 precios, 31 con 2 x 1, 1 campaña (`C11-2026`, activa del 10/10 al 06/11). **437 − 3 sin precio − 7 obsequios = 427** [Probable]: es la versión limpia del catálogo |
| API | Función `catalog-api`: solo lectura, llave propia guardada como hash, límite por IP y por llave; devuelve solo productos validados con campaña y precio vigentes |
| Uso | 1 llave activa, **último uso el 20 oct**: ningún servicio lo usa hoy |
| Riesgo | La tabla `leads` guarda teléfono y correo en claro (vacía). **No usarla para clientas**: el Gestor de ventas vive en la VPS con cifrado |

Decisión pendiente (no urgente): si el asistente pasa a leer de Supabase (una sola fuente de verdad, campañas por fechas) o se mantiene el JSON de la VPS. Para el lunes 2 no se toca.

### 11.7 Lecciones y correcciones de esta etapa

1. **El servidor es opaco para Claude**: solo se ve lo que la usuaria pega. Un PDF subido al servidor no lo puede leer Claude; el artefacto de Claude sí.
2. `cd carpeta && PORT=3082 nohup node ... &` guarda en `$!` el PID de un envoltorio, no el de `node`; el `cd` va en línea aparte (el `pid-pruebas` quedó mal una vez y el reinicio falló por puerto ocupado).
3. Se dijo varias veces que Estudio de contenido era el cuarto elemento del menú; es el **tercero**.
4. Un intento de reiniciar el asistente de pruebas sobrescribe `server-pruebas.log`: se pierde el historial.
5. La regla de coherencia de sets dependía de la marca `componentes en oferta:` del C11 y marcaba 24 sets como inconsistentes en el C12; se corrigió y se probó con el Excel real.
6. La base del Gestor nació con permisos 644 (legible por todos los usuarios del servidor); se corrigió a 600 y también en los archivos `-wal` y `-shm` ya existentes. En pruebas queda un `chmod 600 data/gestor.db*` por confirmar.
7. El sistema de permisos del entorno de Claude bloqueó descargar código externo para probar el conversor; se respetó y se armaron los datos de prueba con un escritor de `.xlsx` propio. Después el Excel real confirmó que el conversor lo lee sin ajustes.

### 11.8 Pendientes (30 oct, noche)

| Prioridad | Pendiente | Responsable |
|---|---|---|
| **Bloquea el 7 nov** | Comprobar contra el PDF las págs. 26, 56, 66 y 113; decidir "compra especial" y los 16 sin precio; convertir con `--aprobar`, ensayo, programar | Usuaria y Claude |
| **Lunes 2 nov** | Paquete final congelado; `desplegar.sh` y `revertir.sh` (ensayados 22/22); frases por paso; usuarios y módulos de producción; verificar el siguiente respaldo | Claude y usuaria |
| Antes del 3 nov | Guardar el código en la rama del repositorio; actualizar documentos | Claude (con autorización) |
| Gestor | Entrega 13 (pantallas) y 14 (redacción asistida e indicadores); llave de producción distinta; respaldo consistente de la base SQLite en el script diario; revisión legal del consentimiento (Ley 1581 de 2012) | Claude y usuaria |
| Seguridad | Nginx (`autorizo nginx`); 60 actualizaciones y 1 no instalada (sin Ubuntu 26.04); Node 18 sin soporte; hallazgos A y B del panel; limpieza de `/root/panel-staging/`, `known_hosts` y copias `v3-antes-*`; Git en el servidor; llave de API que vence el 30 abr 2027 | Usuaria y Claude |
| Usuaria | Copia fuera del PC de `isamor_ed25519` y su passphrase; `ADMIN_USER`, `ADMIN_PASSWORD` y llave del Gestor en el gestor de contraseñas; `baseline-20261026`; instantáneas en hPanel; desglose de Costo de la consola | Usuaria |
| Aplazado | Mejoras del panel de carga (importación genérica, comparación contra la campaña anterior, auditoría integrada, historial y reversión); WhatsApp (noviembre); monitoreo gratuito; Asesor de belleza | |

## 12. Registro de cambios aplicados al servidor (27 al 30 oct 2026)

Los comandos de reversión se dan siempre en un mensaje aparte (regla 8).

| Cambio | Reversión |
|---|---|
| `/root/asistente-v2-pruebas/v3/` y copias `v3-antes-*` (código v2, `.env` con la llave de IA y la llave de cifrado del Gestor, `data/usuarios.json`, `data/gestor.db`, `server-pruebas.log`) | Apagar el proceso (`kill $(cat pid-pruebas)`) y retirar la carpeta, con autorización |
| Usuario `admin` del asistente de pruebas, con rol `admin` y módulos `sales`, `content`, `manager` (`usuarios.json`) | `node scripts/asignar-modulos.js admin sales` y `asignar-rol.js admin usuaria` |
| `/opt/node-v22.22.0-linux-x64/`, enlace `/opt/node22`, descarga en `/root/descargas-node/`, script `/root/instalar-node22.sh` | Borrar esas rutas; no afecta a Node 18 ni a las tres apps |
| `/root/c12-entrada/` con `c12.pdf`, `Catalogo_Yanbal_C12_2026_Precios.xlsx`, `contar-paginas.py` y `probar-pdf.js` (este último no se ejecutó) | Borrar la carpeta |
| `GESTOR_LLAVE` en el `.env` de pruebas | No borrarla mientras exista `gestor.db`: dejaría ilegibles los datos |

Producción (`/opt/yanbal-assistant`), el panel, Gratitud, Nginx, UFW y el cron de respaldo **no se tocaron** en esta etapa.

---

## 13. Avance del 1 y 2 de noviembre de 2026

### 13.1 Producción: el asistente v2 está en línea

| Paso | Resultado |
|---|---|
| Paquete congelado | Código de la Entrega 12 (el que ya había pasado 207 pruebas en el servidor de pruebas), con `desplegar.sh` corregido para **no copiar la llave de cifrado del Gestor de pruebas** a producción (el `.env` de producción lleva solo la llave de IA) |
| Ensayo previo | 23 de 23 comprobaciones en una réplica de producción con Node 18 (abortos ante v1 alterada, catálogo incompleto o falta de llave; instalación; reversión) |
| D0 a D3 (2 nov) | v1 confirmada (`765f5dfe…` / `e60c694a…`); respaldo `/root/respaldos-manuales/asistente-v1-20261102-015110`; catálogo de 437 exportado desde el panel; usuario y `.env` copiados desde pruebas; reinicio; salud `"ai":"connected"`, `"productos":437`; PM2 guardado. `server.js` = `e90b7d83…` |
| D4 | Módulos del usuario `admin` ajustados con `asignar-modulos.js` |
| Servicios vecinos | `gratitud` y `yanbal-admin` no se tocaron: `online`, sin reinicios, 5 días de actividad continua |
| Observación | El despliegue D2 se ejecutó **sin escribir antes la frase `autorizo desplegar`**; salió bien y estaba respaldado, pero se anotó la regla: la frase se pide siempre |

### 13.2 Acceso: clave perdida y restablecimiento

La usuaria no podía entrar a producción ("contraseña incorrecta"). El registro mostró cinco intentos con clave incorrecta (401) y luego un bloqueo (429): era una clave equivocada, no un fallo. Se restableció con `crear-usuario.js` y se devolvió el rol con `asignar-rol.js`, porque **el script antiguo reemplazaba el registro completo y borraba el rol** (corregido en el código nuevo). Los reinicios limpiaron el bloqueo. Al escribir los módulos en vez de pulsar Enter, `admin` quedó con `sales, content, beauty, manager`; es ajustable desde el módulo Usuarios.

### 13.3 Administración de usuarios (Entrega 13)

Propuesta de la usuaria ("¿es posible crear en la página un módulo para crear usuarios, cambiar contraseñas e inactivar usuarios?"); diseño aprobado el 2 nov, **una sola administradora por ahora** (el código permite varias). Detalle en `DISENO_ADMIN_USUARIOS_v1.md`.

| Verificación | Resultado |
|---|---|
| Pruebas automáticas | **225 de 225** (con Node 18: 201 pasan y 24 se omiten, las del Gestor) |
| Navegador real | 18 comprobaciones del módulo nuevo y 20 de los anteriores |
| Mutaciones | 14 de 15 detectadas; la restante es una redundancia legítima (la sesión ya se invalida por otra vía) |
| Ensayo de actualización y reversión | 19 de 19 en una réplica fiel (la huella de `server.js` de la réplica coincidió con la de producción) |
| Pruebas en el servidor de pruebas | Usuario `isamor` creado desde la pantalla; menú, lista y creación confirmados por la usuaria |
| Actualización de producción | `deploy/actualizar.sh` el 2 nov: respaldo `/root/respaldos-manuales/asistente-v2-antes-20261102-031746` (54 archivos), pruebas 0 fallos, salud correcta, PM2 guardado, datos sin cambios. `server.js` = `21f6d973…` |
| Prueba en producción | El Asistente comercial respondió correctamente (Biomilk 670, 750 y 306 con precio, oferta, página y vigencia de C11; "quedan 5 días") |

### 13.4 Código en GitHub

| Dato | Valor |
|---|---|
| Repositorio / rama | `gratitudysanacion/claude-set-up-claude-on-a-project`, rama `claude/gracious-ptolemy-qm2mvv`, carpeta `isamor-ai/` (76 archivos) |
| Cuenta | Conexión con GitHub con la cuenta `gratitudysanacion` (correo [correo-redactado]) |
| Commit | `f93308f` (2 nov). **Sin Pull Request**, por decisión de la usuaria |
| Incidente | El envío falló con 403 ("GitHub authentication required" y luego "Claude doesn't have GitHub access…") hasta instalar la app de Claude en esa cuenta para el repositorio. Reintentar no sirve; la solución fue de permisos |
| Contenido | Código, 225 pruebas, scripts de despliegue, pruebas de navegador, panel (referencia), v1 original y documentos. **Sin secretos**; en la copia del repositorio se redactan IP, huellas de llaves, nombre completo y correo |
| Pendiente | Comprobar si el repositorio es privado (no se pudo verificar) y subir los cambios posteriores. Se entregó además un `.zip` de respaldo |

### 13.5 Incidentes y lecciones del 1 y 2 de noviembre

1. **El asistente de pruebas se cayó solo dos veces** (proceso `77825` y otro, sin causa registrada: el registro se sobrescribe al reiniciar). Desde entonces se arranca con `setsid` y se guarda el registro antes de reiniciar si vuelve a ocurrir.
2. **Túnel cerrado** → `ERR_CONNECTION_REFUSED` en `localhost:3082`; no era la clave. Si el túnel abre y aun así hay `Connection refused`, el proceso del servidor no está escuchando.
3. **Navegador con clave guardada** (icono de llave) puede autocompletar una clave vieja: probar en una ventana de incógnito.
4. El menú **Usuarios** aparece solo después de iniciar sesión dentro de un módulo; no es evidente. Mejora anotada.
5. `$!` con `setsid` no da el PID de `node`: se usa `pgrep -f`.
6. El script `crear-usuario.js` ahora conserva rol, estado y demás campos (`fusionarRegistro`).

### 13.6 Pendientes (2 nov, noche)

| Prioridad | Pendiente | Responsable |
|---|---|---|
| **Plazo 5 nov** | C12: comprobar págs. 26, 56, 66 y 113 del PDF; decidir "compra especial" (60099, 60100, 60121, 60124); convertir con `--aprobar`, ensayo, programar y reiniciar producción | Usuaria y Claude |
| **Antes del 3 nov** | Subir a GitHub los documentos actualizados y lo posterior al commit `f93308f` | Claude |
| Gestor | Entrega 14 (pantallas) y luego redacción asistida; Node 22 para producción, llave propia, respaldo consistente de SQLite y revisión legal | Claude y usuaria |
| Producción | Ajustar módulos de `admin` (hoy cuatro); comprobar el respaldo de las 08:00 UTC con el código nuevo | Usuaria |
| Seguridad | Nginx (`autorizo nginx`); 60 actualizaciones y 1 no instalada; Node 18 sin soporte; hallazgos A y B del panel; limpieza de `/root/panel-staging`, `known_hosts` y copias `v3-antes-*`; Git en el servidor; verificar que el repositorio de GitHub sea privado | Usuaria y Claude |
| Usuaria | Copia fuera del PC de la llave SSH y su frase; claves en el gestor de contraseñas; `baseline-20261026`; instantáneas en hPanel; desglose de Costo de la consola; `chmod 600` a `data/gestor.db*` en pruebas | Usuaria |

## 14. Registro de cambios aplicados al servidor (1 y 2 nov 2026)

Los comandos de reversión se dan siempre en un mensaje aparte (regla 8).

| Cambio | Reversión |
|---|---|
| `/opt/yanbal-assistant` pasa de la v1 a la v2 (código); datos nuevos `data/catalogo_lectura.json` (437), `data/campana.json`, `data/usuarios.json`, `.env` (sin variables `GESTOR_*`); PM2 guardado | `deploy/revertir.sh` restaura la v1 desde `/root/respaldos-manuales/asistente-v1-20261102-015110` |
| Actualización a la versión con administración de usuarios (solo código) | `deploy/revertir-actualizacion.sh` restaura desde `/root/respaldos-manuales/asistente-v2-antes-20261102-031746`; los usuarios vuelven al estado de ese respaldo |
| Usuario `admin` de producción: clave restablecida, rol `admin`, módulos | Desde el módulo Usuarios |
| `/root/produccion-v2/`, `/root/actualizacion-usuarios/`, `/root/paquetes-despliegue/` (paquetes y scripts) | Borrar las carpetas, con autorización |
| Servidor de pruebas: Entrega 13 (`v3-antes-13`), usuario `admin` con clave restablecida y usuario `isamor` de prueba, reinicios con Node 22 | Restaurar `v3-antes-13` o desactivar el usuario de prueba desde el módulo Usuarios |
| `data/usuarios.json.anterior` (copia automática de la versión previa en cada cambio de usuarios) | Es parte del diseño; no borrar |

El panel, Gratitud, Nginx, UFW y el cron de respaldo **no se tocaron** en esta etapa.

## 15. Avance del 2 de noviembre de 2026 (tarde): Entrega 14

| Tema | Estado |
|---|---|
| Decisiones de la usuaria sobre el C12 | Páginas 26 y 56: precios correctos (las 14 filas "Revisar" se aprueban con `--aprobar`). 5104 y 43891 solo se venden dentro de su set. 60099/60100 (Kids/Baby) y 60124 (3 jabones Eau Vitale): **compra especial**. 60121: condición de compra aún sin confirmar |
| Regla "compra especial" | Implementada: tipo de promoción propio, sin "falta el precio normal", aclaración obligatoria ("solo aplica con la compra de un producto; no se vende suelto") en el asistente comercial (verificador + ficha de respaldo) y en el Estudio de contenido (nueva violación `compra_especial_sin_aclarar`) |
| Conversor | `--correcciones` (ver `GUIA_CARGA_CAMPANA.md`, sección 6b) |
| Pruebas | 236 automáticas (Node 18 y 22), 9 de 9 mutaciones detectadas, ensayo de actualización de producción 19/19 |
| Resultado sobre el Excel real | 451 productos tras correcciones (6 filas tocadas), 3 compras especiales, 22 promociones 2 x 1, 11 obsequios, 2 sets sin precio propio |
| Entrega 14 en pruebas | Instalada y verificada (212 aprobadas con Node 18, 24 del Gestor omitidas; 236 con Node 22). Pruebas en navegador con el C12 simulado vigente: 60099, 60124, 60121, 5104 y Zentro correctos |
| 60121 | Es la "Bolsa de Regalo" a $3.000 sin condición de compra: producto normal con solo precio de oferta (no es compra especial) |
| Producción | Código actualizado el 2 nov (respaldo `asistente-v2-antes-20261102-043236`; `server.js` sin cambio, huella `21f6d973…`). C12 programado (451 productos, 7 nov al 4 dic 2026) y servicio reiniciado el 2 nov: el registro confirma "Campaña siguiente programada". Entra sola a las 00:00 del 7 nov |
| Pendiente | Tras el 7 nov: probar 3 consultas reales y ejecutar `cargar-campana.js --promover --aplicar` en producción. Servidor de pruebas: volver al arranque normal (hoy corre con el C12 simulado mediante `CATALOGO_LECTURA` y `CAMPANA`). Hardening: `campana.json` y `catalogo.json` de producción están en 644 |
| Gestor de ventas: pantallas (Entregas 15 y 15b) | Implementadas e instaladas en pruebas el 2 nov: clientas, etapas con historial, recordatorios, consentimiento obligatorio, exportar y borrar, soporte de solo lectura para la administradora. 17 comprobaciones de navegador, 236 pruebas automáticas. Probadas por la usuaria en pruebas: "funciona". Errores hallados en la prueba manual: la palabra "null" en pantalla (corregida en 15b y cubierta por una prueba). Pendiente solo en pruebas; NO en producción |
| Para llevar el Gestor a producción | Node 22 para `yanbal-assistant` (hoy Node 18 del sistema); llave propia `GESTOR_LLAVE` creada en el servidor, sin copiar la de pruebas; copia de seguridad consistente de `gestor.db` (no basta copiar archivos con la base abierta); `chmod 600 data/gestor.db*`; revisión legal del texto de consentimiento (habeas data); asignar el módulo `manager` a las usuarias; plan de reversión |
| Respaldo de la base del Gestor (Entregas 16 y 16b) | Diseño aprobado (`DISENO_RESPALDO_GESTOR_v1.md`), scripts instalados y ensayados en pruebas; el cron y la exclusión del `tar` de `respaldo-yanbal.sh` se hacen al pasar el Gestor a producción |

## 16. Cierre del 2 de noviembre de 2026 y plan para continuar el 3 de noviembre

| Frente | Estado al cierre |
|---|---|
| Producción | v2 con Comercial, Contenido y administración de usuarios; Entrega 14 (compra especial) instalada; **C12 programado**, entra solo el 7 nov 00:00 |
| Pruebas | Con el Gestor completo (pantallas, respaldo y restauración), 248 pruebas; corre con el C12 simulado vigente |
| Repositorio | Código y documentos al día en GitHub, sin Pull Request; redacción corregida tras un error propio (ver `CLAUDE.md`) |
| Bloqueo para usar clientas reales | Revisión legal del consentimiento (habeas data) |

**Orden recomendado para mañana:** (1) comprobar el respaldo de las 08:00 UTC; (2) consulta normal en producción; (3) decidir la revisión legal; (4) preparar el paso del Gestor a producción solo cuando (3) esté resuelto; (5) el 7 u 8 nov, 3 consultas con el C12 y luego `--promover`. La lista completa está en `CLAUDE.md`, sección "Siguiente paso inmediato".

## 17. Fase A del Gestor en producción (4 de noviembre de 2026)

| Paso | Estado |
|---|---|
| A2 código nuevo (pantallas y scripts de respaldo) | Hecho con `actualizar.sh` (respaldo `asistente-v2-antes-20261104-014631`) |
| A3 llave propia | Hecha; **rotada** porque la primera se pegó en el chat (sin datos cifrados que perder) |
| A4 Node 22 | Hecho; prueba previa en el puerto 3085, PM2 id 3 |
| A5 y A6 respaldo | Exclusión en el `tar`, cron y primer respaldo (0 clientas) |
| Módulo `manager` | Quitado a `admin`; ninguna usuaria lo tiene |
| Respaldo de las 08:00 UTC | Verificado el 4 nov: 232.958 bytes, incluye `usuarios.json` y `campana_siguiente.json` |
| Consulta normal en producción | Correcta con C11 (670) |
| Hallazgo | El Bloque 0 de seguridad (módulo `manager` en `admin`) salió con el módulo presente y se continuó; se corrigió de inmediato sin datos en riesgo (0 clientas) |

Siguiente: revisión legal del consentimiento (bloquea la Fase B), consultas del C12 el 7 u 8 nov y `--promover`.

## 18. Redacción asistida y «Mi estilo» (4 de noviembre de 2026, tarde y noche)

| Tema | Estado |
|---|---|
| Decisiones de la usuaria | Alcance: seguimiento, recordatorios y respuestas a clientas; acepta enviar notas enmascaradas a Anthropic (condicionado al abogado); límite mensual de 10 USD; pidió un selector de estilo y luego «Mi estilo», español natural y aviso de promesas |
| Entregas 17, 17b, 17c | En pruebas; no en producción. 300 pruebas; 12 de 12 roturas intencionales detectadas en lo último |
| Medición real | ~0,0003 USD por borrador con Haiku 5.5 |
| Esquema de la base | Versión 2 (tabla `estilos`), migrada en pruebas el 4 nov con respaldo previo y 1 clienta conservada |
| Hallazgos de la sesión | El nombre de la clienta podía abrir etiquetas en el mensaje al modelo (corregido); el «null» en pantalla (15b); el tamaño de las pestañas (16 px frente a 12-13 px); un borrador con «regalo» y «consentirte» llevó a verificar promesas por código; un choque de nombres en la restauración dentro del mismo segundo (16b) |
| Pendientes | Probar «Mi estilo» con mensajes reales de la usuaria; subir el límite de la organización en la consola; revisión legal; Fase B; llevar 17 a 17c a producción con respaldo previo |

## 19. C12 promovido a campaña actual (10 de noviembre de 2026)

| Tema | Estado |
|---|---|
| Vigencia | El C12 entró solo el 7 de noviembre a las 00:00 (confirmado por la usuaria: «ya está funcionando») |
| Promoción | `cargar-campana.js --promover --aplicar` el 10 nov (hora de Colombia: noche del 9): el C11 quedó respaldado en `data/campanas-anteriores/20261110001642-2026-11-09`; `campana.json` y `catalogo_lectura.json` son ahora del C12 (451 productos) y ya no hay archivos `*_siguiente.json` |
| Reinicio | `pm2 restart yanbal-assistant` el mismo día; salud con 451 productos, Node 22.22.0, Gestor activo |
| Permisos | `campana.json` y `catalogo_lectura.json` quedaron en 600 (antes `campana.json` estaba en 644) |
| Siguiente campaña | Procedimiento de `GUIA_CARGA_CAMPANA.md` (programar con fecha de inicio, reiniciar para cargar, promover después) |
