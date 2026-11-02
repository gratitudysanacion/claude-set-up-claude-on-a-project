# ISAMOR AI – Diseño del respaldo de la base del Gestor de ventas
## Versión 1.1 · 2 de noviembre de 2026 · Estado: **PROPUESTO (pendiente de aprobación de la usuaria)**

> No contiene claves ni valores de variables de entorno.

## 1. Objetivo y alcance

Garantizar que la base SQLite del Gestor (`data/gestor.db`, con datos personales cifrados) se respalde de forma **consistente**, se pueda **restaurar con una prueba comprobada** y no exponga datos personales. Alcance: producción, antes de usar el Gestor con clientas reales. Fuera de alcance: el respaldo del catálogo y del código (ya existen).

## 2. Problema

| Hecho | Consecuencia |
|---|---|
| La base está en modo WAL: los datos recientes viven también en `gestor.db-wal` | Copiar solo `gestor.db` pierde cambios; copiar los tres archivos en caliente puede dar una copia inconsistente |
| El respaldo diario (cron 08:00 UTC) copia archivos de `/opt` | Si incluye `gestor.db*`, la copia puede estar rota; si no, la base no tiene respaldo |
| El respaldo excluye el `.env` | Sin la llave `GESTOR_LLAVE` la copia es ilegible: **hay que respaldar la llave aparte** |
| Todo queda en el mismo servidor | Una pérdida del VPS se lleva la base y sus copias |

### Hallazgos del script de respaldo actual (leído el 2 nov, solo lectura)

| Hallazgo | Consecuencia para el diseño |
|---|---|
| `/opt/respaldos-yanbal/respaldo-yanbal.sh`, cron `0 8 * * *`, `set -euo pipefail`, `umask 077` | Cualquier paso nuevo dentro de este script que falle **aborta todo el respaldo del catálogo y del código** |
| El `tar` guarda `-C /opt yanbal-assistant` completo, **sin excluir `data/gestor.db*`** (excluye `.env`, `node_modules`, `data/backups`) | Con el Gestor en producción el `tar` copiaría la base en caliente (posiblemente rota) y duplicaría datos personales dentro de un archivo de código. Hay que excluirla |
| Retención con `find -mtime +14 -delete` | Si el cron fallara más de 14 días, se borrarían **todas** las copias. El script nuevo cuenta copias en vez de fechas |
| `.env` excluido del respaldo | Confirma que la llave del Gestor debe guardarse aparte |
| Respaldos solo dentro del VPS; `baseline-20261026` con permisos 755 | Copia externa pendiente; ajustar permisos de esa carpeta (hardening) |
| Log del 27 oct al 1 nov, todos OK | El mecanismo es estable |

## 3. Alternativas

| Opción | Ventajas | Desventajas | Veredicto |
|---|---|---|---|
| A. Detener el asistente y copiar archivos | Simple | Corta el servicio cada noche; error humano | Descartada |
| B. Copiar `gestor.db`, `-wal` y `-shm` en caliente | Sin código nuevo | Puede ser inconsistente | Descartada |
| C. `sqlite3 .backup` (CLI) | Estándar | El CLI puede no estar instalado | Descartada |
| **D. `VACUUM INTO` desde Node 22** | Copia consistente con el servicio en marcha, compacta, sin dependencias nuevas; comprobado en el sandbox (`integrity_check: ok`) | Requiere el Node 22 que ya se instalará | **Recomendada** |
| E. `backup()` integrado de Node 22 | Equivalente; también disponible (comprobado) | Más código | Alternativa |

## 4. Diseño recomendado

**Script `scripts/respaldar-gestor.js`** (sin dependencias, Node 22):
1. Abre la base **solo para lectura** y ejecuta `VACUUM INTO` a un archivo temporal en la carpeta de destino.
2. Verifica `PRAGMA integrity_check = ok` y que el número de clientas sea legible.
3. Aplica permisos **600** (la copia sale 644 por defecto: comprobado) y renombra de forma atómica a `gestor-AAAAMMDD-HHMMSS.db`.
4. Conserva las últimas **14** copias diarias y nunca borra la única copia válida.
5. Imprime solo conteos y rutas, nunca datos.

**Script `scripts/restaurar-gestor.js`**: exige el asistente detenido, hace antes una copia de la base actual, verifica la integridad de la copia elegida y **comprueba que la llave actual descifra un registro de muestra** (si no, aborta: restaurar con otra llave deja los datos ilegibles).

| Elemento | Decisión propuesta |
|---|---|
| Carpeta de destino | `/opt/respaldos-yanbal/gestor/`, permisos **700**, archivos **600** |
| Frecuencia | Diaria, justo después del respaldo actual (cron 08:00 UTC = 03:00 Colombia) |
| Retención | 14 copias |
| Respaldo actual de `/opt` | **Excluir `gestor.db*`**: una sola línea nueva en el `tar` (`--exclude='gestor.db*'`), con copia previa del script |
| Integración | **Script y línea de cron separados** (08:10 UTC), no dentro del script actual: un fallo en uno no bloquea al otro |
| Llave `GESTOR_LLAVE` | Guardada **por la usuaria** en su gestor de contraseñas, nunca en el respaldo ni en el chat |
| Copia fuera del servidor | Descarga periódica (semanal) con `scp` y snapshot de hPanel; opción de pago: copia cifrada en un servicio externo |

## 5. Pruebas previstas

Prueba automática de copia con escritor concurrente **en otro proceso**, integridad, permisos, retención, aborto si la base está dañada, restauración con llave correcta y con llave equivocada (debe abortar), y ensayo completo en una réplica local de producción y luego en pruebas.

## 6. Riesgos

| Riesgo | Mitigación |
|---|---|
| Pérdida de la llave | Copia en el gestor de contraseñas; sin ella la base no se recupera |
| Respaldos con datos personales en el mismo servidor | Permisos 700/600, retención corta, cifrado de campos; descarga fuera del servidor cifrada o con acceso restringido |
| El cron falla sin avisar | El script escribe un registro con fecha y resultado; comprobación semanal manual del último archivo |
| Restaurar con una llave distinta | `restaurar-gestor.js` lo detecta y aborta |

## 7. Plan de acción

1. Aprobación de este diseño.
2. Implementar y probar los dos scripts en el sandbox.
3. Instalar en **pruebas** y ensayar copia y restauración reales.
4. Ver (solo lectura) el script del respaldo actual y ajustarlo (excluir `gestor.db*` y llamar al nuevo script), con respaldo previo y frase de autorización.
5. Más adelante, con el paso a Node 22 en producción, activar el cron.

## 8. Decisiones pendientes de la usuaria

Retención (14 copias), destino de la copia externa, y aprobar la exclusión de `gestor.db*` del respaldo actual.
