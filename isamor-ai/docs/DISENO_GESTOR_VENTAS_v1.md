# ISAMOR AI – Diseño del Gestor de ventas (módulo 4)
## Versión 1 · 30 de octubre de 2026 · Estado: **APROBADO por la usuaria el 30 oct 2026**; motor construido y activo en pruebas; pantallas pendientes

> No contiene contraseñas, claves ni valores de variables de entorno.

## 1. Resumen ejecutivo

El Gestor es una agenda de clientas y prospectos con etapas, recordatorios y notas, más un asistente de redacción que usa las notas para preparar mensajes de seguimiento. **Lo más delicado son los datos personales** (teléfono, cédula y dirección de personas reales), no la funcionalidad. Cuatro principios:

| Principio | Cómo se cumple |
|---|---|
| Cada usuaria ve solo sus clientas | Aislamiento por usuaria en el servidor; toda consulta filtra por usuaria |
| Datos sensibles cifrados en disco | AES-256-GCM en teléfono, cédula, dirección y notas |
| La IA recibe lo mínimo | Solo el primer nombre y notas enmascaradas; nunca teléfono, cédula ni dirección |
| Nada sin consentimiento | Casilla obligatoria con fecha y versión del texto; exportar y borrar a solicitud |

## 2. Decisiones de la usuaria (30 oct 2026)

| # | Decisión |
|---|---|
| 1 | Almacenamiento: **SQLite** (en lugar de archivos JSON). Requiere Node 22 en paralelo |
| 2 | **La administradora puede leer los datos de todas las usuarias** (da soporte). Salvaguardas añadidas: cada lectura ajena queda registrada (quién, cuándo, a quién y qué), el texto de consentimiento lo menciona y la administradora **no puede modificar** datos ajenos |
| 3 | Cédula y dirección **opcionales** |
| 4 | Recordatorios solo **dentro de la aplicación** (sin WhatsApp automático por ahora) |
| 5 | Etapas: nueva, contactada, interesada, pedido en curso, cliente, recompra, inactiva |
| 6 | Texto de consentimiento propuesto (ver 6) |
| Datos | Nombre, teléfono, dirección de envío, cédula y notas, que alimentan a la IA para redacción |
| Refuerzo | Las **notas** también se cifran (el diseño inicial las dejaba en claro): la búsqueda es solo por nombre y las clientas suelen escribir ahí teléfonos o direcciones |

## 3. Alcance de la primera versión

| Incluye | No incluye (por ahora) |
|---|---|
| Ficha: nombre, teléfono, dirección, cédula (opcional), notas | Envío automático de WhatsApp (noviembre, con diseño de seguridad propio) |
| Etapas e historial de cambios de etapa | Pagos o facturación |
| Recordatorios con fecha dentro de la aplicación | Importación masiva de contactos |
| Búsqueda **solo por nombre** (sin tildes ni mayúsculas) | Búsqueda por teléfono o cédula |
| Indicadores: clientas por etapa, recordatorios vencidos, de hoy y de los próximos 7 días, clientas sin movimiento (30 días) | Reportes avanzados |
| Exportar y borrar una ficha | |
| Redacción asistida de mensajes (Entrega 14) | |

## 4. Modelo de datos (SQLite, archivo `data/gestor.db`, permisos 600)

| Tabla | Campos principales |
|---|---|
| `clientas` | `id`, `usuaria`, `nombre`, `nombre_norm` (para buscar), `telefono_cif`, `cedula_cif`, `direccion_cif`, `notas_cif`, `etapa`, `consent_fecha`, `consent_version`, `creada`, `actualizada` |
| `historial_etapas` | `clienta_id` (borrado en cascada), `de`, `a`, `fecha` |
| `recordatorios` | `id`, `clienta_id` (cascada), `usuaria`, `fecha` (AAAA-MM-DD), `texto`, `hecho` |
| `accesos` | `fecha`, `actor`, `duena`, `accion`, `clienta_id`: lecturas de la administradora sobre datos ajenos |

Límites: nombre 120, dirección 200, notas 2.000, recordatorio 200 caracteres; 5.000 clientas por usuaria; teléfono de 7 a 15 dígitos; cédula de 5 a 12. Esquema versionado con `PRAGMA user_version`. `foreign_keys` y `secure_delete` activos; modo WAL.

## 5. Seguridad

| Control | Detalle |
|---|---|
| **Cifrado** | AES-256-GCM, valor aleatorio distinto en cada dato y verificación de integridad. Cada dato queda atado a su contexto `usuaria\|clienta\|campo`: un valor copiado a otra fila o campo no se puede descifrar |
| **Llave** | `GESTOR_LLAVE` (64 caracteres hexadecimales) en el `.env` con permisos 600; la crea `scripts/crear-llave-gestor.js`, que **no sobrescribe** una existente y la muestra una sola vez en la terminal para guardarla en el gestor de contraseñas. Nunca se pega en un chat |
| **Riesgo de la llave** | El respaldo diario **excluye el `.env`**. Si la llave se pierde, los datos cifrados **no se pueden recuperar**. Cambiarla también los deja ilegibles |
| Aislamiento | `resolverDuena`: otra usuaria o el administrador reciben "no encontrada" al pedir ids ajenos; pedir los datos de otra con `?duena=` sin ser administradora devuelve 403 |
| Escritura | Nadie, tampoco la administradora, modifica clientas de otra usuaria |
| Permiso del módulo | `/api/gestor/*` exige sesión y el módulo `manager` habilitado; 503 si el Gestor no está disponible |
| CSRF | Las escrituras desde otro origen se rechazan (además de `SameSite=Strict`) |
| Archivos | `gestor.db`, `-wal` y `-shm` en 600 (se corrige también si ya existían abiertos con otro permiso) |
| Registro del servidor | Sin teléfonos, cédulas ni notas |
| Limitación honesta | Cifrar en disco protege ante el robo del archivo o del respaldo; no protege si alguien controla el servidor en ejecución. Para eso están el firewall, SSH por llave y fail2ban |

