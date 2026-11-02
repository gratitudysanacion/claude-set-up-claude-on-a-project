# ISAMOR AI – Diseño técnico del Asistente comercial (módulo 1)
## Versión 1.2 · actualizado el 30 de octubre de 2026 · Complementa a `DISENO_ASISTENTE_COMERCIAL_v1.md` (aprobado)

> Las secciones 1 a 7 son el diseño del 27 oct. **La sección 8 y las secciones 10 a 15 reflejan lo construido al 30 oct.** Donde el diseño inicial decía "un solo módulo conectado" o "tope de 600 tokens", rige lo actual.

> No contiene contraseñas, claves ni valores de variables de entorno.

## 1. Hallazgos del asistente actual (lectura de `server.js`, `index.html`, `package.json`)

| Elemento | Hallazgo | Implicación |
|---|---|---|
| `server.js` | Node `http` nativo, 110 líneas, sin dependencias. Solo atiende GET: `/health`, `/api`, `/` e `/index.html`, `/yanbal-logo.jpg`. Escucha en `127.0.0.1:3080` | Compatible con el proxy de Nginx actual. Hay que añadir POST, cuerpo, sesiones y límites |
| Cabeceras | El HTML sale con `nosniff`, `X-Frame-Options: SAMEORIGIN` y `Referrer-Policy`. **Sin CSP** y sin HSTS en la app (HSTS lo pone Nginx) | Se añade una CSP estricta |
| `index.html` | Un solo archivo con CSS y JavaScript **inline**, sin librerías externas. 4 módulos con **un único formulario compartido** | Para una CSP estricta hay que mover CSS y JS a archivos propios |
| Mensajes del chat | Se insertan con `textContent` (no `innerHTML`) | Seguro contra XSS; se mantiene esa regla |
| Envío del formulario | Hoy solo muestra un mensaje local ("todavía no se envía a una IA") | Se conecta a `/api/chat` solo para el módulo comercial |
| Texto de interfaz | El módulo "Asistente comercial" dice "Prepara mensajes para clientes, respuestas a preguntas frecuentes…" | No coincide con el MVP (consulta de catálogo): se cambia el texto |
| Límites | `maxlength=1500` en el campo, nada en el servidor | El servidor impone sus propios límites |
| `package.json` | Sin dependencias, `engines: node >=18`, arranque `node src/server.js` | Se mantiene sin dependencias |

[Seguro] El asistente actual **no recibe ni guarda ningún dato**; por eso no hay datos personales que migrar.

## 2. Decisiones técnicas

| Decisión | Motivo |
|---|---|
| **Cero dependencias** (CommonJS, Node 18, `fetch` nativo para la API de IA) | Mantiene el estilo actual, reduce riesgo de cadena de suministro y facilita auditar |
| Desarrollo en `asistente-v2/`, **copia aislada** | El asistente original y sus respaldos se conservan (regla 2) |
| Prueba en el servidor en `/opt/yanbal-assistant-v2`, puerto **3082 solo localhost**, con catálogo y credenciales ficticios | Mismo método que el panel |
| Despliegue final: reemplazar los archivos de `/opt/yanbal-assistant` **manteniendo el proceso PM2 `yanbal-assistant` y el puerto 3080**, tras respaldo con hash | Nginx no cambia; la reversión es restaurar el respaldo |
| Modelo inicial: **Haiku 5.5** | Menor costo (0,10 USD entrada y 0,50 USD salida por millón de tokens); se evalúa con la suite |
| Modelo **simulado** para las pruebas | Se prueba todo sin gastar saldo |

## 3. Cambios de interfaz

| Cambio | Detalle |
|---|---|
| Módulo "Asistente comercial" | Se conecta a `/api/chat`. Los otros 3 módulos siguen igual (demo) hasta sus fases |
| Texto del módulo | "Consulta precios, ofertas y vigencias del catálogo." |
| Acceso | Si no hay sesión, el módulo muestra un formulario de usuario y contraseña. El resto del sitio sigue visible |
| Banner de campaña | Desde `/api/estado`: "Campaña C11 2026 · vigente hasta el 6 de noviembre" (verde), "termina pronto" (ámbar), "terminó el 6 de noviembre; no se confirman precios" (rojo) |
| Aviso permanente | "Datos pendientes de revisión: confirma en el catálogo impreso antes de ofrecer" |
| Respuestas | Texto plano con `textContent`; nunca HTML |
| Estados | Botón desactivado mientras responde, mensajes claros ante 401, 429, saldo agotado y error del proveedor |
| Estructura | CSS y JS pasan a `/styles.css` y `/app.js` (lista blanca de archivos estáticos) |

