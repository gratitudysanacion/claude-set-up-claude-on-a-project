#!/usr/bin/env node
'use strict';
// Convierte el Excel que descarga el artefacto "Lista de precios del catálogo" (hojas "Productos" y "Sin precio") en el JSON
// consolidado que usan el panel y scripts/cargar-campana.js. Sin dependencias: lee el .xlsx (ZIP + XML) con zlib.
//  - Solo lee el Excel y escribe UN archivo nuevo (--destino). No toca el panel, el asistente ni ningún catálogo existente.
//  - Rechaza filas "Revisar" (precios o códigos que el artefacto no pudo comprobar). Se pueden aprobar SOLO las que tú nombres,
//    una vez comprobadas contra el PDF: --aprobar 2219,2210,... (cualquier otra fila "Revisar" sigue bloqueando).
//  - No imprime nombres ni precios: solo conteos y códigos de las filas con problemas.
// Uso:  node scripts/xlsx-a-consolidado.js --origen ARCHIVO.xlsx --destino SALIDA.json [--esperados N] [--aprobar COD1,COD2,...] [--permitir-revisar] [--sobrescribir]
const fs = require('node:fs');
const zlib = require('node:zlib');

class ErrorXlsx extends Error {}

const MAX_ENTRADA = 60 * 1024 * 1024; // tope de descompresión por archivo interno (defensa ante ZIP malicioso)

// ---------- ZIP ----------
function leerZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new ErrorXlsx('El archivo no es un .xlsx válido (no se encontró el índice ZIP).');
  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entradas = new Map();
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new ErrorXlsx('El índice ZIP está dañado.');
    const metodo = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32);
    const desplazamiento = buf.readUInt32LE(p + 42);
    const nombre = buf.toString('utf8', p + 46, p + 46 + nl);
    entradas.set(nombre, { metodo, csize, usize, desplazamiento });
    p += 46 + nl + el + cl;
  }
  return {
    leer(nombre) {
      const e = entradas.get(nombre);
      if (!e) return null;
      if (e.usize > MAX_ENTRADA) throw new ErrorXlsx('Un archivo interno del .xlsx es demasiado grande.');
      const o = e.desplazamiento;
      if (buf.readUInt32LE(o) !== 0x04034b50) throw new ErrorXlsx('Un archivo interno del .xlsx está dañado.');
      const ini = o + 30 + buf.readUInt16LE(o + 26) + buf.readUInt16LE(o + 28);
      const datos = buf.subarray(ini, ini + e.csize);
      if (e.metodo === 0) return datos.toString('utf8');
      if (e.metodo === 8) return zlib.inflateRawSync(datos, { maxOutputLength: MAX_ENTRADA }).toString('utf8');
      throw new ErrorXlsx(`Método de compresión no soportado (${e.metodo}).`);
    },
    nombres: () => [...entradas.keys()]
  };
}

// ---------- XML ----------
function desescapar(t) {
  return t.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e) => {
    if (e === 'amp') return '&'; if (e === 'lt') return '<'; if (e === 'gt') return '>'; if (e === 'quot') return '"'; if (e === 'apos') return "'";
    return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  });
}
const textosDe = xml => [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(m => desescapar(m[1])).join('');

function columnaANumero(letras) { let n = 0; for (const c of letras) n = n * 26 + (c.charCodeAt(0) - 64); return n - 1; }

function leerLibro(ruta) {
  let buf;
  try { buf = fs.readFileSync(ruta); } catch (e) { throw new ErrorXlsx(`No se pudo leer el archivo (${e.code || 'error'}).`); }
  const zip = leerZip(buf);
  const libro = zip.leer('xl/workbook.xml');
  if (!libro) throw new ErrorXlsx('El archivo no parece un Excel (.xlsx): falta xl/workbook.xml.');
  const relsXml = zip.leer('xl/_rels/workbook.xml.rels') || '';
  const rels = {};
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]*)"/.exec(m[0]), destino = /\bTarget="([^"]*)"/.exec(m[0]);
    if (id && destino) rels[id[1]] = destino[1].replace(/^\//, '').replace(/^(?!xl\/)/, 'xl/');
  }
  const compartidas = [];
  const ss = zip.leer('xl/sharedStrings.xml');
  if (ss) for (const m of ss.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) compartidas.push(textosDe(m[1]));

  const hojas = {};
  for (const m of libro.matchAll(/<sheet\b[^>]*>/g)) {
    const nombre = /\bname="([^"]*)"/.exec(m[0]);
    const rid = /\br:id="([^"]*)"/.exec(m[0]);
    if (!nombre || !rid || !rels[rid[1]]) continue;
    const xml = zip.leer(rels[rid[1]]);
    if (xml === null) continue;
    const filas = [];
    for (const f of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const num = /\br="(\d+)"/.exec(f[1]);
      const fila = [];
      for (const c of (f[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = /\br="([A-Z]+)\d+"/.exec(c[1]);
        if (!ref) continue;
        const tipo = (/\bt="([^"]*)"/.exec(c[1]) || [])[1];
        const cuerpo = c[2] || '';
        let valor = null;
        const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(cuerpo);
        if (tipo === 's') valor = v ? compartidas[Number(v[1])] ?? null : null;
        else if (tipo === 'inlineStr') valor = textosDe(cuerpo);
        else if (tipo === 'str') valor = v ? desescapar(v[1]) : null;
        else if (tipo === 'b') valor = v ? v[1] === '1' : null;
        else if (v && v[1] !== '') valor = Number(v[1]);
        fila[columnaANumero(ref[1])] = valor;
      }
      filas[(num ? Number(num[1]) : filas.length + 1) - 1] = fila;
    }
    hojas[nombre[1] && desescapar(nombre[1])] = Array.from(filas, f => f || []);
  }
  return hojas;
}

