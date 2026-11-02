#!/usr/bin/env node
'use strict';
// Cambia los módulos que puede usar un usuario existente. No toca su clave (no pide ni muestra secretos).
// Uso:  node scripts/asignar-modulos.js USUARIO sales,content,beauty,manager
// Después de cambiarlos, reinicia el asistente para que cargue el cambio.
const fs = require('node:fs');
const path = require('node:path');
const { MODULOS_VALIDOS } = require('../src/auth');

const ARCHIVO = process.env.USUARIOS || path.join(__dirname, '..', 'data', 'usuarios.json');

function principal() {
  const [usuarioArg, listaArg] = process.argv.slice(2);
  if (!usuarioArg || !listaArg) throw new Error(`Uso: node scripts/asignar-modulos.js USUARIO ${MODULOS_VALIDOS.join(',')}`);
  const usuario = usuarioArg.trim().toLowerCase();
  const modulos = [...new Set(listaArg.split(',').map(m => m.trim()).filter(Boolean))];
  const invalidos = modulos.filter(m => !MODULOS_VALIDOS.includes(m));
  if (!modulos.length || invalidos.length) throw new Error(`Módulos no válidos: ${invalidos.join(', ') || '(vacío)'}. Válidos: ${MODULOS_VALIDOS.join(', ')}.`);

  const datos = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8'));
  if (!datos.usuarios || !Object.prototype.hasOwnProperty.call(datos.usuarios, usuario)) throw new Error(`El usuario "${usuario}" no existe.`);
  datos.usuarios[usuario].modulos = modulos;

  const temporal = `${ARCHIVO}.tmp`;
  fs.writeFileSync(temporal, JSON.stringify(datos, null, 2), { mode: 0o600 });
  fs.renameSync(temporal, ARCHIVO);
  fs.chmodSync(ARCHIVO, 0o600);
  console.log(`Usuario "${usuario}": módulos = ${modulos.join(', ')}. Reinicia el asistente para aplicar el cambio.`);
}

try { principal(); } catch (e) { console.error(e.message); process.exit(1); }
