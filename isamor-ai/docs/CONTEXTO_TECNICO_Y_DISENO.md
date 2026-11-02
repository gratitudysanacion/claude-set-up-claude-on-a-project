# ISAMOR AI – Plataforma comercial Yanbal
## Contexto técnico, diseño y plan por fases

> No contiene contraseñas, claves ni valores de variables de entorno.

## 1. Objetivo
Convertir la interfaz actual en una plataforma comercial asistida por IA para consultoras de Yanbal (extensible a otras empresas de catálogo): atraer, asesorar, vender, fidelizar y medir. Prioridad: revisar, diseñar, validar y solo después implementar, con autorización previa a cambios en el servidor.

## 2. Infraestructura confirmada
| Componente | Tecnología / configuración |
|---|---|
| SO | Ubuntu Server 24.04.4 LTS |
| Runtime | Node.js 18.19.1 (sistema; sin soporte desde abril de 2025), npm 9.2.0. **Node 22.22.0 en paralelo en `/opt/node22`** (30 oct) para el asistente v2 y el Gestor: `node:sqlite` integrado y cero dependencias |
| Python | 3.12.3 |
| Web | Nginx 1.24.0 (HTTPS, proxy inverso) |
| Procesos | PM2: `gratitud`, `yanbal-assistant`, `yanbal-admin` |
| Backend Yanbal | Módulo nativo `http` de Node.js (sin framework ni dependencias) |
| Base de datos del catálogo | Archivo JSON (`data/catalogo.json`) |
| Acceso SSH | Solo llave ed25519 con passphrase; contraseña desactivada; `root` solo con llave (`/etc/ssh/sshd_config.d/01-endurecimiento.conf`) |
| Protección de SSH | fail2ban 1.0.2, jail `sshd` (5 fallos en 10 min, bloqueo 1 h; lista blanca incluye la terminal de hPanel `169.254.0.0/16`) |
| Acceso de rescate | Terminal del navegador de hPanel (Hostinger reescribe `/root/.ssh/authorized_keys` en cada sesión) |

Esquema: Usuarios → HTTPS → Nginx → Gratitud (3000) / Asistente (3080) / Panel admin (3081). Las tres apps NO están integradas entre sí.

## 3. Aplicaciones
### 3.1 Asistente Yanbal — `/opt/yanbal-assistant/`
- `src/server.js` (~110 líneas), `public/index.html` (~829 líneas), `package.json` (inicio `node src/server.js`, sin dependencias), `data/catalogo.json` (vacío; NO es el catálogo de 437).
- Rutas reales: `GET /health` (indica `ai: not_connected`), `GET /api` (mensaje y 3 nombres de módulos), `GET /` e `/index.html` (interfaz), `GET /yanbal-logo.jpg`, resto → 404.
- No existen rutas para productos, IA, clientes, ventas ni seguimientos. Los 4 módulos son interfaz inicial.
- **Actualización 30 oct:** esto describe el asistente **en producción**. La **v2** (módulos con IA, permisos por usuario, campañas programadas, Gestor de ventas) está construida y aprobada en pruebas (`/root/asistente-v2-pruebas/v3`, puerto 3082) y se despliega el lunes 2 nov. Ver `DISENO_TECNICO_ASISTENTE_v1.md` (sección 10 en adelante) y `ESTADO_PROYECTO_Y_PENDIENTES.md` (sección 11).

### 3.2 Panel administrativo — `/opt/yanbal-admin-starter/yanbal-admin-starter/`
- `server.js` (9.368 bytes; auth por sesión, contraseña admin ≥16 caracteres), `public/index.html` + `public/app.js`, `data/catalogo.json` (catálogo, historial, versión), `data/backups/`, `package.json` (`yanbal-catalog-admin-starter`).
- Funciones: consultar (API protegida), crear/actualizar/eliminar productos, exportar CSV, importar con vista previa, validar campos/precios, respaldo previo a importar, historial.
- Catálogo: 437 registros (396 Válido, 31 Doble, 10 No informado), todos pendientes de revisión. "Válido" ≠ precio/referencia verificados. Importación masiva pausada por decisión de la usuaria.
- Contiene `Catalogo_Yanbal_C11_2026_Precios.xlsx` (no reimportar sin autorización), `.env` (solo ADMIN_USER y ADMIN_PASSWORD) y `.venv` (solo openpyxl, restos de la importación).
- **Autenticación (leída del código el 26 oct):** credenciales solo desde variables de entorno; sesiones en memoria (`Map`) y cookie `yanbal_session` (`HttpOnly; SameSite=Strict`, 8 h). Defectos: el login filtra el largo de la clave (400 frente a 401), no limita intentos, la cookie no lleva `Secure` y la sesión no expira en el servidor. **Corrección aplicada en producción el 26 oct** (hash por comparación, límite de 5 fallos en 10 min por IP, sesiones que expiran a las 8 h, cookie `Secure`; ver `ESTADO_PROYECTO_Y_PENDIENTES.md`, 4.7). Las sesiones viven en memoria: reiniciar `yanbal-admin` las cierra.
- **Importación:** `/api/import/preview` y `/api/import/confirm` leen el catálogo preparado desde `/tmp/yanbal_catalogo_consolidado.json` (no es una ubicación estable ni privada). `/confirm` sigue activo aunque la importación esté pausada por decisión.
- **Nginx del panel:** proxy a `127.0.0.1:3081`, fija `X-Real-IP $remote_addr`, HSTS. Sin `limit_req` ni `server_tokens off` (paso 5).