## 6. Consentimiento y derechos (Colombia)

[Probable, confirmar con asesoría legal] La Ley 1581 de 2012 exige autorización previa del titular y una finalidad clara, y restringe enviar datos a otros países sin autorización. El proveedor de IA procesa fuera de Colombia, por eso el texto lo menciona.

**Texto (versión 1):** "Confirmo que la persona autorizó guardar sus datos (nombre, teléfono y, si los dio, cédula y dirección) para atención comercial; que sus notas pueden procesarse con inteligencia artificial de un proveedor ubicado en el exterior, sin su teléfono, cédula ni dirección; y que el administrador de la plataforma puede acceder a ellos para dar soporte."

Sin la casilla marcada **no se guarda la ficha**. Se registra la fecha y la versión del texto por clienta. **Exportar** entrega todos los datos descifrados de una clienta; **borrar** elimina la ficha con su historial y recordatorios. [Suponiendo] Actividad de vendedora independiente, sin obligación de registrar bases de datos ante la Superintendencia; revisar si se suma equipo o volumen.

## 7. Qué ve la IA

| Dato | ¿Llega al modelo? |
|---|---|
| Nombre | Solo el **primer nombre** |
| Notas | Sí, con teléfonos, cédulas, correos y direcciones reemplazados por `[TELÉFONO]`, `[NÚMERO]`, `[CORREO]`, `[DIRECCIÓN]`. Los importes en pesos y las fechas se conservan |
| Etapa y fechas | Sí |
| Teléfono, cédula, dirección | **Nunca** |

Tras redactar, el código comprobará que el texto no reintroduzca datos sensibles (`contieneDatosSensibles`) y que cumpla las reglas de marca del Estudio de contenido.

## 8. API (`/api/gestor/…`)

`meta` · `clientas` (GET lista con `etapa`, `q`, `limite`, `desplazamiento`; POST crear) · `clientas/:id` (GET, PUT, DELETE) · `clientas/:id/exportar` · `clientas/:id/recordatorios` (POST) · `recordatorios` (GET con `estado` = pendientes, vencidos, hoy o proximos) · `recordatorios/:id/completar` · `indicadores` · `accesos` (solo administradora). La lista muestra el teléfono solo con sus últimos 4 dígitos.

## 9. Requisitos de ejecución

Node 22 o superior (`node:sqlite`) y `GESTOR_LLAVE`. En Node 18 el servidor arranca con "Gestor: desactivado". El Node 22 está instalado en paralelo en `/opt/node22`; el asistente de pruebas corre con él.

## 10. Riesgos

| Riesgo | Gravedad | Mitigación |
|---|---|---|
| Pérdida de la llave de cifrado | **Alta** | Copia en el gestor de contraseñas, verificada antes de activar producción |
| Respaldo diario sin la base SQLite (o con una copia en caliente inconsistente) | Alta | Añadir al script de respaldo una copia consistente de la base (`VACUUM INTO` o `.backup`) antes de producción |
| Datos sensibles escritos en las notas | Media | Aviso en pantalla, cifrado y enmascarado hacia la IA |
| Una usuaria ve datos de otra | Alta | Filtro por usuaria en cada consulta y pruebas automáticas (por API y por base) |
| `node:sqlite` aún "experimental" en Node 22 | Baja-media | Aislado en un solo módulo (`gestor.js`); fácil de cambiar |
| Cumplimiento legal | Media | Consentimiento registrado y revisión legal |
| Administradora con acceso amplio | Media | Registro de cada lectura; sin escritura sobre datos ajenos |

## 11. Plan

| Fase | Contenido | Estado |
|---|---|---|
| 10 | Base cifrada, API, permisos, enmascarado | **Instalada** |
| 11 | Node 22 en paralelo | **Instalada** |
| Activación en pruebas | Llave, rol de administradora, módulo `manager` | **Hecha** (30 oct) |
| 13 | Pantallas: lista, ficha, etapas, recordatorios, consentimiento, exportar y borrar | Pendiente |
| 14 | Redacción asistida con enmascarado e indicadores | Pendiente |
| Producción | Llave propia, respaldo consistente de la base, revisión legal y cambio de intérprete de PM2 a Node 22 con su propia frase de autorización | Pendiente |

## 12. Pruebas

31 pruebas automáticas del Gestor y de su API (más 1 de permisos de archivos), entre ellas: consentimiento obligatorio, datos **no** en claro dentro de la base, un dato copiado a otra fila no se descifra, aislamiento entre usuarias, lectura de la administradora con registro y sin escritura, búsqueda sin inyección, límites, recordatorios por fecha, indicadores, base en disco que sobrevive al cierre y no se abre con otra llave, y rechazo de escrituras desde otro origen. Se verificaron con mutaciones (romper el código a propósito y comprobar que alguna prueba falla); la única mutación que no se detecta es redundante (la salvaguarda de escritura ajena, que además es imposible de invocar por la API).
