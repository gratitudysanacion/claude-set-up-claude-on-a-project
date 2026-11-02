#!/usr/bin/env node
'use strict';
// Auditoría de solo lectura de la copia de lectura del catálogo, con las mismas reglas que usa el asistente.
// No modifica nada. Muestra conteos y, por categoría, hasta MAX_LISTA productos (código, precios y texto de promoción).
// Uso:  node scripts/auditar-catalogo.js [RUTA_catalogo_lectura.json] [RUTA_campana.json]
const path = require('node:path');
const { cargarProductos, cargarCampana } = require('../src/catalogo');
const { prepararProducto, fechaColombia } = require('../src/reglas');

const MAX_LISTA = 40;

function auditar(productos, campana, hoy) {
  const prep = productos.map(p => prepararProducto(p, campana, hoy));
  const cat = {
    dos_por_uno_deducido: prep.filter(p => p.precio_normal_deducido),
    dos_por_uno_sin_deducir: prep.filter(p => p.tipo_promocion === '2x1' && !p.precio_normal_deducido),
    solo_oferta: prep.filter(p => p.precio_normal === null && p.precio_oferta !== null),
    obsequios: prep.filter(p => p.tipo_promocion === 'obsequio'),
    compras_especiales: prep.filter(p => p.tipo_promocion === 'compra_especial'),
    sin_ningun_precio: prep.filter(p => p.precio_normal === null && p.precio_oferta === null && !p.precio_normal_deducido && p.tipo_promocion !== 'obsequio'),
    promocion_no_coincide: prep.filter(p => p.coherencia === 'inconsistente'),
    solo_dentro_de_set: prep.filter(p => p.advertencias.some(a => /solo dentro de un set/.test(a)))
  };
  return { total: prep.length, categorias: cat };
}

function linea(p) {
  const texto = String(p.promocion || '').replace(/\s+/g, ' ').slice(0, 110);
  return `${p.referencia || p.id} | N=${p.precio_normal ?? '-'} | O=${p.precio_oferta ?? '-'} | ${texto}`;
}

function principal() {
  const raiz = path.join(__dirname, '..');
  const rutaLectura = process.argv[2] || path.join(raiz, 'data', 'catalogo_lectura.json');
  const rutaCampana = process.argv[3] || path.join(raiz, 'data', 'campana.json');
  const { total, categorias } = auditar(cargarProductos(rutaLectura), cargarCampana(rutaCampana), fechaColombia());
  console.log(`Productos auditados: ${total}`);
  for (const [nombre, lista] of Object.entries(categorias)) console.log(`  ${nombre}: ${lista.length}`);
  for (const [nombre, lista] of Object.entries(categorias)) {
    if (!lista.length || nombre === 'dos_por_uno_deducido') continue;
    console.log(`\n== ${nombre} (${lista.length}) ==`);
    lista.slice(0, MAX_LISTA).forEach(p => console.log(linea(p)));
    if (lista.length > MAX_LISTA) console.log(`... y ${lista.length - MAX_LISTA} más`);
  }
}

if (require.main === module) {
  try { principal(); } catch (e) { console.error(`No se pudo auditar: ${e.message}`); process.exit(1); }
}

module.exports = { auditar, MAX_LISTA };