// ---------- Conversión ----------
const norm = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const texto = v => (v === null || v === undefined ? '' : String(v).trim());
function entero(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : NaN;
}

function indicarColumnas(hoja, requeridas, nombreHoja) {
  const encabezado = (hoja[0] || []).map(norm);
  const idx = {};
  const faltan = [];
  for (const [clave, nombre] of Object.entries(requeridas)) {
    const i = encabezado.indexOf(nombre);
    if (i < 0) faltan.push(nombre); else idx[clave] = i;
  }
  if (faltan.length) throw new ErrorXlsx(`La hoja "${nombreHoja}" no tiene las columnas esperadas: ${faltan.join(', ')}. ¿Es el Excel del artefacto?`);
  return idx;
}

function convertir(hojas, { permitirRevisar = false, aprobar = [] } = {}) {
  const aprobados = new Set(aprobar.map(c => String(c).trim()).filter(Boolean));
  const hp = hojas.Productos, hs = hojas['Sin precio'];
  if (!hp) throw new ErrorXlsx('Falta la hoja "Productos".');
  if (!hs) throw new ErrorXlsx('Falta la hoja "Sin precio".');
  const cp = indicarColumnas(hp, {
    nombre: 'nombre del producto', codigo: 'codigo', categoria: 'categoria', oferta: 'precio oferta cop', normal: 'precio normal cop',
    presentacion: 'presentacion', pagina: 'pagina pdf', promocion: 'promocion / condicion', estado: 'estado / observaciones'
  }, 'Productos');
  const cs = indicarColumnas(hs, {
    nombre: 'producto', codigo: 'codigo', categoria: 'categoria', pagina: 'pagina pdf', presentacion: 'presentacion', tipo: 'tipo', motivo: 'motivo / observacion'
  }, 'Sin precio');

  const productos = [], problemas = [], revisar = [];
  const ids = new Set();
  const resumen = { con_precio: 0, sin_precio: 0, dos_por_uno_aparente: 0, repetidos: 0, revisar: 0, parciales_omitidos: 0 };
  const idUnico = (base, doble) => {
    let id = base, n = 1;
    while (ids.has(id)) { n++; id = `${base}_${n}`; if (doble) resumen.repetidos++; doble = false; }
    ids.add(id);
    return id;
  };

  for (let i = 1; i < hp.length; i++) {
    const f = hp[i];
    if (!f || f.every(c => c === null || c === undefined || texto(c) === '')) continue;
    const fila = i + 1;
    const nombre = texto(f[cp.nombre]);
    const codigo = texto(f[cp.codigo]).replace(/\.0+$/, '');
    const oferta = entero(f[cp.oferta]), normal = entero(f[cp.normal]);
    const pagina = entero(f[cp.pagina]);
    const estadoExcel = texto(f[cp.estado]);
    if (!nombre) { problemas.push(`Productos, fila ${fila}: sin nombre.`); continue; }
    if (!/^\d{1,8}$/.test(codigo)) { problemas.push(`Productos, fila ${fila}: código no válido o vacío.`); continue; }
    if (Number.isNaN(oferta) || Number.isNaN(normal)) { problemas.push(`Productos, fila ${fila} (cód. ${codigo}): precio no numérico.`); continue; }
    if (oferta === null && normal === null) { problemas.push(`Productos, fila ${fila} (cód. ${codigo}): sin ningún precio; debería estar en la hoja "Sin precio".`); continue; }
    if (oferta !== null && normal !== null && oferta > normal) problemas.push(`Productos, fila ${fila} (cód. ${codigo}): la oferta supera al precio normal.`);
    if (/^revisar/i.test(estadoExcel)) { resumen.revisar++; revisar.push(codigo); }
    const promocion = texto(f[cp.promocion]);
    if (oferta !== null && normal === null && /2\s*x\s*1/i.test(promocion)) resumen.dos_por_uno_aparente++;
    const repetido = ids.has(`p${codigo}`);
    productos.push({
      id: idUnico(`p${codigo}`, true), nombre, referencia: codigo, categoria: texto(f[cp.categoria]), presentacion: texto(f[cp.presentacion]),
      precio_normal: normal, precio_oferta: oferta, promocion, vigencia_desde: '', vigencia_hasta: '', pagina_origen: pagina === null ? '' : String(pagina),
      estado: 'pendiente_revision', notas: '', origen: 'xlsx-artefacto', aviso_revision: /^verificado$/i.test(estadoExcel) ? '' : estadoExcel,
      estado_importacion: repetido ? 'Doble' : 'Valido'
    });
    resumen.con_precio++;
  }

  for (let i = 1; i < hs.length; i++) {
    const f = hs[i];
    if (!f || f.every(c => c === null || c === undefined || texto(c) === '')) continue;
    const tipo = norm(f[cs.tipo]);
    // El artefacto repite aquí los productos con precio de oferta y sin precio normal; ya están en la hoja Productos.
    if (tipo === 'precio normal no informado') { resumen.parciales_omitidos++; continue; }
    const nombre = texto(f[cs.nombre]);
    if (!nombre) { problemas.push(`Sin precio, fila ${i + 1}: sin nombre.`); continue; }
    const codigo = texto(f[cs.codigo]);
    const pagina = entero(f[cs.pagina]);
    const referencia = /^\d{1,8}$/.test(codigo) ? codigo : '';
    const base = referencia ? `p${referencia}` : `s${pagina ?? 0}-${norm(nombre).replace(/[^a-z0-9]+/g, '-').slice(0, 40).replace(/^-|-$/g, '')}`;
    productos.push({
      id: idUnico(base, false), nombre, referencia, categoria: texto(f[cs.categoria]), presentacion: texto(f[cs.presentacion]),
      precio_normal: null, precio_oferta: null, promocion: texto(f[cs.motivo]), vigencia_desde: '', vigencia_hasta: '',
      pagina_origen: pagina === null ? '' : String(pagina), estado: 'pendiente_revision', notas: '', origen: 'xlsx-artefacto',
      aviso_revision: '', estado_importacion: 'Sin precio'
    });
    resumen.sin_precio++;
  }

  if (!productos.length) throw new ErrorXlsx('El Excel no contiene productos.');
  const sobrantes = [...aprobados].filter(c => !revisar.includes(c));
  if (sobrantes.length) throw new ErrorXlsx(`Los códigos que pasaste a --aprobar no están en estado "Revisar" en este Excel: ${sobrantes.join(', ')}. Revisa que no haya un error de tecleo.`);
  const bloqueantes = permitirRevisar ? [] : revisar.filter(c => !aprobados.has(c));
  if (bloqueantes.length) {
    throw new ErrorXlsx(`Hay ${bloqueantes.length} fila(s) en estado "Revisar" sin aprobar (códigos: ${bloqueantes.slice(0, 15).join(', ')}${bloqueantes.length > 15 ? ', …' : ''}). Compruébalas contra el PDF y apruébalas con --aprobar CODIGOS, o corrígelas en el artefacto y vuelve a descargar el Excel.`);
  }
  if (problemas.length) throw new ErrorXlsx(`Se encontraron ${problemas.length} problema(s):\n  - ${problemas.slice(0, 20).join('\n  - ')}${problemas.length > 20 ? '\n  - …' : ''}`);
  return { datos: { version: 1, moneda: 'COP', productos, historial: [] }, resumen: { total: productos.length, ...resumen } };
}

