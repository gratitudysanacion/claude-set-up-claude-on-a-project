'use strict';
// Lector mínimo de archivos .env (sin dependencias). Nunca imprime valores.
const fs = require('node:fs');

function parsearEnv(texto) {
  const salida = {};
  for (const linea of String(texto).split(/\r?\n/)) {
    if (/^\s*#/.test(linea)) continue;
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(linea);
    if (!m) continue;
    let valor = m[2];
    if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
      valor = valor.slice(1, -1);
    }
    salida[m[1]] = valor;
  }
  return salida;
}

// Carga las variables que aún no existan en `destino`. Devuelve SOLO los nombres cargados.
function cargarEnv(ruta, destino = process.env) {
  let texto;
  try { texto = fs.readFileSync(ruta, 'utf8'); } catch { return []; }
  const datos = parsearEnv(texto);
  for (const [clave, valor] of Object.entries(datos)) {
    if (!(clave in destino)) destino[clave] = valor;
  }
  return Object.keys(datos);
}

// true si el archivo es legible por el grupo u otros (debería ser 600).
function permisosInseguros(ruta) {
  try { return (fs.statSync(ruta).mode & 0o077) !== 0; } catch { return false; }
}

module.exports = { parsearEnv, cargarEnv, permisosInseguros };