### 3.3 Gratitud y Sanación — `/opt/gratitud/app/`
Aplicación independiente, repositorio Git, PM2 `gratitud`, puerto 3000. Inventario completo pendiente. No tocar.

## 4. Arquitectura propuesta (NO implementada)
Un único asistente central con cuatro módulos especializados (no cuatro apps).

```
Interfaz Yanbal (4 módulos)
        │
Servidor central del asistente (validación, contexto, permisos, coordinación)
   ├── Consulta de productos ──► API de SOLO LECTURA del catálogo
   ├── Modelo de IA (generación de respuestas y contenido)
   ├── Datos comerciales (prospectos, seguimientos; con permisos)
   └── Plantillas y contenido (borradores, recursos)
```
Regla: el asistente no recibe credenciales admin ni acceso a edición/eliminación/importación; solo una interfaz de lectura con campos autorizados.

Decisión de datos (usuaria): catálogo compartido entre consultoras, esquema multi-empresa, proyecto Supabase nuevo `catalogo-agentes`.
**Corrección del 30 oct:** el proyecto **existe** (creado el 20 oct): esquema multiempresa con campañas y precios por campaña, 427 productos validados de C11 y la función `catalog-api` (solo lectura, llave con hash y límites). **Ningún servicio la usa hoy**: el asistente lee el JSON de la VPS. Decidir más adelante si Supabase pasa a ser la fuente única de verdad (ver sección 9). No usar su tabla `leads` (teléfono y correo en claro): el Gestor de ventas vive en la VPS con cifrado.

## 5. Módulos
| # | Módulo | Objetivo | Funciones previstas | Dependencia principal |
|---|---|---|---|---|
| 1 | Asistente comercial (1ª prioridad) | Responder consultas con información verificable | Buscar productos; precio normal/oferta/vigencia; marcar productos pendientes de revisión; respuestas para WhatsApp; reconocer falta de datos | Acceso de solo lectura al catálogo |
| 2 | Asesor de belleza | Recomendar productos y rutinas | Preguntar preferencias; filtrar por categoría; rutinas con instrucciones fiables; no atribuir beneficios no documentados; no sustituye orientación médica | Catálogo enriquecido (descripciones, ingredientes, instrucciones oficiales) |
| 3 | Estudio de contenido | Material promocional coherente | Ideas Reels/historias/carruseles; guiones; descripciones, hashtags, WhatsApp; variantes de tono; precios solo si verificados | Instrucciones de marca y datos comerciales confiables |
| 4 | Gestor de ventas | Organizar prospectos y seguimiento | Registro de prospectos; etapas; recordatorios; notas/historial; indicadores | Base de datos persistente, permisos, respaldo, protección de datos (Ley 1581 de 2012) |

Orden recomendado: calidad/seguridad del catálogo → Asistente comercial → Estudio de contenido → Asesor de belleza → Gestor de ventas.
**Orden real seguido (30 oct):** Asistente comercial y Estudio de contenido construidos y aprobados; Gestor de ventas con el motor listo; Asesor de belleza bloqueado por falta de datos oficiales. En el menú lateral: 1 Asistente comercial, 2 Asesor de belleza, 3 Estudio de contenido, 4 Gestor de ventas.

## 6. Diseño visual propuesto (por validar contra la interfaz actual)
Elegante, moderno, femenino, profesional. Paleta: rosa empolvado, beige, marfil, acentos ciruela/vino. Estilo editorial premium, cuatro módulos con icono, título y descripción breve; responsive (celular/WhatsApp). Marca: "ISAMOR AI – Tu espacio de ventas inteligentes".

