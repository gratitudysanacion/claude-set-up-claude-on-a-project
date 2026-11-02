#!/usr/bin/env node
'use strict';
// Genera la copia de LECTURA del catálogo para el asistente a partir del catálogo del panel.
//  - Abre el origen solo para leer; nunca lo modifica.
//  - Copia únicamente los campos autorizados (no notas, origen, aviso_revision ni estado_importacion).
//  - No imprime nombres, precios ni ningún valor del catálogo: solo conteos y la huella del resultado.
// Uso:  node scripts/exportar-lectura.js [--origen RUTA] [--destino RUTA] [--esperados N]
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ORIGEN_POR_DEFECTO = '/opt/yanbal-admin-starter/yanbal-admin-starter/data/catalogo.json';
const CAMPOS_AUTORIZADOS = [
  'id', 'nombre', 'referencia', 'categoria', 'presentacion', 'precio_normal', 'precio_oferta',
  'promocion', 'vigencia_desde', 'vigencia_hasta', 'pagina_origen', 'estado'
];
const CAMPOS_NUMERICOS = ['precio_normal', 'precio_oferta'];

class ErrorExportacion extends Error {}

function limpiarTexto(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

// Devuelve { datos, resumen }. Lanza ErrorExportacion si el origen no es confiable.
function construirLectura(origen, { esperados = null, ahora = () => new Date() } = {}) {
  const lista = origen && Array.isArray(origen.productos) ? origen.productos : null;
  if (!lista || !lista.length) throw new ErrorExportacion('El origen no contiene una lista de productos.');
  if (esperados !== null && lista.length !== esperados) {
    throw new ErrorExportacion(`Se esperaban ${esperados} productos y el origen trae ${lista.length}. No se exportó nada.`);
  }

  const ids = new Set();
  const anomalias = { sin_id: 0, id_repetido: 0, sin_nombre: 0, precio_no_numerico: 0, precio_negativo: 0 };
  const estados = {};
  const productos = [];

  for (const p of lista) {
    const salida = {};
    for (const campo of CAMPOS_AUTORIZADOS) {
      if (CAMPOS_NUMERICOS.includes(campo)) {
        const n = p[campo] === '' || p[campo] === null || p[campo] === undefined ? 0 : Number(p[campo]);
        if (!Number.isFinite(n)) { anomalias.precio_no_numerico++; salida[campo] = 0; }
        else if (n < 0) { anomalias.precio_negativo++; salida[campo] = 0; }
        else salida[campo] = n;
      } else {
        salida[campo] = limpiarTexto(p[campo]);
      }
    }
    if (!salida.id) anomalias.sin_id++;
    else if (ids.has(salida.id)) anomalias.id_repetido++;
    else ids.add(salida.id);
    if (!salida.nombre) anomalias.sin_nombre++;
    estados[salida.estado || '(vacío)'] = (estados[salida.estado || '(vacío)'] || 0) + 1;
    productos.push(salida);
  }

  if (anomalias.sin_id || anomalias.id_repetido) {
    throw new ErrorExportacion(`Identificadores inválidos (sin id: ${anomalias.sin_id}, repetidos: ${anomalias.id_repetido}). No se exportó nada.`);
  }

  const datos = {
    generado: ahora().toISOString(),
    origen_version: limpiarTexto(origen.version),
    moneda: limpiarTexto(origen.moneda),
    productos
  };
  return { datos, resumen: { total: productos.length, estados, anomalias } };
}

function exportar({ origen, destino, esperados = null }) {
  let crudo;
  try { crudo = JSON.parse(fs.readFileSync(origen, 'utf8')); } catch (e) {
    throw new ErrorExportacion(`No se pudo leer el origen (${e.code || 'JSON inválido'}).`);
  }
  const { datos, resumen } = construirLectura(crudo, { esperados });
  const texto = JSON.stringify(datos, null, 2);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  const temporal = `${destino}.tmp`;
  fs.writeFileSync(temporal, texto, { mode: 0o600 });
  fs.renameSync(temporal, destino);
  fs.chmodSync(destino, 0o600);
  return { ...resumen, bytes: Buffer.byteLength(texto), sha256: crypto.createHash('sha256').update(texto).digest('hex') };
}

function leerArgumentos(argv) {
  const opciones = {};
  for (let i = 0; i < argv.length; i += 2) {
    const clave = argv[i];
    const valor = argv[i + 1];
    if (!['--origen', '--destino', '--esperados'].includes(clave) || valor === undefined) {
      throw new ErrorExportacion('Uso: node scripts/exportar-lectura.js [--origen RUTA] [--destino RUTA] [--esperados N]');
    }
    opciones[clave.slice(2)] = valor;
  }
  return opciones;
}

function principal() {
  const a = leerArgumentos(process.argv.slice(2));
  const origen = a.origen || process.env.ORIGEN_CATALOGO || ORIGEN_POR_DEFECTO;
  const destino = a.destino || path.join(__dirname, '..', 'data', 'catalogo_lectura.json');
  const esperados = a.esperados !== undefined ? Number.parseInt(a.esperados, 10) : null;
  if (path.resolve(origen) === path.resolve(destino)) throw new ErrorExportacion('El destino no puede ser el mismo archivo que el origen.');
  const r = exportar({ origen, destino, esperados });
  console.log(`Exportados ${r.total} productos a ${destino} (permisos 600, ${r.bytes} bytes).`);
  console.log('Estados:', JSON.stringify(r.estados));
  console.log('Anomalías:', JSON.stringify(r.anomalias));
  console.log(`SHA-256: ${r.sha256}`);
}

if (require.main === module) {
  try { principal(); } catch (e) {
    console.error(e instanceof ErrorExportacion ? e.message : `Error inesperado: ${e.message}`);
    process.exit(1);
  }
}

module.exports = { construirLectura, exportar, leerArgumentos, CAMPOS_AUTORIZADOS, ErrorExportacion };
