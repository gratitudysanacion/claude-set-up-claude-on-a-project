# ISAMOR AI – Diseño de la redacción asistida de mensajes en el Gestor de ventas
## Versión 1.1 · 4 de noviembre de 2026 · Estado: **DECISIONES DE LA USUARIA RECIBIDAS; IMPLEMENTADO en el sandbox (Entrega 17); pendiente de instalar en pruebas. Producción solo tras la revisión legal**

> No contiene claves ni datos personales reales.

## 0. Decisiones de la usuaria (4 nov 2026)

| # | Decisión |
|---|---|
| 1 | Alcance: **mensajes de seguimiento, recordatorios y respuestas a clientas** (tres tipos; la respuesta exige pegar el mensaje de la clienta) |
| 2 | **Acepta enviar las notas enmascaradas** (sin teléfono, cédula ni dirección) a un proveedor externo (Anthropic). Condición para producción: visto bueno del abogado |
| 3 | **Límite mensual de gasto de IA: 10 USD** (para todos los módulos de IA). El límite de la organización en la consola de Anthropic debe subirse a 10 USD o más: hoy es de 3 USD |
| Por defecto (no objetadas) | Primera versión **sin precios** (solo la cifra que la propia usuaria escriba); 30 borradores al día por usuaria; tono cercano y cálido, tuteo, hasta 70 palabras |

## 1. Objetivo

Que la usuaria, desde la ficha de una clienta, obtenga un **borrador de mensaje de seguimiento** (para copiar a WhatsApp) escrito con el nombre de pila, la etapa y las notas de esa clienta, **sin que ningún dato sensible salga del servidor** y sin que la IA invente precios, vigencias ni promesas.

## 2. Lo ya decidido (30 oct 2026, `DISENO_GESTOR_VENTAS_v1.md`)

| Tema | Decisión vigente |
|---|---|
| Qué ve la IA | Solo el **primer nombre**, la etapa y las **notas enmascaradas** (teléfonos, cédulas, correos y direcciones reemplazados por marcas). Nunca teléfono, cédula ni dirección |
| Verificación posterior | `contieneDatosSensibles` sobre lo que redacta el modelo |
| Consentimiento | El texto vigente ya menciona el procesamiento con IA de un proveedor en el exterior, sin teléfono, cédula ni dirección |
| Envío | **Sin envío automático** de WhatsApp: la usuaria copia el borrador |
| Piezas ya construidas | `resumenParaIA`, `enmascarar`, `contieneDatosSensibles` (con pruebas) |

## 3. Alcance de la primera versión (propuesta)

| Incluye | No incluye |
|---|---|
| Botón **Redactar mensaje** en la ficha, con un tipo de mensaje elegido de una lista | Envío automático |
| Tipos según la etapa: primer contacto, seguimiento, confirmar interés, pedido en curso, agradecimiento, recompra, reactivar clienta inactiva | Precios, ofertas y vigencias (versión 2, con el catálogo verificado) |
| Borrador **editable** y botón Copiar | Guardar el borrador en la base (no se guarda nada generado) |
| Tono de la marca: reglas del Estudio de contenido (sin milagros ni curas, sin letras de otros alfabetos) | Mensajes masivos a varias clientas |
| Límite diario por usuaria y registro de uso **sin contenido** | |

## 4. Alternativas

| Opción | Ventajas | Desventajas | Veredicto |
|---|---|---|---|
| A. Plantillas fijas por etapa, sin IA | Costo cero, cero riesgo de datos | Mensajes genéricos; no usa las notas | Complemento, como respaldo cuando la IA falle |
| **B. IA con datos mínimos y verificación en código (versión 1)** | Mensajes personalizados; ya hay enmascarado y verificadores | Un proveedor externo ve las notas enmascaradas | **Recomendada** |
| C. B más catálogo (precios y vigencias reales) | Mensajes de oferta completos | Riesgo de precios errados; más superficie | Versión 2, con el verificador de importes que ya existe |
| D. Modelo propio en el servidor | Los datos no salen | Costo de hardware, calidad menor, operación | Descartada por ahora |

## 5. Arquitectura propuesta

```
Ficha (navegador) --POST /api/gestor/clientas/:id/redactar {tipo}--> servidor
   servidor: sesión + módulo manager + dueña de la ficha (solo escritura propia; la administradora NO redacta sobre datos ajenos)
   -> descifra la ficha EN MEMORIA -> resumenParaIA (nombre de pila, etapa, notas enmascaradas)
   -> agente de redacción (sin herramientas, sin catálogo) -> borrador
   -> verificadores: sin datos sensibles, términos de marca, sin importes ni vigencias, sin otro alfabeto
   -> si falla: una corrección; si vuelve a fallar: plantilla fija por etapa (opción A)
   -> respuesta al navegador (el borrador no se guarda)
```

| Elemento | Decisión |
|---|---|
| Modelo | Haiku 5.5, igual que los otros agentes; razonamiento limitado y tope de salida bajo (unos 600 tokens) |
| Registro | Solo fecha, usuaria, tipo de mensaje, tokens y motivo de respaldo; **nunca** notas ni borradores |
| Reglas | Sin importes en pesos, sin vigencias, sin promesas de resultados, sin inventar datos de la clienta |
| Límite | 30 borradores por usuaria al día (propuesta) y el límite por minuto actual |
| Falla del proveedor | Plantilla fija por etapa con el nombre de pila, sin IA |
| Permisos | Solo la dueña de la ficha; no en modo soporte |

