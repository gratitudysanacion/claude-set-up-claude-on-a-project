'use strict';
// Promociones "2 x 1": el único precio del catálogo es el precio normal de 1 unidad (regla confirmada por la usuaria).
const test = require('node:test');
const assert = require('node:assert/strict');
const { limpiarPromocion, importeDosPorUno } = require('../src/reglas');
const { crearCatalogo } = require('../src/catalogo');
const { verificarRespuesta } = require('../src/verificador');
const { fichaDeterminista } = require('../src/respaldo');
const { crearResponder } = require('../src/ia');
const { productos, campana } = require('./fixtures');

const catalogo = hoy => crearCatalogo({ productos, campana, hoy: () => hoy });
const unico = (cat, ref) => cat.buscar(ref).productos[0];

test('5104 (real): el precio del catálogo pasa a ser el precio normal y no queda precio de oferta', () => {
  const p = unico(catalogo('2026-10-27'), '5104');
  assert.equal(p.precio_normal, 56000);
  assert.equal(p.precio_oferta, null);
  assert.equal(p.tipo_promocion, '2x1');
  assert.equal(p.precio_normal_deducido, true);
  assert.equal(p.resumen_oferta, 'Oferta 2 x 1: pides 1 y recibes 2 por el precio normal.');
  assert.equal(p.promocion, '2 x 1 por $56.000 (pide 1, recibe 2)');
  assert.equal(p.coherencia, 'ok');
  assert.equal(p.oferta.estado, 'vigente');
  assert.ok(p.advertencias.includes('Promoción 2 x 1: el precio del catálogo es el de 1 unidad y, al comprar 1, recibe 2.'));
  assert.ok(!p.advertencias.includes('No tengo el precio normal de este producto.'));
  assert.ok(!p.advertencias.includes('No tiene oferta registrada.'));
});

test('combinación entre productos (723): mismo tratamiento y la nota de importación no se muestra', () => {
  const p = unico(catalogo('2026-10-27'), '723');
  assert.equal(p.precio_normal, 58000);
  assert.equal(p.precio_oferta, null);
  assert.equal(p.promocion, '2 x 1 por $58.000 (cualquier combinación entre Reparación Intensiva y Protección Total); ml a $116');
  assert.ok(!/Se informa/.test(JSON.stringify(p)));
});

test('el verificador acepta $56.000 pero rechaza un precio por unidad calculado ($28.000)', () => {
  const r = catalogo('2026-10-27').buscar('5104');
  assert.deepEqual(verificarRespuesta('Cuesta $56.000 y recibes 2.', [r]), { ok: true, violaciones: [] });
  assert.deepEqual(verificarRespuesta('Sale a $28.000 cada una.', [r]), { ok: false, violaciones: [28000] });
});

test('no se deduce el precio normal si el importe del texto no coincide con el registrado', () => {
  const p = unico(catalogo('2026-10-27'), '9400');
  assert.equal(p.precio_normal, null);
  assert.equal(p.precio_oferta, 40000);
  assert.equal(p.precio_normal_deducido, false);
  assert.equal(p.coherencia, 'inconsistente');
  assert.ok(p.advertencias.includes('No tengo el precio normal de este producto.'));
});

test('si ya existe precio normal no se toca nada', () => {
  const p = unico(catalogo('2026-10-27'), '9401');
  assert.equal(p.precio_normal, 60000);
  assert.equal(p.precio_oferta, 56000);
  assert.equal(p.precio_normal_deducido, false);
  assert.equal(p.resumen_oferta, null);
});

test('un producto con solo precio de oferta que NO es 2 x 1 sigue sin precio normal; solo se limpia la nota interna', () => {
  const p = unico(catalogo('2026-10-27'), '9402');
  assert.equal(p.precio_normal, null);
  assert.equal(p.precio_oferta, 18000);
  assert.equal(p.tipo_promocion, null);
  assert.equal(p.promocion, 'A tan solo $18.000 c/u; 50% dscto.');
  assert.ok(p.advertencias.includes('No tengo el precio normal de este producto.'));
});

test('la regla no depende de mayúsculas ni espacios, y solo reconoce 2 x 1', () => {
  assert.equal(importeDosPorUno('2X1 por $56.000'), 56000);
  assert.equal(importeDosPorUno('2  x  1  por  $1.200.500'), 1200500);
  assert.equal(importeDosPorUno('3 x 2 por $56.000'), null);
  assert.equal(importeDosPorUno('Oferta $56.000 c/u'), null);
  assert.equal(importeDosPorUno(''), null);
  assert.equal(limpiarPromocion('Oferta $1.000 | Se informa precio de oferta x'), 'Oferta $1.000');
  assert.equal(limpiarPromocion(undefined), '');
});

test('ficha de respaldo para 2 x 1: precio normal, oferta "2 x 1" y texto literal; pasa el verificador', () => {
  const r = catalogo('2026-10-27').buscar('5104');
  const ficha = fichaDeterminista([r]);
  assert.match(ficha, /Precio normal: \$56\.000/);
  assert.match(ficha, /Oferta: 2 x 1 \(pides 1 y recibes 2\)/);
  assert.match(ficha, /Promoción \(texto del catálogo\): 2 x 1 por \$56\.000 \(pide 1, recibe 2\)/);
  assert.ok(!/sin oferta registrada|no tengo ese dato|Se informa/.test(ficha));
  assert.deepEqual(verificarRespuesta(ficha, [r]), { ok: true, violaciones: [] });
  const vencida = fichaDeterminista([catalogo('2026-11-20').buscar('5104')]);
  assert.match(vencida, /VENCIDA, solo de referencia/);
});

test('el modelo que calcula $28.000 por unidad cae a la ficha del catálogo', async () => {
  const guion = [
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'buscar_productos', input: { consulta: '5104' } }], usage: {} },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Pagas $56.000 y recibes 2, es decir $28.000 cada uno.' }], usage: {} }
  ];
  const r = await crearResponder({ catalogo: catalogo('2026-10-27'), cliente: async () => guion.shift() })({ mensaje: 'delineador 5104' });
  assert.equal(r.respaldo, true);
  assert.ok(!r.respuesta.includes('28.000'));
  assert.match(r.respuesta, /Precio normal: \$56\.000/);
});