## 7. Plan por fases
| Fase | Contenido | Entregable |
|---|---|---|
| 1 | Auditoría técnica y funcional (solo lectura) | Inventario y mapa de dependencias |
| 2 | Diseño de datos e integración | Contrato de API y esquema de permisos |
| 3 | Asistente comercial: proveedor de IA, consulta controlada, validación de respuestas, pruebas con precios incompletos/promos vencidas | Asistente piloto trazable |
| 4 | Asesor de belleza y Estudio de contenido | Dos módulos con pruebas independientes |
| 5 | Gestor de ventas (almacenamiento, permisos, respaldo, recuperación) | Gestión comercial persistente |
| 6 | Pruebas, despliegue gradual, documentación y reversión | Versión validada |

## 8. Condiciones no negociables
Ver CLAUDE.md (sección REGLAS NO NEGOCIABLES). Adicional: datos de clientes mínimos necesarios, acceso restringido y respaldo; probar antes de desplegar y verificar estado después.

## 9. Capas de datos (riesgo de inconsistencia)
Hoy hay tres copias del catálogo C11: JSON del panel (437, `pendiente_revision`), copia de lectura del asistente (437, derivada del panel) y Supabase (427 validados; son los 437 sin los 3 sin precio y los 7 obsequios). Las tres salen del mismo Excel del artefacto de precios. Para el C12 se carga **solo** la copia de lectura del asistente (campaña programada). Definir la fuente única de verdad antes de actualizar las otras dos.

## 10. Seguridad de acceso: estado y principios (26 oct 2026)
- **Cerrado:** SSH solo con llave, `root` sin contraseña, fail2ban activo, y login del panel endurecido (comparación por hash, límite de intentos por IP, expiración de sesión, cookie `Secure`). Detalle y reversiones en `CAMBIOS_SERVIDOR_2026-10-26.md`.
- **Pendiente:** Nginx (`limit_req`, `server_tokens off`), actualizaciones de seguridad, usuario no root, Git y copia externa de respaldos.
- **Principio para los agentes de IA:** el asistente nunca recibe credenciales admin ni acceso a edición, eliminación o importación del catálogo; solo lectura con campos autorizados. Cuando exista un endpoint de lectura para el asistente, debe llevar su propia autenticación y límite de uso, independientes del panel.
- **Principio operativo:** auditar → diseñar → probar en copia aislada → autorización explícita → aplicar con reversión lista → verificar (hash, valor efectivo, prueba real).

## 11. Actualización del 30 de octubre de 2026
- **Asistente v2** en pruebas con 4 elementos de menú y permisos por usuario (`sales`, `content`, `beauty`, `manager`). Principio: el modelo redacta y el código decide.
- **Gestor de ventas:** SQLite cifrada (AES-256-GCM) en la VPS, aislamiento por usuaria, lectura de la administradora con registro de accesos, IA solo con datos enmascarados. Diseño en `DISENO_GESTOR_VENTAS_v1.md`.
- **Carga de campañas:** PDF → artefacto de precios → Excel → `xlsx-a-consolidado.js` → `cargar-campana.js` (la campaña entra sola a las 00:00 hora de Colombia de su fecha de inicio). Guía en `GUIA_CARGA_CAMPANA.md`.
- **Infraestructura:** Node 22 en paralelo; servidor de pruebas en el puerto 3082 solo por túnel SSH.

## 12. Actualización del 2 de noviembre de 2026
- **Producción ya corre la v2** (`yanbal-assistant`, puerto 3080, Node 18, `server.js` `21f6d973…`): Asistente comercial y Estudio de contenido con IA, y **administración de usuarios**. El Gestor de ventas sigue desactivado allí (requiere Node 22). Lo descrito en 3.1 corresponde a la v1 original, conservada como respaldo en `/root/respaldos-manuales/asistente-v1-20261102-015110`.
- **Usuarios en caliente:** `data/usuarios.json` se modifica desde la aplicación (escritura atómica, permisos 600, copia anterior en `usuarios.json.anterior`); ver `DISENO_ADMIN_USUARIOS_v1.md`.
- **Despliegue y actualización:** `deploy/desplegar.sh`, `deploy/actualizar.sh` y sus reversiones; ver `GUIA_DESPLIEGUE_Y_ACTUALIZACION.md`.
- **Código en GitHub:** `gratitudysanacion/claude-set-up-claude-on-a-project`, rama `claude/gracious-ptolemy-qm2mvv`, carpeta `isamor-ai/`.
