# ISAMOR AI – Guía de carga de una campaña nueva (catálogo)
## Versión 1 · 30 de octubre de 2026 · Probada con el catálogo C12 2026

> Procedimiento repetible para cargar el catálogo de cada campaña (cada 4 semanas) al Asistente comercial. No contiene claves ni valores de variables de entorno.

## 1. Objetivo y alcance

Cargar los precios y promociones de una campaña nueva al asistente **sin editar código**, con revisión humana de lo que la herramienta no pudo comprobar, y dejarla programada para que entre sola a la hora exacta.
**No cubre** la actualización del panel de administración ni de Supabase (ver sección 8).

## 2. Resumen del flujo

```
PDF del catálogo
   │  (1) artefacto de Claude "Lista de precios del catálogo", en el PC de la usuaria
   ▼
Excel (hojas "Productos" y "Sin precio")  ──(2) scp──►  /root/c12-entrada/ (servidor)
   │  (3) scripts/xlsx-a-consolidado.js     (--esperados, --aprobar)
   ▼
JSON consolidado
   │  (4) scripts/cargar-campana.js (ensayo, luego --aplicar)
   ▼
catalogo_lectura_siguiente.json + campana_siguiente.json
   │  (5) el servidor la activa sola a las 00:00 (Colombia) de la fecha de inicio
   ▼
Asistente con la campaña nueva  ──(6) --promover──►  archivos en orden
```

## 3. Antes de empezar

| Dato | Ejemplo (C12) |
|---|---|
| PDF del catálogo en el PC | `C:\Users\USUARIA\Downloads\c12.pdf` |
| Nombre de la campaña | `C12 2026` |
| Vigencia (ambos extremos inclusivos, hora de Colombia) | del `2026-11-07` al `2026-12-04` |
| El código del asistente v2 ya está en el servidor de destino | **Requisito:** la campaña programada solo existe en la v2 |

## 4. Paso a paso

### Paso 1. Extraer los productos (PC, navegador)
1. Abrir en Claude el artefacto **Lista de precios del catálogo** (menú Artefactos; `claude.ai/artifact/Nz3wtshDmLt58ECgvXY15G`).
2. Elegir el PDF y pulsar **Extraer productos**. El PDF se lee en el navegador; solo el texto de las páginas se envía a Claude. Usa la cuota de Claude de la usuaria, no la API key del asistente.
3. Revisar la tabla. El artefacto comprueba cada precio y cada código contra el texto de su página y marca **"Revisar"** (barra naranja) lo que no coincide. Usar el filtro "Solo filas por revisar".
4. Leer también el recuadro naranja "códigos o precios que no están en la tabla" y la tabla **Productos sin precio**.
5. **Descargar Excel.**

### Paso 2. Subir el Excel al servidor (PowerShell del PC)
```
scp -i "$env:USERPROFILE\.ssh\isamor_ed25519" "C:\Users\USUARIA\Downloads\Catalogo_Yanbal_C12_2026_Precios.xlsx" root@[IP-REDACTADA]:/root/c12-entrada/
```
En el servidor: `ls -la /root/c12-entrada/ && sha256sum /root/c12-entrada/*.xlsx` y comparar la huella si hay una referencia. (Un PDF subido al servidor no lo puede leer Claude; solo el Excel sirve para este flujo.)

### Paso 3. Convertir el Excel (servidor, carpeta `/root/asistente-v2-pruebas/v3` o la de producción)
Primero **sin aprobar nada** para ver qué bloquea:
```
node scripts/xlsx-a-consolidado.js --origen /root/c12-entrada/ARCHIVO.xlsx --destino /root/c12-entrada/c12-consolidado.json --esperados N
```
- Si hay filas "Revisar", **se detiene y no escribe nada**, listando los códigos.
- Comprobar cada una **contra el catálogo impreso o el PDF**. Si son correctas, aprobarlas **por código**: `--aprobar COD1,COD2,...`. Cualquier otra fila "Revisar" sigue bloqueando y un código que no estaba marcado también se rechaza (evita errores de tecleo).
- `--esperados N`: debe coincidir con el total del Excel; si no, no escribe nada. No sobrescribe archivos existentes (usar otro nombre o `--sobrescribir`).
- La salida solo muestra conteos (productos, con precio, sin precio, 2 x 1 aparentes, repetidos, "Revisar" admitidas), nunca nombres ni precios.

### Paso 4. Revisar los hallazgos de negocio
| Qué mirar | Qué hacer |
|---|---|
| Productos con oferta sin precio normal que **no** dicen "2 x 1" (bolsas, cajas, "dentro del set") | Decidir cómo presentarlos. **Compra especial**: precio con la aclaración de que solo aplica con la compra de un producto. **Dentro de un set**: no debe presentarse como precio suelto |
| "Sin ningún precio" que no sean obsequios | Pueden ser productos vendibles sin código en el catálogo; por defecto quedan como "sin precio" y el asistente dirá que no tiene el dato |
| Cambios de tipo de oferta respecto a la campaña anterior (p. ej. un 2 x 1 que pasó a precio dentro de un set) | Verificar la página correspondiente |

