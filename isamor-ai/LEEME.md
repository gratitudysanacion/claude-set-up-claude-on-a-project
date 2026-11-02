# ISAMOR AI · Plataforma comercial Yanbal

> Esta carpeta contiene el proyecto ISAMOR AI. El resto del repositorio (`server.js`, `routes/`, `db/`, `tests/` en la raíz) es **otro proyecto** y no se ha tocado.
> **No contiene secretos**: ni `.env`, ni `usuarios.json`, ni catálogos, ni bases de datos, ni llaves. En los documentos se redactaron direcciones IP, huellas de llaves y datos personales; los originales completos los conserva la persona responsable del proyecto.

Estado al **2 de noviembre de 2026**.

## Qué hay aquí

| Carpeta | Contenido |
|---|---|
| `asistente-v2/` | Código del asistente (Node, sin dependencias, CommonJS). `src/` servidor y reglas, `public/` interfaz, `scripts/` herramientas de administración, `test/` pruebas, `deploy/` actualización y reversión de producción |
| `docs/` | Documentos del proyecto (`CLAUDE.md` es el punto de entrada). Última actualización de fondo: 30 oct; ver "Qué falta documentar" |
| `verificacion/` | Pruebas de navegador (Playwright) y ensayos de despliegue/actualización con réplicas locales |
| `panel/` | Copia del código del panel de administración de catálogo (con el login endurecido del 26 oct), solo como referencia |
| `asistente-original/` | La versión v1 del asistente (solo interfaz) que existía antes; se conserva por regla del proyecto |

## Cómo comprobar el código

```
cd isamor-ai/asistente-v2
npm test                                   # Node 22: 225 pruebas; Node 18: 201 pasan y 24 se omiten (las del Gestor requieren SQLite integrado)
```
Las pruebas de navegador (`verificacion/e2e*.js`) necesitan Playwright y se ejecutan aparte.

## Estado de los módulos

| Módulo | Estado |
|---|---|
| 1 Asistente comercial | **En producción** (`yanbal-assistant`, Node 18, puerto 3080 tras Nginx) |
| 3 Estudio de contenido | **En producción** |
| Administración de usuarios (crear, restablecer clave, módulos, inactivar, cambio obligatorio de clave) | **En producción** desde el 2 nov |
| 4 Gestor de ventas | Motor construido y activo **solo en pruebas** (Node 22, SQLite cifrada). `public/gestor.js` (pantallas) está **a medias y no se carga todavía** |
| 2 Asesor de belleza | Bloqueado: faltan datos oficiales de productos |

## Principios

- El modelo redacta, el código decide: precios, vigencias, 2 x 1, obsequios y sets se calculan y verifican en código.
- Cero dependencias en tiempo de ejecución.
- Datos personales cifrados (AES-256-GCM); la IA solo recibe datos enmascarados.
- Cada cambio en el servidor lleva respaldo, plan de reversión y autorización expresa.

## Qué falta documentar / hacer

- Los documentos de `docs/` aún no recogen por completo la Entrega 13 (administración de usuarios), el despliegue del 2 nov (`deploy/actualizar.sh`) ni el estado final de producción.
- Pantallas del Gestor de ventas y su redacción asistida por IA.
- Carga del catálogo C12 (ver `docs/GUIA_CARGA_CAMPANA.md`).
