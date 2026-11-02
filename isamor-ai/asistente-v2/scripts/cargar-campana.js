#!/usr/bin/env node
'use strict';
// Carga una campaña nueva (p. ej. C12) en el asistente SIN tocar el panel.
//   Programar (por defecto): deja la campaña lista y entra en vigor sola a las 00:00 (hora de Colombia) de su fecha de inicio.
//   Reemplazar: sustituye la campaña actual ahora mismo.
//   Promover: convierte la campaña programada en la actual (después de que entró en vigor), para dejar los archivos en orden.
// Sin --aplicar es un ensayo: valida, audita y muestra el plan, pero no escribe nada.
// Con --aplicar guarda antes una copia de lo que reemplaza en data/campanas-anteriores/ y escribe de forma atómica. No borra nada.
//
// Uso:
//   node scripts/cargar-campana.js --origen RUTA --campana "C12 2026" --desde 2026-11-07 --hasta 2026-12-04 --esperados N [--modo programar|reemplazar] [--aplicar]
//   node scripts/cargar-campana.js --promover [--aplicar]
const fs = require('node:fs');
const path = require('node:path');
const { construirLectura } = require('./exportar-lectura');
const { auditar } = require('./auditar-catalogo');
const { fechaColombia } = require('../src/reglas');

const DATA = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const ARCHIVOS = {
  actual: { lectura: 'catalogo_lectura.json', campana: 'campana.json' },
  siguiente: { lectura: 'catalogo_lectura_siguiente.json', campana: 'campana_siguiente.json' }
};

class ErrorCarga extends Error {}

function fechaValida(texto) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto || '')) return false;
  const [a, m, d] = texto.split('-').map(Number);
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
}

function leerArgumentos(argv) {
  const permitidos = new Set(['--origen', '--campana', '--desde', '--hasta', '--esperados', '--modo']);
  const banderas = new Set(['--aplicar', '--promover']);
  const a = { aplicar: false, promover: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (banderas.has(k)) { a[k.slice(2)] = true; continue; }
    if (!permitidos.has(k) || argv[i + 1] === undefined) throw new ErrorCarga(`Argumento no válido: ${k}. Mira el uso en el encabezado del script.`);
    a[k.slice(2)] = argv[++i];
  }
  return a;
}

function ruta(grupo, archivo) { return path.join(DATA, ARCHIVOS[grupo][archivo]); }

function escribirAtomico(destino, texto) {
  const temporal = `${destino}.tmp`;
  fs.writeFileSync(temporal, texto, { mode: 0o600 });
  fs.renameSync(temporal, destino);
  fs.chmodSync(destino, 0o600);
}

// Copia (sin borrar el original) los archivos que se van a reemplazar.
function respaldar(archivos, hoy) {
  const marca = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const carpeta = path.join(DATA, 'campanas-anteriores', `${marca}-${hoy}`);
  const existentes = archivos.filter(f => fs.existsSync(f));
  if (!existentes.length) return { carpeta, copiados: [] }; // nada que respaldar: no se crea una carpeta vacía
  fs.mkdirSync(carpeta, { recursive: true, mode: 0o700 });
  for (const f of existentes) fs.copyFileSync(f, path.join(carpeta, path.basename(f)));
  return { carpeta, copiados: existentes.map(f => path.basename(f)) };
}

function resumenAuditoria(productos, campana, fecha) {
  const { categorias: c } = auditar(productos, campana, fecha);
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v.length]));
}

