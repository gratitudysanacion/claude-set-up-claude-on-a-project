#!/usr/bin/env node
'use strict';
// Crea o actualiza un usuario del asistente. La clave se pide SIN mostrarla y nunca se acepta por argumentos ni variables.
// Uso (en una terminal interactiva):  node scripts/crear-usuario.js
const fs = require('node:fs');
const path = require('node:path');
const { crearRegistroUsuario, fusionarRegistro, MODULOS_VALIDOS } = require('../src/auth');

const MINIMO = 12;
const ARCHIVO = process.env.USUARIOS || path.join(__dirname, '..', 'data', 'usuarios.json');

function preguntar(texto, oculto) {
  return new Promise((resolve, reject) => {
    const entrada = process.stdin;
    process.stdout.write(texto);
    let valor = '';
    if (oculto) entrada.setRawMode(true);
    entrada.resume();
    entrada.setEncoding('utf8');
    const alRecibir = trozo => {
      for (const c of trozo) {
        if (c === '\u0003') { limpiar(); reject(new Error('Cancelado.')); return; }
        if (c === '\r' || c === '\n') { limpiar(); process.stdout.write('\n'); resolve(valor); return; }
        if (c === '\u007f' || c === '\b') { valor = valor.slice(0, -1); continue; }
        valor += c;
        if (!oculto) process.stdout.write(c);
      }
    };
    function limpiar() {
      entrada.removeListener('data', alRecibir);
      if (oculto) entrada.setRawMode(false);
      entrada.pause();
    }
    entrada.on('data', alRecibir);
  });
}

async function principal() {
  if (!process.stdin.isTTY) {
    console.error('Este script solo funciona en una terminal interactiva (no acepta la clave por tuberías ni argumentos).');
    process.exit(2);
  }
  const usuario = (await preguntar('Usuario: ', false)).trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(usuario)) throw new Error('El usuario debe tener de 3 a 32 caracteres (letras, números, punto, guion).');
  const clave = await preguntar(`Clave (mínimo ${MINIMO} caracteres, no se muestra): `, true);
  if (clave.length < MINIMO) throw new Error(`La clave debe tener al menos ${MINIMO} caracteres.`);
  const repetida = await preguntar('Repite la clave: ', true);
  if (clave !== repetida) throw new Error('Las claves no coinciden. No se guardó nada.');

  let datos = { usuarios: {} };
  try { datos = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8')); } catch { /* archivo nuevo */ }
  datos.usuarios = datos.usuarios || {};

  // Módulos que podrá usar. Enter conserva los que ya tenía (o solo "sales" si es un usuario nuevo).
  const existente = datos.usuarios[usuario];
  const actuales = existente && Array.isArray(existente.modulos) && existente.modulos.length ? existente.modulos : ['sales'];
  const texto = (await preguntar(`Módulos permitidos (${MODULOS_VALIDOS.join(', ')}; separados por coma) [Enter = ${actuales.join(',')}]: `, false)).trim();
  const modulos = texto ? texto.split(',').map(m => m.trim()).filter(Boolean) : actuales;
  const invalidos = modulos.filter(m => !MODULOS_VALIDOS.includes(m));
  if (invalidos.length) throw new Error(`Módulos no válidos: ${invalidos.join(', ')}. No se guardó nada.`);
  // Conserva el rol, el estado y demás campos del usuario existente; solo cambia la clave y los módulos.
  datos.usuarios[usuario] = fusionarRegistro(existente, await crearRegistroUsuario(clave), [...new Set(modulos)]);

  fs.mkdirSync(path.dirname(ARCHIVO), { recursive: true });
  const temporal = `${ARCHIVO}.tmp`;
  fs.writeFileSync(temporal, JSON.stringify(datos, null, 2), { mode: 0o600 });
  fs.renameSync(temporal, ARCHIVO);
  fs.chmodSync(ARCHIVO, 0o600);
  console.log(`Usuario "${usuario}" guardado en ${ARCHIVO} (permisos 600). La clave no se almacenó: solo su hash.`);
}

principal().catch(e => { console.error(e.message); process.exit(1); });
