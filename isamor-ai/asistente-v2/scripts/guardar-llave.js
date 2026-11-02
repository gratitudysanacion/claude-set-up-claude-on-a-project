#!/usr/bin/env node
'use strict';
// Guarda ANTHROPIC_API_KEY en .env (permisos 600). La llave se escribe sin mostrarse y nunca se imprime.
// Uso (terminal interactiva, en la carpeta del asistente):  node scripts/guardar-llave.js
const fs = require('node:fs');
const path = require('node:path');

const ARCHIVO = process.env.ARCHIVO_ENV || path.join(__dirname, '..', '.env');
const NOMBRE = 'ANTHROPIC_API_KEY';

function leerOculto(texto) {
  return new Promise((resolve, reject) => {
    const entrada = process.stdin;
    process.stdout.write(texto);
    let valor = '';
    entrada.setRawMode(true);
    entrada.resume();
    entrada.setEncoding('utf8');
    const alRecibir = trozo => {
      for (const c of trozo) {
        if (c === '\u0003') { fin(); reject(new Error('Cancelado.')); return; }
        if (c === '\r' || c === '\n') { fin(); process.stdout.write('\n'); resolve(valor); return; }
        if (c === '\u007f' || c === '\b') { valor = valor.slice(0, -1); continue; }
        valor += c;
      }
    };
    function fin() { entrada.removeListener('data', alRecibir); entrada.setRawMode(false); entrada.pause(); }
    entrada.on('data', alRecibir);
  });
}

async function principal() {
  if (!process.stdin.isTTY) {
    console.error('Este script solo funciona en una terminal interactiva (no acepta la llave por tuberías ni argumentos).');
    process.exit(2);
  }
  const llave = (await leerOculto('Pega la API key (no se muestra) y presiona Enter: ')).trim();
  if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(llave)) throw new Error('Eso no parece una API key de Anthropic (debe empezar por sk-ant-). No se guardó nada.');

  let lineas = [];
  try { lineas = fs.readFileSync(ARCHIVO, 'utf8').split('\n').filter(l => l.trim() && !l.trim().startsWith(`${NOMBRE}=`)); } catch { /* archivo nuevo */ }
  lineas.push(`${NOMBRE}=${llave}`);
  const temporal = `${ARCHIVO}.tmp`;
  fs.writeFileSync(temporal, lineas.join('\n') + '\n', { mode: 0o600 });
  fs.renameSync(temporal, ARCHIVO);
  fs.chmodSync(ARCHIVO, 0o600);
  console.log(`Llave guardada en ${ARCHIVO} (permisos 600). Termina en ...${llave.slice(-4)}. No se muestra completa.`);
}

principal().catch(e => { console.error(e.message); process.exit(1); });
