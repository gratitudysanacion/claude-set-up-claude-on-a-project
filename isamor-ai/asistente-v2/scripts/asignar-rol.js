#!/usr/bin/env node
'use strict';
// Define si un usuario es administrador ("admin") o usuaria común ("usuaria"). No toca su clave.
// La administradora puede LEER los datos del Gestor de ventas de otras usuarias (soporte; cada lectura queda registrada).
// Uso:  node scripts/asignar-rol.js USUARIO admin|usuaria
// Después de cambiarlo, reinicia el asistente para que cargue el cambio.
const fs = require('node:fs');
const path = require('node:path');

const ARCHIVO = process.env.USUARIOS || path.join(__dirname, '..', 'data', 'usuarios.json');

function principal() {
  const [usuarioArg, rolArg] = process.argv.slice(2);
  if (!usuarioArg || !['admin', 'usuaria'].includes(rolArg)) throw new Error('Uso: node scripts/asignar-rol.js USUARIO admin|usuaria');
  const usuario = usuarioArg.trim().toLowerCase();
  const datos = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8'));
  if (!datos.usuarios || !Object.prototype.hasOwnProperty.call(datos.usuarios, usuario)) throw new Error(`El usuario "${usuario}" no existe.`);
  if (rolArg === 'admin') datos.usuarios[usuario].rol = 'admin'; else delete datos.usuarios[usuario].rol;
  const temporal = `${ARCHIVO}.tmp`;
  fs.writeFileSync(temporal, JSON.stringify(datos, null, 2), { mode: 0o600 });
  fs.renameSync(temporal, ARCHIVO);
  fs.chmodSync(ARCHIVO, 0o600);
  console.log(`Usuario "${usuario}": rol = ${rolArg}. Reinicia el asistente para aplicar el cambio.`);
}

try { principal(); } catch (e) { console.error(e.message); process.exit(1); }