```
┌───────────────────────────────────────────────────────────────┐
│ Asistente comercial                        ● Campaña C11 2026 │
│ Consulta precios, ofertas y vigencias.     vigente al 6 nov   │
├───────────────────────────────────────────────────────────────┤
│ ⚠ Datos pendientes de revisión.                               │
│ [Usuario ______] [Clave ______] [Entrar]    (si no hay sesión)│
│                                                               │
│  Tú: ¿Cuánto cuesta la crema Biomilk Intensive?               │
│  Asistente: Biomilk Crema Corporal Intensive (ref. 670, 750 ml)│
│   Precio normal $89.000 · Oferta $48.500 c/u (45% dscto.)     │
│   Vigente hasta el 6 de noviembre (campaña C11 2026).         │
│   Condiciones completas: página 102 del catálogo.             │
│                                                               │
│ [ Escribe el nombre, referencia o categoría…      ] [Consultar]│
└───────────────────────────────────────────────────────────────┘
```

## 4. Contrato de API

| Método y ruta | Entrada | Salida | Errores |
|---|---|---|---|
| `GET /health` | — | estado, versión, `ai: connected / not_connected` | — |
| `GET /api/estado` | — | campaña (nombre, desde, hasta, estado, días restantes), total de productos, fecha de la copia de lectura | — |
| `POST /api/login` | `{usuario, clave}` (máx. 4 KB) | 200 con cookie de sesión | 401 mensaje único, 429 con `Retry-After` |
| `POST /api/logout` | — | 200 | — |
| `GET /api/sesion` | — | `{autenticada}` | — |
| `POST /api/chat` | `{mensaje}` (máx. 1.500 caracteres) | `{respuesta, advertencias[], campana}` | 400 vacío, 401 sin sesión, 413 demasiado largo, 429 límite de uso, 503 IA no disponible o saldo agotado |

## 5. Seguridad

| Control | Detalle |
|---|---|
| Sesión y login | Mismo patrón del panel corregido: comparación por hash, 5 fallos en 10 min por IP con bloqueo de 15 min, sesión de 8 h en servidor, cookie `HttpOnly; Secure; SameSite=Strict`. La IP real llega por `X-Real-IP` (Nginx la fija) |
| Usuario y clave | Distintos de los del panel. Se crean con un script que **pide la clave sin mostrarla** y guarda solo el hash. Nunca pasan por el chat |
| Clave del proveedor | Archivo `.env` con permisos 600 en la carpeta de la app, leído por el proceso al arrancar; nunca impresa ni registrada |
| Límites de uso | Propuesta: 12 mensajes por minuto y 200 por día por usuaria; tope de 600 tokens de salida; máximo 3 vueltas de herramienta por consulta |
| Cabeceras | CSP `default-src 'self'; frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`, `Cache-Control: no-store` en la API |
| Archivos estáticos | Lista blanca (`/`, `/app.js`, `/styles.css`, `/yanbal-logo.jpg`); nada de rutas arbitrarias |
| Registro | Solo metadatos (hora, duración, tokens, resultado del verificador); **sin texto de mensajes** |

## 6. Flujo de una consulta

```
mensaje → validaciones y límites → modelo con herramientas:
  buscar_productos(consulta, categoria?, limite≤10)   detalle_producto(id|referencia)
        │ (código determinista: reglas.js + catalogo.js)
        ▼
  resultados con banderas → modelo redacta → verificador de importes
        ├─ ok → respuesta
        └─ violación → respuesta de respaldo armada por código (ficha literal), sin IA
```

La **respuesta de respaldo** es una ficha construida por código con los datos del catálogo. Garantiza que, aunque el modelo falle o invente, la usuaria reciba siempre datos correctos.

## 7. Estructura de archivos

```
asistente-v2/
  src/server.js        router, cabeceras, estáticos, límites
  src/auth.js          login, sesiones, límite de intentos
  src/catalogo.js      carga, búsqueda y banderas            [hecho]
  src/reglas.js        vigencia, coherencia, importes         [hecho]
  src/verificador.js   importes de la respuesta ⊆ herramientas [hecho]
  src/ia.js            cliente de la API, bucle de herramientas, modelo simulado
  src/respaldo.js      ficha determinista sin IA
  scripts/exportar-lectura.js   genera catalogo_lectura.json desde el catálogo del panel
  scripts/crear-usuario.js      crea el usuario del asistente (clave oculta)
  data/campana.json             campaña C11 2026
  public/index.html, app.js, styles.css
  test/                         suite de pruebas (node --test)
```

