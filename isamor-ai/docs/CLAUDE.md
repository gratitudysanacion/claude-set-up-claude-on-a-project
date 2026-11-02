# CLAUDE.md — Proyecto ISAMOR AI · Plataforma comercial Yanbal

> Archivo de contexto para Claude Code. Colócalo en la raíz de la carpeta de trabajo del proyecto junto a los demás .md.
> Fecha de corte del contexto: **2 de noviembre de 2026**. El Asistente comercial, el Estudio de contenido y la administración de usuarios **están en producción**; el motor del Gestor de ventas está activo solo en pruebas; el catálogo C12 está preparado pero sin cargar.

## Idioma y estilo de trabajo
- Responder siempre en español neutro.
- Estilo ejecutivo, directo, sin frases de relleno. Actuar como arquitecto de software / consultor senior.
- Etiquetar el nivel de confianza de las afirmaciones: [Seguro] / [Probable] / [Suponiendo].
- Diferenciar siempre hecho, recomendación y opinión.
- Preferir decisiones concretas antes que listas abiertas de opciones; pasos numerados, sin asumir conocimiento previo.
- La usuaria ("Cris") es Ingeniera de Sistemas con +25 años de experiencia; evitar explicaciones básicas de arquitectura, pero sí dar instrucciones paso a paso en operaciones de servidor.
- Código siempre listo para producción (seguridad, mantenibilidad, modularidad).

## Qué es el proyecto
Plataforma comercial asistida por IA para consultoras de venta por catálogo. Se inicia con Yanbal, pero debe poder extenderse a cualquier empresa de catálogo (esquema multi-empresa).
Cuatro módulos, en este orden en el menú lateral: 1 Asistente comercial, 2 Asesor de belleza, **3 Estudio de contenido**, 4 Gestor de ventas, más **Usuarios** (quinto elemento, visible solo para administradoras). El inicio de sesión vive **dentro de cada módulo** (no en la pantalla de inicio): el menú Usuarios aparece después de iniciar sesión.

**Estado real (2 nov 2026):**
- **PRODUCCIÓN** (`yanbal-assistant`, puerto 3080, Node 18, tras Nginx en `yanbal.gratitudysanacion.com`): **v2 desplegada el 2 nov** (IA Haiku 5.5, módulos Asistente comercial y Estudio de contenido, **administración de usuarios**), con el Gestor de ventas desactivado. `server.js` = `21f6d973…`. La v1 original quedó respaldada en `/root/respaldos-manuales/asistente-v1-20261102-015110`.
- **PRUEBAS** (`/root/asistente-v2-pruebas/v3`, puerto 3082 solo localhost, Node 22): la misma v2 con el Gestor activo; 225 pruebas automáticas aprobadas.
  - Módulo 1 Asistente comercial: **construido y aprobado** (IA Haiku 5.5, herramientas de catálogo, verificador, respaldo determinista).
  - Módulo 3 Estudio de contenido: **construido y aprobado** (reglas de marca verificadas por código).
  - Módulo 4 Gestor de ventas: **motor construido y activo en pruebas** (SQLite cifrada, API, permisos); **faltan pantallas** (`public/gestor.js` está a medias y no se carga) y la redacción asistida.
  - Administración de usuarios (menú **Usuarios**, solo administradoras): **en producción**. Ver `DISENO_ADMIN_USUARIOS_v1.md`.
  - Módulo 2 Asesor de belleza: **bloqueado**: faltan datos oficiales de productos.
- Detalle y cronología: `ESTADO_PROYECTO_Y_PENDIENTES.md` (secciones 11 y 13) y `DISENO_TECNICO_ASISTENTE_v1.md`.