## 6. Costos y límites [Probable; cifras a confirmar en la consola]

| Concepto | Estimación |
|---|---|
| Entrada por borrador (instrucciones, nombre, etapa, notas ≤ 2.000 caracteres) | 1.000 a 1.500 tokens |
| Salida | Típica 250 tokens; tope 600 |
| Costo por borrador con Haiku 5.5 (0,10 USD entrada y 0,50 USD salida por millón de tokens) | **~0,0003 USD típico; ~0,0007 USD en el peor caso** |
| 50 borradores al día | ~0,45 USD al mes típico; ~1,05 USD en el peor caso |
| Riesgo | El límite mensual de la organización es de **3 USD compartidos** con el Asistente comercial y el Estudio de contenido, y hay ~0,43 USD sin explicar. Con varias usuarias podría agotarse |

Recomendación: tope de 30 borradores diarios por usuaria, revisar el desglose de costo en la consola antes de activar y subir el límite de la organización si hay más de dos usuarias activas.

## 7. Privacidad y legal

| Punto | Estado |
|---|---|
| El texto de consentimiento ya menciona al proveedor en el exterior | Debe validarlo un abogado antes de usar datos reales |
| Transferencia a otro país (Ley 1581 de 2012) | [Probable] se apoya en la autorización de la titular; verificar con el abogado si el proveedor está en un país con nivel adecuado |
| Retención en el proveedor | [Suponiendo] la API comercial de Anthropic no usa los datos para entrenar y los conserva un tiempo limitado; **verificar los términos vigentes** y valorar la opción de retención cero si se contrata |
| Las notas pueden contener datos que el enmascarado no detecta (nombres de terceros, salud, etc.) | Aviso en pantalla: «No escribas en las notas datos sensibles (salud, claves, cuentas)». Enmascarado mejorable por reglas |
| Datos de la clienta sin consentimiento | No existe ficha sin consentimiento; la redacción exige que esté registrado |

## 8. Pruebas previstas

Enmascarado con textos reales de notas (teléfonos, cédulas, direcciones, correos); verificador de datos sensibles; reglas de marca; respaldo por plantilla cuando el modelo falle o incumpla; límite diario; permisos (otra usuaria, administradora en modo soporte, sin módulo); sin contenido en el registro; Playwright del botón, el borrador editable, copiar y errores; mutaciones.

## 9. Riesgos

| Riesgo | Mitigación |
|---|---|
| Una nota con un dato sensible que el enmascarado no detecta llega al proveedor | Aviso en pantalla, enmascarado por reglas, solo notas (nunca teléfono, cédula ni dirección) y revisión legal |
| El modelo inventa un precio o una promesa | El verificador de importes rechaza cualquier cifra en pesos; reglas de marca |
| Costo fuera de control | Límite diario por usuaria, tope de salida, razonamiento limitado, revisión mensual |
| Pérdida de confianza si el mensaje suena a robot | Borrador siempre editable; plantillas con el estilo de la usuaria (ajustable) |

## 10. Plan de acción

1. Decisiones de la usuaria (sección 11).
2. Implementar y probar en el sandbox con datos ficticios.
3. Instalar en **pruebas** (con datos ficticios) y revisar el estilo de los mensajes.
4. Producción solo después de la revisión legal y de asignar el módulo a las usuarias.

## 11. Decisiones pendientes de la usuaria

1. Tipos de mensaje de la primera versión (lista propuesta en la sección 3).
2. ¿Primera versión **sin precios** (recomendado) o ya con el catálogo?
3. Límite diario por usuaria (propuesta: 30).
4. Tono por defecto: cercano y cálido, tuteo, hasta 70 palabras, con un cierre de una pregunta [Suponiendo]. Ajustable.
5. Visto bueno del abogado sobre el proveedor externo (condición para producción).

## 12. Implementación (Entrega 17, 4 nov 2026)

| Elemento | Detalle |
|---|---|
| `src/redaccion.js` | Solicitud validada; mensaje al modelo con nombre de pila, etapa y notas/mensaje/indicaciones **enmascarados y sin etiquetas**; instrucciones; verificador (datos sensibles, marcas de enmascarado, números, importes, términos de marca, otros alfabetos, largo); un reintento; plantilla fija si falla |
| `src/gasto.js` | Contador mensual de tokens valorados con los precios de Haiku 5.5 (configurables); aviso al 80 %; **bloqueo al llegar al tope** (10 USD, variable `TOPE_MENSUAL_USD`); persiste en `data/gasto.json` (600) solo totales; se reinicia cada mes (hora de Colombia) |
| API | `POST /api/gestor/clientas/:id/redactar` (solo fichas propias; 6 por minuto y 30 al día; 503 `limite_mensual` al llegar al tope); el chat de los otros módulos también suma y respeta el tope; `GET /api/admin/gasto` (solo administradora; se puede abrir en el navegador con la sesión iniciada) |
| Pantalla | Bloque «Redactar un mensaje para esta clienta» en la ficha: tipo, mensaje de la clienta (solo en respuestas), indicaciones, borrador editable y botón Copiar. No existe en modo soporte |
| Pruebas | 279 automáticas; 16 de 16 roturas intencionales detectadas; 22 comprobaciones de navegador del Gestor (5 nuevas) |
| Hallazgo | El nombre de la clienta también podía abrir etiquetas en el mensaje al modelo: ahora se limpia (con prueba) |
| Pendiente | Instalar en pruebas, revisar el estilo de los mensajes, subir el límite de la organización en la consola, revisión legal y asignar el módulo (Fase B) |
