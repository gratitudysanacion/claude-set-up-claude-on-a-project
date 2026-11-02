#!/usr/bin/env node
'use strict';
// Restaura la base del Gestor de ventas desde una copia hecha con respaldar-gestor.js.
//  - Por defecto es un ENSAYO: verifica la copia y la llave, y muestra el plan. Con --aplicar escribe.
//  - Exige que el asistente esté DETENIDO (--asistente-detenido): restaurar con el servicio activo puede corromper la base.
//  - Antes de tocar nada verifica la integridad de la copia y que la llave actual DESCIFRA datos de la copia: restaurar con otra llave
//    dejaría los datos personales ilegibles.
//  - Antes de reemplazar guarda una copia consistente de la base actual (gestor.db.antes-restauracion-FECHA) y elimina los archivos
//    -wal/-shm viejos (si quedaran, SQLite los aplicaría sobre la base restaurada).
//  - No imprime datos personales ni la llave.
// Uso:  node scripts/restaurar-gestor.js --copia RUTA [--destino RUTA_BASE] [--env RUTA_ENV] [--aplicar --asistente-detenido]
const fs = require('node:fs');
const path = require('node:path');
const { cargarEnv } = require('../src/env');
const { crearCifrado } = require('../src/cifrado');
const { verificarCopia, ErrorRespaldo } = require('./respaldar-gestor');

const MUESTRA = 5;
const comillas = ruta => `'${String(ruta).replace(/'/g, "''")}'`;
const sello = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

// Descifra el teléfono de hasta MUESTRA clientas de la copia. Devuelve { probadas, fallidas }.
function probarLlave(copia, llaveHex) {
  const { DatabaseSync } = require('node:sqlite');
  const cifrado = crearCifrado(llaveHex);
  const db = new DatabaseSync(copia, { readOnly: true });
  try {
    const filas = db.prepare('SELECT id, usuaria, telefono_cif FROM clientas ORDER BY creada LIMIT ?').all(MUESTRA);
    let fallidas = 0;
    for (const f of filas) {
      try { cifrado.descifrar(f.telefono_cif, `${f.usuaria}|${f.id}|telefono`); } catch { fallidas++; }
    }
    return { probadas: filas.length, fallidas };
  } finally { db.close(); }
}

function restaurar({ copia, destino, llaveHex, aplicar = false, asistenteDetenido = false }) {
  if (!fs.existsSync(copia)) throw new ErrorRespaldo('No existe la copia indicada.');
  const resultado = verificarCopia(copia);
  if (!llaveHex) throw new ErrorRespaldo('No hay GESTOR_LLAVE: sin la llave actual no se puede comprobar que la copia sea legible.');
  const llave = probarLlave(copia, llaveHex);
  if (llave.fallidas > 0) throw new ErrorRespaldo('La llave actual NO descifra los datos de esta copia (llave distinta o datos alterados). No se tocó nada.');
  const plan = { clientas: resultado.clientas, llave_probada: llave.probadas, existe_actual: fs.existsSync(destino) };
  if (!aplicar) return { estado: 'ensayo', ...plan };
  if (!asistenteDetenido) throw new ErrorRespaldo('Falta --asistente-detenido: detén el asistente antes de restaurar (pm2 stop yanbal-assistant).');

  const { DatabaseSync } = require('node:sqlite');
  let respaldoActual = null;
  if (plan.existe_actual) {
    respaldoActual = `${destino}.antes-restauracion-${sello()}`;
    const actual = new DatabaseSync(destino, { readOnly: true });
    try { actual.exec(`VACUUM INTO ${comillas(respaldoActual)}`); } finally { actual.close(); }
    fs.chmodSync(respaldoActual, 0o600);
    verificarCopia(respaldoActual);
  }
  const temporal = `${destino}.restaurando`;
  fs.rmSync(temporal, { force: true });
  fs.copyFileSync(copia, temporal);
  fs.chmodSync(temporal, 0o600);
  verificarCopia(temporal);
  for (const s of ['-wal', '-shm']) fs.rmSync(destino + s, { force: true });
  fs.renameSync(temporal, destino);
  fs.chmodSync(destino, 0o600);
  verificarCopia(destino);
  return { estado: 'restaurada', ...plan, respaldo_actual: respaldoActual ? path.basename(respaldoActual) : null };
}

function principal() {
  const a = process.argv.slice(2);
  const arg = n => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
  const copia = arg('--copia');
  if (!copia) throw new ErrorRespaldo('Uso: node scripts/restaurar-gestor.js --copia RUTA [--aplicar --asistente-detenido]');
  const raiz = path.join(__dirname, '..');
  const destino = arg('--destino') || process.env.GESTOR_DB || path.join(raiz, 'data', 'gestor.db');
  if (!process.env.GESTOR_LLAVE) delete process.env.GESTOR_LLAVE;   // una variable vacía no debe impedir leer el .env
  cargarEnv(arg('--env') || path.join(raiz, '.env'));
  const r = restaurar({ copia, destino, llaveHex: process.env.GESTOR_LLAVE, aplicar: a.includes('--aplicar'), asistenteDetenido: a.includes('--asistente-detenido') });
  console.log(`Copia verificada: ${r.clientas} clientas; la llave actual descifró ${r.llave_probada} de ${r.llave_probada} datos de muestra.`);
  if (r.estado === 'ensayo') console.log('ENSAYO: no se cambió nada. Agrega --aplicar --asistente-detenido para restaurar.');
  else console.log(`RESTAURADA en ${destino}.${r.respaldo_actual ? ` La base anterior quedó en ${r.respaldo_actual}.` : ''} Reinicia el asistente.`);
}

if (require.main === module) {
  try { principal(); } catch (e) {
    console.error(`ERROR: ${e instanceof ErrorRespaldo ? e.message : `inesperado (${e.code || e.name})`}`);
    process.exit(1);
  }
}

module.exports = { restaurar, probarLlave };