## Entorno
- VPS Hostinger, Ubuntu 24.04, usuario root. Node.js 18.19.1 (del sistema; **sin soporte desde abril de 2025**), **Node 22.22.0 en paralelo en `/opt/node22`** (solo para el asistente v2 y el Gestor; no reemplaza al de sistema), npm 9.2.0, Python 3.12.3, Nginx 1.24.0, PM2.
- Apps en /opt:
  - `/opt/gratitud/app/` → Gratitud y Sanación (PM2 `gratitud`, puerto 3000, gratitudysanacion.com). Tiene Git.
  - `/opt/yanbal-assistant/` → Asistente (PM2 `yanbal-assistant`, 3080 localhost, yanbal.gratitudysanacion.com). Node http nativo, ~110 líneas.
  - `/opt/yanbal-admin-starter/yanbal-admin-starter/` → Panel admin (PM2 `yanbal-admin`, 3081 localhost, admin-yanbal.gratitudysanacion.com). Catálogo en `data/catalogo.json`.
  - `/opt/respaldos-yanbal/` → respaldos diarios (cron 08:00 UTC).
  - `/opt/DOCUMENTACION_ISAMOR_AI/` → documentación técnica central.
  - `/opt/cursos/` → vacío.
  - `/root/respaldos-manuales/` → respaldos manuales previos a cambios (p. ej. `login-20261026/server.js.original`). No lo rota el cron.
  - `/root/panel-staging/` → copia de prueba del login nuevo del panel (datos ficticios). Se retira con autorización tras aplicar el paso 4.
  - `/root/asistente-v2-pruebas/v3/` → **asistente v2 en pruebas** (puerto 3082, localhost). Copias de respaldo previas a cada entrega: `v3-antes-*`. Se arranca con `nohup` desde su carpeta (el `cd` en línea aparte, para que `$!` guarde el PID real en `pid-pruebas`); registro en `server-pruebas.log`. Contiene `.env` (llave de IA y llave de cifrado del Gestor), `data/usuarios.json` y `data/gestor.db`.
  - `/root/respaldos-manuales/asistente-v1-20261102-015110` (v1 original) y `…/asistente-v2-antes-20261102-031746` (v2 previa a la administración de usuarios): respaldos completos con sus `.sha256`. `/root/produccion-v2/`, `/root/actualizacion-usuarios/` y `/root/paquetes-despliegue/` guardan los paquetes usados; no se borran sin autorización.
  - `/opt/node22/` → Node 22.22.0 (instalado con verificación de 3 huellas). `/root/descargas-node/` → su descarga.
  - `/root/c12-entrada/` → catálogo C12: `c12.pdf` (17,9 MB), `Catalogo_Yanbal_C12_2026_Precios.xlsx` (huella `e722e7de…901f593`) y scripts auxiliares.
- **Acceso SSH (desde el 26 oct):** solo por llave ed25519 con passphrase (la privada vive en el PC de la usuaria, nunca se comparte ni se pega). Contraseña desactivada y `root` solo con llave. fail2ban activo (jail `sshd`, lista blanca `127.0.0.1/8`, `::1`, `[IP-REDACTADA]/16`).
  - Configuración propia en `/etc/ssh/sshd_config.d/01-endurecimiento.conf` (se lee antes que los de cloud-init; no editar esos). La llave de la usuaria está en `/root/.ssh/authorized_keys_cris`.
  - **Acceso de rescate:** terminal del navegador de hPanel (entra desde `[IP-REDACTADA]`). **Hostinger reescribe `/root/.ssh/authorized_keys` en cada sesión de esa terminal**: no poner llaves propias ahí y **no quitarlo** de `AuthorizedKeysFile`.
  - Ubuntu 26.04.1 aparece disponible: **no actualizar** (cambiaría Node, Nginx y Python).
- La usuaria trabaja desde Windows. Desde el 30 oct usa **PowerShell** (`PS C:\Users\USUARIA>`; variable `$env:USERPROFILE`) y la terminal del navegador de hPanel (`root@srv1779034`). Túnel a pruebas: `ssh -N -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -i "$env:USERPROFILE\.ssh\isamor_ed25519" -L 3082:127.0.0.1:3082 root@[IP-REDACTADA]` y abrir `http://localhost:3082`.
- **Desde mi entorno (Claude) no se puede leer ni escribir en el servidor**: solo se ve lo que la usuaria pega. Los archivos del servidor se procesan con scripts que ella ejecuta allí; los adjuntos del chat (p. ej. el Excel del C12) sí llegan al entorno de Claude.