### Paso 5. Ensayo de carga (no escribe nada)
```
node scripts/cargar-campana.js --origen /root/c12-entrada/c12-consolidado.json --campana "C12 2026" --desde 2026-11-07 --hasta 2026-12-04 --esperados N
```
Muestra el plan y la **auditoría con las reglas del asistente**: `dos_por_uno_deducido`, `solo_oferta`, `obsequios`, `sin_ningun_precio`, `promocion_no_coincide` (debe ser 0 en un catálogo sano: indica que la suma de los componentes de un set no da su precio, o que un precio no coincide con su texto) y `solo_dentro_de_set`. Termina con "ENSAYO: no se escribió nada".

### Paso 6. Programar (con la frase de autorización de la usuaria)
Mismo comando con `--aplicar`. Guarda copia de lo que reemplaza en `data/campanas-anteriores/`, escribe de forma atómica y deja `catalogo_lectura_siguiente.json` y `campana_siguiente.json`. La campaña **entra sola a las 00:00 (hora de Colombia) de `--desde`**, sin reiniciar; hasta entonces responde la actual. El servidor lee estos archivos **al arrancar**: reiniciar el asistente después de programar (la campaña actual sigue respondiendo hasta la fecha).

### Paso 7. Después de que entre en vigor
`node scripts/cargar-campana.js --promover --aplicar` convierte la campaña programada en la actual y deja los archivos en orden.
Comprobar en el navegador que el banner diga la campaña nueva con sus fechas y probar 3 consultas reales (un producto normal, un 2 x 1 y un obsequio).

## 5. Qué hace cada herramienta (garantías)

| Herramienta | Garantías |
|---|---|
| Artefacto de precios | Cada precio y código se comprueba contra el texto de su página; marca lo que no coincide; reintenta páginas con códigos sin recoger |
| `xlsx-a-consolidado.js` | Lee el `.xlsx` sin dependencias; rechaza filas "Revisar" sin aprobar, precios no numéricos, oferta mayor que el precio normal, códigos vacíos o sin nombre; límite de descompresión; escribe un archivo nuevo con permisos 600; no toca el panel ni el asistente |
| `cargar-campana.js` | Ensayo por defecto; valida el total esperado; audita con las reglas del asistente; copia previa; escritura atómica; no borra nada |
| Asistente | Los precios y vigencias salen de código; verificador de importes; ficha determinista si el modelo falla |

## 6. Resultado de la prueba con el C12 (30 oct 2026)

| Dato | Valor |
|---|---|
| Excel | `Catalogo_Yanbal_C12_2026_Precios.xlsx`, 35.599 bytes, huella `e722e7de…901f593` |
| Productos | 452 (425 con precio y 27 sin precio) |
| 2 x 1 | 22 |
| Obsequios | 11 |
| Sets | 24, todos con la suma de componentes igual al precio del set |
| Filas "Revisar" | 14, en las páginas 26 (colonias Soy: oferta $32.500, normal $65.000) y 56 (bases líquidas: $60.500 / $110.000): por comprobar contra el PDF |
| Sin ningún precio, no obsequio | 16 (en C11 eran 3) |
| A verificar | 5104 a $28.000 dentro de un set (pág. 66) y 43891 a $24.000 dentro de un set (pág. 113); compra especial 60099, 60100, 60121 y 60124 |
| Auditoría final del ensayo | `promocion_no_coincide: 0` tras corregir la regla de sets |

## 7. Riesgos y lecciones

| Riesgo | Mitigación |
|---|---|
| Un precio mal leído llega a las clientas | Comprobación contra el texto de la página, aprobación por código tras revisión humana y auditoría de coherencia |
| Formato distinto del Excel o del texto de las promociones entre campañas (el C12 escribe los sets sin la marca del C11) | El auditor lo muestra como `promocion_no_coincide`; las reglas se corrigen con pruebas antes de cargar |
| La campaña programada no entra porque el servidor no tiene el código v2 o no se reinició tras programarla | Desplegar la v2 antes; comprobar el banner el primer día |
| Se pierde el PDF o el Excel | Quedan en `/root/c12-entrada/`; el respaldo diario no los cubre (carpeta fuera de `/opt`) |

## 8. Fuera de alcance (decisión pendiente)

El panel (437 productos) y Supabase (427) siguen en C11 y **no alimentan al asistente**. Si se quieren actualizar, es un proceso aparte; antes hay que decidir cuál es la fuente única de verdad (ver `CONTEXTO_TECNICO_Y_DISENO.md`, sección 9, y `ESTADO_PROYECTO_Y_PENDIENTES.md`, 11.6).