// ---------- Línea de comandos ----------
function principal() {
  const a = process.argv.slice(2);
  const arg = n => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
  const origen = arg('--origen'), destino = arg('--destino');
  if (!origen || !destino) throw new ErrorXlsx('Uso: node scripts/xlsx-a-consolidado.js --origen ARCHIVO.xlsx --destino SALIDA.json [--esperados N] [--permitir-revisar] [--sobrescribir]');
  if (fs.existsSync(destino) && !a.includes('--sobrescribir')) throw new ErrorXlsx(`${destino} ya existe. Elige otro nombre o usa --sobrescribir.`);
  const lista = arg('--aprobar');
  const { datos, resumen } = convertir(leerLibro(origen), { permitirRevisar: a.includes('--permitir-revisar'), aprobar: lista ? lista.split(',') : [] });
  const esperados = arg('--esperados');
  if (esperados !== undefined && Number(esperados) !== resumen.total) {
    throw new ErrorXlsx(`Se esperaban ${esperados} productos y el Excel trae ${resumen.total}. No se escribió nada.`);
  }
  const temporal = `${destino}.tmp`;
  fs.writeFileSync(temporal, JSON.stringify(datos, null, 2), { mode: 0o600 });
  fs.renameSync(temporal, destino);
  console.log(`Convertido: ${resumen.total} productos (${resumen.con_precio} con precio, ${resumen.sin_precio} sin precio).`);
  console.log(`  2 x 1 aparentes: ${resumen.dos_por_uno_aparente} · códigos repetidos: ${resumen.repetidos} · filas "Revisar" admitidas: ${resumen.revisar} · parciales ya incluidos: ${resumen.parciales_omitidos}`);
  console.log(`Escrito en ${destino}. No se tocó ningún otro archivo.`);
}

if (require.main === module) {
  try { principal(); } catch (e) { console.error(e instanceof ErrorXlsx ? e.message : `Error inesperado (${e.code || e.name}).`); process.exit(1); }
}

module.exports = { leerLibro, leerZip, convertir, ErrorXlsx };
