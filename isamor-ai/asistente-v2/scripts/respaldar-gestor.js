#!/usr/bin/env node
'use strict';
// Respaldo CONSISTENTE de la base del Gestor de ventas (SQLite, modo WAL), con el asistente en marcha.
//  - Copia con VACUUM INTO desde una conexión de solo lectura: incluye lo que aún está en el archivo -wal y no bloquea la escritura.
//  - Verifica la copia (integrity_check, versión de esquema, tablas) ANTES de darla por buena; si falla, no deja nada a medias.
//  - Archivos 600 en una carpeta 700. Escritura atómica (temporal + renombrado).
//  - Retención por NÚMERO de copias (no por fecha): nunca borra copias si la nueva no se pudo verificar.
//  - Imprime solo conteos y nombres de archivo, nunca datos personales ni llaves.
// La llave GESTOR_LLAVE NO está en el respaldo (vive en .env): guárdala aparte; sin ella la copia no se puede leer.
// Uso:  node scripts/respaldar-gestor.js [--origen RUTA_BASE] [--destino CARPETA] [--conservar 14]
// Requiere Node 22+ (node:sqlite). Códigos de salida: 0 = bien (o aún no hay base); 1 = falló; 2 = Node sin SQLite.
const fs = require('node:fs');
const path = require('node:path');

class ErrorRespaldo extends Error {}

const TABLAS = ['clientas', 'historial_etapas', 'recordatorios', 'accesos'];
const PATRON = /^gestor-\d{8}-\d{6}(?:-\d+)?\.db$/;
const MINIMO_CONSERVAR = 3;

const sello = (fecha = new Date()) => fecha.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15); // AAAAMMDD-HHMMSS (UTC)
const comillas = ruta => `'${String(ruta).replace(/'/g, "''")}'`;

function abrirSqlite() {
  try { return require('node:sqlite'); } catch { throw Object.assign(new ErrorRespaldo('Este Node no trae SQLite integrado (requiere Node 22 o superior).'), { salida: 2 }); }
}

// Comprueba una copia: integridad, versión de esquema y tablas. Devuelve { clientas, version }. Lanza ErrorRespaldo si algo falla.
function verificarCopia(ruta, { versionEsperada } = {}) {
  const { DatabaseSync } = abrirSqlite();
  let db;
  try {
    db = new DatabaseSync(ruta, { readOnly: true });
    const integridad = db.prepare('PRAGMA integrity_check').get().integrity_check;
    if (integridad !== 'ok') throw new ErrorRespaldo('La copia no pasó la comprobación de integridad.');
    const version = db.prepare('PRAGMA user_version').get().user_version;
    if (versionEsperada !== undefined && version !== versionEsperada) throw new ErrorRespaldo('La versión de esquema de la copia no coincide con la de la base.');
    const existentes = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(f => f.name));
    for (const t of TABLAS) if (!existentes.has(t)) throw new ErrorRespaldo(`A la copia le falta la tabla ${t}.`);
    return { clientas: db.prepare('SELECT count(*) AS n FROM clientas').get().n, version };
  } catch (e) {
    if (e instanceof ErrorRespaldo) throw e;
    throw new ErrorRespaldo('La copia está dañada o no se pudo abrir.');
  } finally {
    if (db) try { db.close(); } catch { /* ya cerrada */ }
  }
}

function listarCopias(destino) {
  try { return fs.readdirSync(destino).filter(n => PATRON.test(n)).sort(); } catch { return []; }
}

function respaldar({ origen, destino, conservar = 14, ahora = () => new Date() }) {
  if (!Number.isInteger(conservar) || conservar < MINIMO_CONSERVAR) throw new ErrorRespaldo(`--conservar debe ser un entero de ${MINIMO_CONSERVAR} o más.`);
  const { DatabaseSync } = abrirSqlite();
  if (!fs.existsSync(origen)) return { estado: 'sin_base' };

  fs.mkdirSync(destino, { recursive: true, mode: 0o700 });
  fs.chmodSync(destino, 0o700);
  const temporal = path.join(destino, `.respaldando-${process.pid}.db`);
  const limpiar = () => { for (const s of ['', '-wal', '-shm', '-journal']) try { fs.rmSync(temporal + s, { force: true }); } catch { /* nada */ } };
  limpiar();

  let fuente;
  try {
    fuente = new DatabaseSync(origen, { readOnly: true });
    const versionOrigen = fuente.prepare('PRAGMA user_version').get().user_version;
    fuente.exec(`VACUUM INTO ${comillas(temporal)}`);
    fs.chmodSync(temporal, 0o600);
    const resultado = verificarCopia(temporal, { versionEsperada: versionOrigen });

    let nombre = `gestor-${sello(ahora())}.db`;
    for (let n = 2; fs.existsSync(path.join(destino, nombre)); n++) nombre = `gestor-${sello(ahora())}-${n}.db`;
    fs.renameSync(temporal, path.join(destino, nombre));

    // Retención: solo después de que la copia nueva quedó verificada y en su lugar.
    const copias = listarCopias(destino);
    const sobrantes = copias.slice(0, Math.max(0, copias.length - conservar));
    for (const s of sobrantes) fs.rmSync(path.join(destino, s), { force: true });
    return { estado: 'ok', archivo: nombre, clientas: resultado.clientas, bytes: fs.statSync(path.join(destino, nombre)).size, borradas: sobrantes.length, total: copias.length - sobrantes.length };
  } catch (e) {
    if (e instanceof ErrorRespaldo) throw e;
    throw new ErrorRespaldo(`No se pudo copiar la base (${e.code || e.name}).`);
  } finally {
    if (fuente) try { fuente.close(); } catch { /* ya cerrada */ }
    limpiar();
  }
}

function principal() {
  const a = process.argv.slice(2);
  const arg = n => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
  const raiz = path.join(__dirname, '..');
  const origen = arg('--origen') || process.env.GESTOR_DB || path.join(raiz, 'data', 'gestor.db');
  const destino = arg('--destino') || process.env.DESTINO_RESPALDO_GESTOR || '/opt/respaldos-yanbal/gestor';
  const conservar = arg('--conservar') === undefined ? 14 : Number(arg('--conservar'));
  const r = respaldar({ origen, destino, conservar });
  const t = sello();
  if (r.estado === 'sin_base') console.log(`[${t}] Aún no hay base del Gestor en ${origen}; nada que respaldar.`);
  else console.log(`[${t}] OK ${r.archivo} (${r.clientas} clientas, ${r.bytes} bytes; copias guardadas: ${r.total}${r.borradas ? `, retiradas: ${r.borradas}` : ''})`);
}

if (require.main === module) {
  try { principal(); } catch (e) {
    console.error(`[${sello()}] ERROR: ${e instanceof ErrorRespaldo ? e.message : `inesperado (${e.code || e.name})`}`);
    process.exit(e.salida || 1);
  }
}

module.exports = { respaldar, verificarCopia, listarCopias, ErrorRespaldo, PATRON };
