# CLAUDE.md — Proyecto ISAMOR AI · Plataforma comercial Yanbal

> Archivo de contexto para Claude Code. Colócalo en la raíz de la carpeta de trabajo del proyecto junto a los demás .md.
> Fecha de corte del contexto: 30 de octubre de 2026 (noche). Actualizado tras construir y probar en el servidor de pruebas el Asistente comercial, el Estudio de contenido y el motor del Gestor de ventas, y tras preparar la carga del catálogo C12.

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
Cuatro módulos, en este orden en el menú lateral: 1 Asistente comercial, 2 Asesor de belleza, **3 Estudio de contenido**, 4 Gestor de ventas.

**Estado real (30 oct 2026):**
- **PRODUCCIÓN** (`yanbal-assistant`, puerto 3080): sigue la versión ORIGINAL v1 (solo interfaz, sin IA). Despliegue de la v2 previsto el **lunes 2 de noviembre**.
- **PRUEBAS** (`/root/asistente-v2-pruebas/v3`, puerto 3082 solo localhost, Node 22): v2 con 207 pruebas automáticas aprobadas.
  - Módulo 1 Asistente comercial: **construido y aprobado** (IA Haiku 5.5, herramientas de catálogo, verificador, respaldo determinista).
  - Módulo 3 Estudio de contenido: **construido y aprobado** (reglas de marca verificadas por código).
  - Módulo 4 Gestor de ventas: **motor construido y activo en pruebas** (SQLite cifrada, API, permisos); **faltan pantallas** y la redacción asistida.
  - Módulo 2 Asesor de belleza: **bloqueado**: faltan datos oficiales de productos.
- Detalle y cronología: `ESTADO_PROYECTO_Y_PENDIENTES.md` (sección 11) y `DISENO_TECNICO_ASISTENTE_v1.md`.

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
  - `/opt/node22/` → Node 22.22.0 (instalado con verificación de 3 huellas). `/root/descargas-node/` → su descarga.
  - `/root/c12-entrada/` → catálogo C12: `c12.pdf` (17,9 MB), `Catalogo_Yanbal_C12_2026_Precios.xlsx` (huella `e722e7de…901f593`) y scripts auxiliares.
- **Acceso SSH (desde el 26 oct):** solo por llave ed25519 con passphrase (la privada vive en el PC de la usuaria, nunca se comparte ni se pega). Contraseña desactivada y `root` solo con llave. fail2ban activo (jail `sshd`, lista blanca `127.0.0.1/8`, `::1`, `169.254.0.0/16`).
  - Configuración propia en `/etc/ssh/sshd_config.d/01-endurecimiento.conf` (se lee antes que los de cloud-init; no editar esos). La llave de la usuaria está en `/root/.ssh/authorized_keys_cris`.
  - **Acceso de rescate:** terminal del navegador de hPanel (entra desde `169.254.0.1`). **Hostinger reescribe `/root/.ssh/authorized_keys` en cada sesión de esa terminal**: no poner llaves propias ahí y **no quitarlo** de `AuthorizedKeysFile`.
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
17. **El modelo redacta, el código decide.** Precios, vigencias, 2x1, obsequios y sets se calculan y verifican en código; si el modelo incumple, se reintenta con la corrección exacta o se entrega una ficha determinista.
18. **Precios del catálogo:** un catálogo nuevo nunca se carga sin pasar por la auditoría (`auditar-catalogo`), el ensayo de `cargar-campana.js` (sin `--aplicar`) y la revisión de filas "Revisar". Las filas que la herramienta no pudo comprobar contra el texto del PDF se aprueban **por código y solo después de comprobarlas a mano contra el catálogo** (`--aprobar`).

## Dónde está el trabajo pendiente
- Estado, hallazgos de seguridad y plan de acción: `ESTADO_PROYECTO_Y_PENDIENTES.md`
- Arquitectura, módulos y fases: `CONTEXTO_TECNICO_Y_DISENO.md`
- Diseño técnico del Asistente comercial (hallazgos del asistente actual, interfaz, API, seguridad, estructura de archivos y estado de la construcción): `DISENO_TECNICO_ASISTENTE_v1.md`
- Diseño del Asistente comercial (MVP, API de solo lectura, reglas, pruebas): `DISENO_ASISTENTE_COMERCIAL_v1.md` (aprobado el 27 oct 2026; incluye la sección 15 con los cambios posteriores)
- Diseño del Gestor de ventas (modelo de datos, cifrado, permisos, consentimiento, plan): `DISENO_GESTOR_VENTAS_v1.md` (aprobado el 30 oct 2026)
- Procedimiento de carga de una campaña nueva (C12 y siguientes): `GUIA_CARGA_CAMPANA.md`

## Siguiente paso inmediato (30 oct 2026)

**Fechas que mandan:** lunes 2 nov despliegue del módulo 1 a producción · martes 3 nov vencen los créditos de Claude en la nube de la usuaria · viernes 6 nov termina la campaña C11 · **sábado 7 nov 00:00 (Colombia) entra el C12** (hasta el 4 dic).

1. **C12 (bloquea el 7 nov):** la usuaria debe comprobar contra el PDF las páginas 26 y 56 (14 filas "Revisar") y las páginas 66 y 113 (5104 y 43891: ¿solo dentro del set?), y decidir la "compra especial" (60099, 60100, 60121, 60124). Luego: convertir con `--aprobar`, ensayo, programar. Ver `GUIA_CARGA_CAMPANA.md`.
2. **Despliegue del lunes 2:** paquete final congelado + `deploy/desplegar.sh` y `revertir.sh` (ensayados 22/22), con la frase de autorización por paso. El C12 solo entra solo si el servidor de producción ya tiene el código v2.
3. **Guardar el código en la rama del repositorio** (hoy solo existe en el entorno de trabajo y en el servidor de pruebas) y actualizar estos documentos. Antes del 3 nov.
4. **Gestor de ventas:** Entrega 13 (pantallas) y 14 (redacción asistida e indicadores). Antes de activarlo en producción: llave propia de producción, respaldo consistente de la base SQLite y revisión legal del consentimiento.
5. Seguridad pendiente: Nginx (`autorizo nginx`), 60 actualizaciones (sin pasar a Ubuntu 26.04) y 1 no instalada, hallazgos A y B del panel, limpieza de `/root/panel-staging/`, `known_hosts` y copias `v3-antes-*`, Git en el servidor.

**Pendientes de la usuaria:** copia fuera del PC de `isamor_ed25519` y su passphrase; `ADMIN_USER`/`ADMIN_PASSWORD` y la llave del Gestor en el gestor de contraseñas; descargar `baseline-20261026`; instantáneas en hPanel; desglose de **Costo** en la consola de Anthropic (¿quién consumió ~0,43 USD del límite de 3 USD?); `chmod 600` a `data/gestor.db*` en pruebas.