## REGLAS NO NEGOCIABLES
1. NO modificar Gratitud y Sanación (código, configuración ni servicio) sin autorización expresa.
2. Conservar el asistente original y sus respaldos; todo cambio requiere autorización explícita y plan de reversión.
3. NO importar, corregir ni eliminar los 437 productos del catálogo sin autorización. La importación masiva está pausada.
4. NUNCA mostrar, copiar ni imprimir secretos (`.env`, contraseñas, claves, `dump.pm2`). No ejecutar comandos que impriman su contenido.
5. La IA NO debe inventar precios, vigencias, ingredientes ni beneficios.
6. El asistente nunca recibe credenciales admin; solo accede al catálogo mediante API de SOLO LECTURA.
7. No borrar nada (respaldos, carpetas antiguas) hasta tener Git y restauración probada.
8. Ningún comando de borrado o reversión va junto a comandos que se quieren ejecutar (incidente del 26 oct).
9. Metodología: auditar (solo lectura) → diseñar → validar → implementar, pidiendo autorización antes de cada cambio en el servidor. Mantener una sesión SSH abierta mientras se prueban cambios de acceso.
10. Indicar siempre **en qué ventana** se ejecuta cada comando (PC `C:\Users\...>` frente a servidor `root@srv...`) y cómo reconocerla. Los comandos con `%USERPROFILE%` o `C:\` son del PC.
11. Verificar siempre: hash tras transferir un archivo; valor efectivo (no solo el archivo) tras recargar un servicio; huella de una llave antes de habilitarla. Las llaves públicas se transfieren con `scp`, no por portapapeles. El código se entrega en bloques base64 con hash esperado.
12. Cambios de código de producción: respaldo con hash → prueba en copia aislada con datos y credenciales ficticias (también en el Node del servidor) → autorización explícita → aplicar con reversión lista. No usar `pm2 restart --update-env` sin necesidad.
13. No usar la importación masiva ni `/api/import/confirm` aunque esté disponible: sigue pausada por decisión de la usuaria.
14. **Autorización explícita por escrito** (`autorizo entrega N`, `autorizo nginx`, `autorizo activar gestor`...) antes de cada cambio en el servidor. Una frase dada para una entrega que la usuaria aún no ha visto no vale; se confirma al entregar el paquete. Si pega un paquete sin la frase, se anota y se pide para la próxima.
15. **Marca (decisión de la usuaria):** prohibido prometer milagros, curas o resultados; los textos para redes llevan descripción y hashtags; **los precios van en los textos**, solo los del catálogo y con su vigencia. Esto lo verifica el código (`contenido.js`), no solo las instrucciones al modelo.
16. **Datos personales (Gestor de ventas):** teléfono, cédula, dirección y notas van **cifrados** (AES-256-GCM); la IA solo recibe el primer nombre y las notas enmascaradas; nada se envía sin consentimiento registrado. La administradora **puede leer** los datos de otras usuarias (soporte) y cada lectura queda registrada; **no puede modificarlos**. La llave de cifrado NO está en el respaldo diario: se guarda en el gestor de contraseñas de la usuaria. Nunca se pega en un chat.
17. **El modelo redacta, el código decide.** Precios, vigencias, 2x1, obsequios, compras especiales y sets se calculan y verifican en código; si el modelo incumple, se reintenta con la corrección exacta o se entrega una ficha determinista.
18. **Precios del catálogo:** un catálogo nuevo nunca se carga sin pasar por la auditoría (`auditar-catalogo`), el ensayo de `cargar-campana.js` (sin `--aplicar`) y la revisión de filas "Revisar". Las filas que la herramienta no pudo comprobar contra el texto del PDF se aprueban **por código y solo después de comprobarlas a mano contra el catálogo** (`--aprobar`).
19. **Producción se actualiza con `deploy/actualizar.sh`** (v2 → v2) o `deploy/desplegar.sh` (v1 → v2): verifican la huella de `server.js` esperada, corren las pruebas del paquete, hacen respaldo completo, no tocan `.env`, usuarios, catálogo ni campaña, verifican la salud y guardan PM2. La reversión (`revertir-actualizacion.sh` / `revertir.sh`) se entrega **en un mensaje aparte**. Procedimiento: `GUIA_DESPLIEGUE_Y_ACTUALIZACION.md`.
20. **El servidor de pruebas se arranca separando el `cd`** y con `setsid` (`PORT=3082 setsid nohup /opt/node22/bin/node src/server.js > server-pruebas.log 2>&1 < /dev/null &`), y el PID se guarda con `pgrep`. Se cayó solo dos veces el 2 nov; si ocurre, guardar el registro antes de reiniciarlo (se sobrescribe).
21. **Claves y usuarios:** nunca se pegan claves en un chat. Se cambian desde el módulo Usuarios o con `scripts/crear-usuario.js` (conserva rol y estado desde la Entrega 13). Cinco intentos fallidos por IP en 10 minutos bloquean 15 minutos; reiniciar el asistente limpia el bloqueo.

## Código y GitHub
- **Repositorio:** `gratitudysanacion/claude-set-up-claude-on-a-project`, rama **`claude/gracious-ptolemy-qm2mvv`**, carpeta **`isamor-ai/`** (el resto del repositorio es otro proyecto y no se toca). Primer envío: commit `f93308f` del 2 nov 2026. **Sin Pull Request** (decisión de la usuaria).
- **Cuenta:** la conexión con GitHub es con la cuenta `gratitudysanacion` (correo gratitudysanacion@gmail.com). El envío falló varias veces con 403 hasta instalar la app de Claude en esa cuenta para ese repositorio (https://github.com/apps/claude/installations/select_target).
- **Lo que se sube:** código, pruebas, scripts y documentos **sin secretos** (ni `.env`, usuarios, catálogos, bases de datos ni llaves). En la copia del repositorio se **redactan** las IP, las huellas de llaves, el nombre completo y el correo; las copias completas de los documentos las conserva la usuaria en su PC.
- Pendiente: comprobar si el repositorio es privado (no se pudo verificar) y subir los cambios posteriores al 2 nov.

## Dónde está el trabajo pendiente
- Estado, hallazgos de seguridad y plan de acción: `ESTADO_PROYECTO_Y_PENDIENTES.md`
- Arquitectura, módulos y fases: `CONTEXTO_TECNICO_Y_DISENO.md`
- Diseño técnico del Asistente comercial (hallazgos del asistente actual, interfaz, API, seguridad, estructura de archivos y estado de la construcción): `DISENO_TECNICO_ASISTENTE_v1.md`
- Diseño del Asistente comercial (MVP, API de solo lectura, reglas, pruebas): `DISENO_ASISTENTE_COMERCIAL_v1.md` (aprobado el 27 oct 2026; incluye la sección 15 con los cambios posteriores)
- Diseño del Gestor de ventas (modelo de datos, cifrado, permisos, consentimiento, plan): `DISENO_GESTOR_VENTAS_v1.md` (aprobado el 30 oct 2026)
- Procedimiento de carga de una campaña nueva (C12 y siguientes): `GUIA_CARGA_CAMPANA.md`
- Administración de usuarios (diseño, API, salvaguardas): `DISENO_ADMIN_USUARIOS_v1.md`
- Despliegue, actualización, reversión y servidor de pruebas: `GUIA_DESPLIEGUE_Y_ACTUALIZACION.md`

## Siguiente paso inmediato (2 nov 2026)

**Fechas:** martes 3 nov vencen los créditos de Claude en la nube de la usuaria · viernes 6 nov termina la campaña C11 · **sábado 7 nov 00:00 (Colombia) entra el C12** (hasta el 4 dic).

1. **C12 (plazo real: jueves 5 nov):** la usuaria debe comprobar contra el PDF las páginas 26 y 56 (14 filas "Revisar") y las páginas 66 y 113 (5104 y 43891: ¿solo dentro del set?), y decidir la "compra especial" (60099, 60100, 60121, 60124). Luego: convertir con `--aprobar`, ensayo, programar y reiniciar el asistente de producción (la campaña siguiente se lee al arrancar). Producción **ya tiene la v2**, así que puede entrar sola. Ver `GUIA_CARGA_CAMPANA.md`.
2. **Documentación y código al repositorio:** subir los cambios posteriores al commit `f93308f`.
3. **Gestor de ventas:** terminar las pantallas (Entrega 14) y luego la redacción asistida. Antes de activarlo en producción: Node 22 para `yanbal-assistant`, llave propia, respaldo consistente de la base SQLite y revisión legal del consentimiento.
4. **Producción, ajustes menores:** el usuario `admin` de producción tiene los cuatro módulos; ajustarlo desde el módulo Usuarios si se desea. Comprobar el respaldo automático de las 08:00 UTC con el código nuevo.
5. Seguridad pendiente: Nginx (`autorizo nginx`), 60 actualizaciones (sin pasar a Ubuntu 26.04) y 1 no instalada, Node 18 sin soporte, hallazgos A y B del panel, limpieza de `/root/panel-staging/`, `known_hosts` y copias `v3-antes-*`, Git en el servidor.
6. Mejora de interfaz anotada: un acceso de inicio de sesión visible desde la pantalla de inicio.

**Pendientes de la usuaria:** copia fuera del PC de `isamor_ed25519` y su passphrase; `ADMIN_USER`/`ADMIN_PASSWORD` del panel, la clave de `admin` del asistente y la llave del Gestor en el gestor de contraseñas; descargar `baseline-20261026`; instantáneas en hPanel; desglose de **Costo** de la consola de Anthropic (~0,43 USD sin explicar); `chmod 600` a `data/gestor.db*` en pruebas; respuestas del C12.

### Regla de negocio: compra especial (aprobada por la usuaria el 2 nov 2026)
Un artículo cuya promoción empieza por "Compra especial", con precio de oferta y sin precio normal, solo se adquiere con la compra de un producto y **no se vende suelto**. Cada vez que el asistente o el Estudio de contenido citen su precio deben aclararlo en el mismo texto; el código lo verifica (`verificarCompraEspecial`) y, si falta, entrega la ficha del catálogo, que siempre lo dice.