function cargar(a, hoy = process.env.HOY || fechaColombia()) {
  const salida = [];
  const decir = t => salida.push(t);

  if (a.promover) {
    const sig = [ruta('siguiente', 'lectura'), ruta('siguiente', 'campana')];
    if (!sig.every(f => fs.existsSync(f))) throw new ErrorCarga('No hay una campaña programada para promover.');
    const nombre = JSON.parse(fs.readFileSync(ruta('siguiente', 'campana'), 'utf8')).campana;
    decir(`Se promoverá la campaña programada "${nombre}" a campaña actual.`);
    if (!a.aplicar) { decir('ENSAYO: no se cambió nada. Agrega --aplicar para ejecutarlo.'); return salida; }
    const { carpeta, copiados } = respaldar([ruta('actual', 'lectura'), ruta('actual', 'campana')], hoy);
    fs.renameSync(ruta('siguiente', 'lectura'), ruta('actual', 'lectura'));
    fs.renameSync(ruta('siguiente', 'campana'), ruta('actual', 'campana'));
    decir(`Respaldo de la campaña anterior en ${carpeta} (${copiados.join(', ')}).`);
    decir('LISTO. Reinicia el asistente para que cargue los archivos.');
    return salida;
  }

  for (const k of ['origen', 'campana', 'desde', 'hasta']) if (!a[k]) throw new ErrorCarga(`Falta --${k}.`);
  const modo = a.modo || 'programar';
  if (!['programar', 'reemplazar'].includes(modo)) throw new ErrorCarga('--modo debe ser programar o reemplazar.');
  if (a.campana.length > 40) throw new ErrorCarga('El nombre de la campaña es demasiado largo (máximo 40 caracteres).');
  if (!fechaValida(a.desde) || !fechaValida(a.hasta)) throw new ErrorCarga('Las fechas deben ser reales y con formato AAAA-MM-DD.');
  if (a.hasta < a.desde) throw new ErrorCarga('La fecha de fin no puede ser anterior a la de inicio.');
  if (modo === 'programar' && a.desde <= hoy) throw new ErrorCarga(`La campaña empieza el ${a.desde}, que ya llegó (hoy es ${hoy}). Usa --modo reemplazar para activarla ahora.`);
  const esperados = a.esperados !== undefined ? Number.parseInt(a.esperados, 10) : null;
  if (a.esperados !== undefined && !(esperados > 0)) throw new ErrorCarga('--esperados debe ser un número mayor que cero.');

  let crudo;
  try { crudo = JSON.parse(fs.readFileSync(a.origen, 'utf8')); } catch (e) { throw new ErrorCarga(`No se pudo leer el origen (${e.code || 'JSON inválido'}).`); }
  if (Array.isArray(crudo)) crudo = { productos: crudo };
  let construido;
  try { construido = construirLectura(crudo, { esperados }); } catch (e) { throw new ErrorCarga(e.message); }
  const campana = { campana: a.campana, vigencia_desde: a.desde, vigencia_hasta: a.hasta };

  decir(`Campaña: ${a.campana}, del ${a.desde} al ${a.hasta}. Modo: ${modo}.`);
  decir(`Productos en el origen: ${construido.resumen.total}. Estados: ${JSON.stringify(construido.resumen.estados)}.`);
  decir(`Anomalías: ${JSON.stringify(construido.resumen.anomalias)}.`);
  decir(`Auditoría (con las reglas del asistente): ${JSON.stringify(resumenAuditoria(construido.datos.productos, campana, a.desde))}.`);
  const destino = modo === 'programar' ? 'siguiente' : 'actual';
  decir(`Archivos de destino: ${ARCHIVOS[destino].lectura} y ${ARCHIVOS[destino].campana}.`);
  if (modo === 'programar') decir(`Entrará en vigor sola a las 00:00 (hora de Colombia) del ${a.desde}; hasta entonces responde la campaña actual.`);
  else decir('Reemplaza la campaña actual en cuanto se reinicie el asistente.');

  if (!a.aplicar) { decir('ENSAYO: no se escribió nada. Agrega --aplicar para ejecutarlo.'); return salida; }

  fs.mkdirSync(DATA, { recursive: true });
  const { carpeta, copiados } = respaldar([ruta(destino, 'lectura'), ruta(destino, 'campana')], hoy);
  escribirAtomico(ruta(destino, 'lectura'), JSON.stringify(construido.datos, null, 2));
  escribirAtomico(ruta(destino, 'campana'), JSON.stringify(campana, null, 2));
  decir(copiados.length ? `Respaldo de lo reemplazado en ${carpeta} (${copiados.join(', ')}).` : 'No había nada que reemplazar, así que no hizo falta respaldo.');
  decir('LISTO. Reinicia el asistente para que cargue la campaña (pm2 restart).');
  return salida;
}

function principal() {
  const a = leerArgumentos(process.argv.slice(2));
  for (const linea of cargar(a)) console.log(linea);
}

if (require.main === module) {
  try { principal(); } catch (e) {
    console.error(e instanceof ErrorCarga ? e.message : `Error inesperado: ${e.message}`);
    process.exit(1);
  }
}

module.exports = { cargar, leerArgumentos, fechaValida, ErrorCarga };