## 8. Estado de la construcción (30 oct 2026)

| Entrega | Estado |
|---|---|
| Núcleo, servidor, login, límites, cliente de IA real y respaldo determinista, scripts, interfaz de chat | **Hecho y aprobado en pruebas** (entregas 1 a 2b) |
| Reglas 2 x 1 y obsequios, auditor del catálogo | **Hecho** (entregas 3 a 3d) |
| Módulos con permisos, motor de agentes, Estudio de contenido, campañas programadas | **Hecho** (entregas 4 a 7) |
| Topes de tokens, nota de marca, redirección comercial → contenido | **Hecho** (entrega 8) |
| Vigencia solo con la oferta; alfabetos ajenos | **Hecho** (entregas 9 y 9b) |
| Gestor de ventas: motor, API, cifrado, permisos | **Hecho** (entregas 10 y 11, activado en pruebas) |
| Conversor del Excel del catálogo, regla de sets del C12 | **Hecho** (entrega 12) |
| Gestor: pantallas (13) y redacción asistida (14) | Pendiente |
| Pruebas en el servidor con Node 18 | **Hecho**: 184 pasan y 23 se omiten (las del Gestor requieren SQLite integrado); con Node 22: 207 de 207 |
| Despliegue a producción | Previsto lunes 2 nov, con la frase de autorización por paso |

## 9. Autorizaciones que se te pedirán

1. Crear la copia de prueba en el servidor y correr las pruebas (no toca producción).
2. Generar la copia de lectura desde el catálogo real (solo lectura del catálogo).
3. Usar la clave de IA en las pruebas con el modelo real.
4. Desplegar sobre `yanbal-assistant`, con respaldo y reversión.

## 10. Arquitectura de módulos y agentes (entregas 4 a 8)

```
navegador ── /api/chat {mensaje, modulo} ──► servidor
   modulo ∈ {sales, content, beauty, manager}; se valida contra los módulos de la usuaria (usuarios.json → "modulos")
   sin permiso → 403 modulo_no_permitido ; sin agente → 503
                                   │
                  src/agente.js  (motor genérico)
        bucle de herramientas · reintentos con corrección · recorte de respuesta cortada
        cliente HTTP con códigos: saldo_agotado, ia_no_disponible, tiempo_agotado
              ┌────────────┴────────────┐
        src/ia.js                  src/contenido.js
   Asistente comercial          Estudio de contenido
   buscar_productos,            mismas herramientas de catálogo +
   detalle_producto             verificarContenido()
```

- **Permisos por usuaria:** `data/usuarios.json` → `modulos` (por defecto solo `sales`) y `rol` (`admin` para la administradora). Se asignan con `scripts/asignar-modulos.js` y `scripts/asignar-rol.js`. La sesión informa los módulos (`/api/sesion`).
- **Comercial (`ia.js`):** instrucciones, herramientas y `compactarResultado` (reduce el tamaño de lo que se devuelve al modelo); tope de 2.500 tokens porque Haiku 5.5 razona y esos tokens cuentan. Si le piden redactar anuncios, remite al módulo Estudio de contenido.
- **Contenido (`contenido.js`):** tope de 4.500 tokens; un reintento de corrección. `verificarContenido` rechaza: importes no respaldados por el catálogo, **términos prohibidos** (curas, milagros, resultados garantizados…), **afirmaciones no documentadas** (duración, resistencia al agua, hipoalergénico, natural, vegano…), **escasez, reservas, envío o disponibilidad**, **código de campaña** (C11, C12), **precios sin fecha de vigencia**, **fecha de vigencia pegada al precio normal** y **letras de otros alfabetos** (cirílico, griego…). Tras el reintento limpia comentarios del modelo (`limpiarMeta`). Si el pedido en sí exige promesas de resultados, no redacta y lo dice; si el usuario las nombra, antepone la nota de marca. El respaldo determinista cambia según el motivo, sin repetir las palabras prohibidas.
- **Registro:** solo metadatos (hora, usuario, módulo, tokens, vueltas, reintentos, caracteres, respaldo, motivo); nunca el texto.
- **Interfaz:** `public/app.js` con los módulos `sales` y `content` activos (`content` con botón "Copiar texto"); barra de sesión fuera del área de chat; aviso `#sin-permiso`.

## 11. Reglas de negocio del catálogo (`src/reglas.js`)

