#!/usr/bin/env node
'use strict';
// Crea la llave de cifrado del Gestor de ventas (GESTOR_LLAVE) y la guarda en .env con permisos 600.
// IMPORTANTE: si esta llave se pierde, los teléfonos, cédulas, direcciones y notas guardados NO se pueden recuperar.
// El respaldo diario excluye el .env a propósito: guarda una copia de la llave en tu gestor de contraseñas.
// Nunca sobrescribe una llave existente (cambiarla dejaría ilegibles los datos ya guardados).
// Uso (terminal del servidor, en la carpeta del asistente):  node scripts/crear-llave-gestor.js
const fs = require('node:fs');
const path = require('node:path');
const { generarLlaveHex } = require('../src/cifrado');

const ARCHIVO = process.env.ARCHIVO_ENV || path.join(__dirname, '..', '.env');
const NOMBRE = 'GESTOR_LLAVE';

function principal() {
  let lineas = [];
  try { lineas = fs.readFileSync(ARCHIVO, 'utf8').split('\n').filter(l => l.trim()); } catch { /* archivo nuevo */ }
  if (lineas.some(l => l.trim().startsWith(`${NOMBRE}=`))) {
    console.error(`Ya existe ${NOMBRE} en ${ARCHIVO}. No se cambió nada: reemplazarla dejaría ilegibles los datos ya guardados.`);
    process.exit(3);
  }
  const llave = generarLlaveHex();
  lineas.push(`${NOMBRE}=${llave}`);
  const temporal = `${ARCHIVO}.tmp`;
  fs.writeFileSync(temporal, lineas.join('\n') + '\n', { mode: 0o600 });
  fs.renameSync(temporal, ARCHIVO);
  fs.chmodSync(ARCHIVO, 0o600);
  console.log(`Llave creada y guardada en ${ARCHIVO} (permisos 600).`);
  console.log('');
  console.log('GUARDA AHORA UNA COPIA EN TU GESTOR DE CONTRASEÑAS (esta es la única vez que se muestra):');
  console.log('');
  console.log(`  ${llave}`);
  console.log('');
  console.log('Cuando la hayas guardado, limpia la pantalla con:  clear   (y no la pegues en ningún chat).');
}

try { principal(); } catch (e) { console.error(e.message); process.exit(1); }
