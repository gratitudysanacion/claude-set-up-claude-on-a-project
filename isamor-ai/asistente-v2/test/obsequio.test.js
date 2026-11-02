'use strict';
// Obsequios: registros sin precio cuyo texto empieza por "Obsequio" son regalos con la compra, no datos faltantes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararProducto } = require('../src/reglas');
const { crearCatalogo } = require('../src/catalogo');
const { verificarRespuesta } = require('../src/verificador');
const { fichaDeterminista } = require('../src/respaldo');
const { auditar } = require('../scripts/auditar-catalogo');
const { SISTEMA } = require('../src/ia');
const { productos, campana } = require('./fixtures');

const cat = crearCatalogo({ productos, campana, hoy: () => '2026-10-27' });
const OBSEQUIO = 'Obsequio: se entrega gratis con la compra indicada en el catálogo; no se vende por separado.';

test('el obsequio no se presenta como dato faltante', () => {
  const p = cat.buscar('Zentro').productos.find(x => x.id === 'pobsequio');
  assert.equal(p.tipo_promocion, 'obsequio');
  assert.equal(p.resumen_oferta, 'Obsequio: se entrega gratis con la compra indicada; no se vende por separado.');
  assert.equal(p.precio_normal, null);
  assert.equal(p.precio_oferta, null);
  assert.ok(p.advertencias.includes(OBSEQUIO));
  assert.ok(!p.advertencias.includes('No tengo el precio normal de este producto.'));
  assert.ok(!p.advertencias.includes('No tiene oferta registrada.'));
  assert.equal(p.promocion, 'Obsequio GRATIS por la compra de cada Zentro Eau de Parfum; sin precio ni código propio.');
});

test('la regla es estricta: solo sin precios y con "Obsequio" al inicio del texto', () => {
  const base = { id: 'x', nombre: 'X', categoria: 'c', estado: 'pendiente_revision' };
  const hoy = '2026-10-27';
  // Con precio: no es obsequio (p. ej. un producto cuya promoción incluye un regalo)
  const conPrecio = prepararProducto({ ...base, precio_normal: 89000, precio_oferta: 53000, promocion: 'Obsequio GRATIS con tu compra' }, campana, hoy);
  assert.equal(conPrecio.tipo_promocion, null);
  // "obsequio" en medio del texto: no
  const enMedio = prepararProducto({ ...base, precio_normal: 0, precio_oferta: 0, promocion: 'Compra y llévate un obsequio' }, campana, hoy);
  assert.equal(enMedio.tipo_promocion, null);
  assert.ok(enMedio.advertencias.includes('No tengo el precio normal de este producto.'));
  // Sin promoción: sigue siendo dato faltante
  const vacio = prepararProducto({ ...base, precio_normal: 0, precio_oferta: 0, promocion: '' }, campana, hoy);
  assert.equal(vacio.tipo_promocion, null);
  assert.ok(vacio.advertencias.includes('No tengo el precio normal de este producto.'));
  // Mayúsculas y espacios iniciales
  const variante = prepararProducto({ ...base, precio_normal: 0, precio_oferta: 0, promocion: '  OBSEQUIO gratis por la compra de X' }, campana, hoy);
  assert.equal(variante.tipo_promocion, 'obsequio');
  // Un producto que solo se vende dentro de un set no es un obsequio
  const brocha = cat.buscar('Brocha Base').productos[0];
  assert.equal(brocha.tipo_promocion, null);
  assert.ok(brocha.advertencias.some(a => /solo dentro de un set/.test(a)));
});

test('ficha de respaldo del obsequio: sin precios inventados ni "no tengo ese dato" y con el texto literal', () => {
  const r = cat.buscar('Zentro');
  const ficha = fichaDeterminista([r]);
  assert.match(ficha, /Obsequio: se entrega gratis con la compra indicada en el catálogo \(no se vende por separado\)/);
  assert.match(ficha, /Promoción \(texto del catálogo\): Obsequio GRATIS por la compra de cada Zentro Eau de Parfum/);
  assert.ok(!/Precio normal|Precio de oferta|no tengo ese dato|sin oferta registrada/.test(ficha));
  assert.deepEqual(verificarRespuesta(ficha, [r]), { ok: true, violaciones: [] });
});

test('las instrucciones del modelo cubren el obsequio', () => {
  assert.ok(SISTEMA.includes('tipo_promocion "obsequio"'));
  assert.ok(SISTEMA.includes('No tiene precio porque no se vende'));
});

test('el auditor separa los obsequios de los productos sin precio', () => {
  const { categorias: c } = auditar(productos, campana, '2026-10-27');
  assert.deepEqual(c.obsequios.map(p => p.id), ['pobsequio']);
  assert.ok(!c.sin_ningun_precio.some(p => p.id === 'pobsequio'));
  assert.ok(c.sin_ningun_precio.some(p => p.referencia === '9001'));
});