| Regla | Detalle |
|---|---|
| **2 x 1** | Si no hay precio normal y la promoción dice "2 x 1 por $X" con $X igual a la oferta: `precio_normal = X`, la oferta pasa a "pides 1 y recibes 2", `tipo_promocion = '2x1'` y se agrega una advertencia explicativa (solo si el texto la menciona) |
| **Obsequio** | Sin ningún precio y promoción que empieza por "Obsequio": `tipo_promocion = 'obsequio'`; se entrega gratis con la compra indicada y no se vende por separado |
| **Sets** | La promoción empieza por "Set" y lista componentes: con la marca `componentes en oferta:` (C11) o sin ella (C12), la suma de los componentes debe dar el precio de oferta del set; los precios por unidad (`ml a $…`) no cuentan |
| **Vigencia** | La campaña tiene fechas propias (`campana.json`); el estado (vigente, termina pronto, vencida, aún no rige) se calcula por la fecha de Colombia. La nota "Se informa precio…" de la importación se elimina de las promociones |
| **Verificador de importes** | Todo importe de la respuesta debe provenir de las herramientas; si no, respaldo determinista (ficha) |

Auditor (`scripts/auditar-catalogo.js`): cuenta `dos_por_uno_deducido`, `dos_por_uno_sin_deducir`, `solo_oferta`, `obsequios`, `sin_ningun_precio`, `promocion_no_coincide` y `solo_dentro_de_set`.

## 12. Campañas programadas

`crearCatalogoProgramado` mantiene la campaña actual y, opcionalmente, la siguiente (`catalogo_lectura_siguiente.json` + `campana_siguiente.json`), que **entra sola a las 00:00 hora de Colombia de su `vigencia_desde`, sin reiniciar**. `scripts/cargar-campana.js` (ensayo por defecto; `--aplicar` escribe; `--modo programar|reemplazar`; `--promover` deja los archivos en orden después del cambio) valida, audita, guarda copia de lo que reemplaza en `data/campanas-anteriores/` y escribe de forma atómica; no borra nada. Procedimiento: `GUIA_CARGA_CAMPANA.md`.

## 13. Gestor de ventas (módulo 4)

Diseño completo en `DISENO_GESTOR_VENTAS_v1.md`. Piezas de código: `src/cifrado.js` (AES-256-GCM con contexto usuaria|clienta|campo), `src/enmascarar.js` (teléfonos, cédulas, correos y direcciones → marcas; primer nombre), `src/gestor.js` (SQLite con `node:sqlite`; clientas, etapas, recordatorios, consentimiento, accesos), rutas `/api/gestor/*` en `server.js`, scripts `crear-llave-gestor.js` y `asignar-rol.js`. **Requiere Node 22 y `GESTOR_LLAVE`**; sin alguno de los dos el servidor arranca igual y responde `gestor_no_disponible` (en Node 18 el aviso es "Gestor: desactivado").

## 14. Despliegue

- **Pruebas:** `/root/asistente-v2-pruebas/v3`, puerto 3082 solo localhost, acceso por túnel SSH. Arranque: `cd` y luego `PORT=3082 nohup /opt/node22/bin/node src/server.js > server-pruebas.log 2>&1 &` y `echo $! > pid-pruebas` en líneas separadas.
- **Producción (lunes 2 nov):** `deploy/desplegar.sh` verifica los hashes de la v1 (`server.js` `765f5dfee7040030…`, `index.html` `e60c694a7f9c817b…`), corre las pruebas primero, respalda en `/root/respaldos-manuales/asistente-v1-FECHA`, exporta el catálogo del panel con `--esperados 437`, copia usuarios y `.env`, instala el código, reinicia `yanbal-assistant`, comprueba y guarda PM2. `deploy/revertir.sh` aparta la versión fallida y restaura el respaldo. Ensayado 22/22 en una réplica local. Corre con Node 18 (Gestor desactivado); activar el Gestor en producción exige su propio paso (Node 22, llave propia y respaldo de la base).
- Nginx: `limit_req`, `server_tokens off` y HSTS quedan pendientes de la frase `autorizo nginx`.

## 15. Costos y límites (medidos)

Haiku 5.5: 0,10 USD de entrada y 0,50 USD de salida por millón de tokens (hasta 100.000 de entrada). Consulta comercial ≈ 0,0008 USD; de contenido ≈ 0,002 USD. El límite de gasto de la organización es de 3 USD al mes y se **comparte** con otros usos de la cuenta. El razonamiento adaptativo de Haiku 5.5 consume tokens de salida; `budget_tokens` no existe en este modelo (devuelve 400).
