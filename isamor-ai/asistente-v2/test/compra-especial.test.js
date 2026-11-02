'use strict';
// Compra especial (decisión de la usuaria, 2 nov 2026): artículo con precio propio, sin precio normal, que solo se adquiere
// con la compra de otro producto y no se vende suelto. El asistente siempre debe aclararlo cuando cita su precio.
const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararProducto } = require('../src/reglas');
const { crearCatalogo } = require('../src/catalogo');
const { verificarCompraEspecial } = require('../src/verificador');
const { fichaDeterminista, advertenciasDe } = require('../src/respaldo');
const { verificarContenido } = require('../src/contenido');
const { crearResponder, SISTEMA } = require('../src/ia');
const { auditar } = require('../scripts/auditar-catalogo');
const { campana } = require('./fixtures');

const base = { estado: 'pendiente_revision', vigencia_desde: '', vigencia_hasta: '', categoria: 'Yanbal Kids', presentacion: '' };
const productos = [
  { ...base, id: 'p60099', nombre: 'Compra especial Kids', referencia: '60099', precio_normal: null, precio_oferta: 3000, pagina_origen: '120',
    promocion: 'Compra especial; por la compra de productos de la línea Yanbal Kids' },
  { ...base, id: 'p60124', nombre: 'Caja Especial para 3 Jabones', referencia: '60124', precio_normal: null, precio_oferta: 3500, pagina_origen: '130',
    promocion: 'Compra especial; por la compra de 3 o más jabones; caja cerrada, imagen referencial; no incluye jabones' },
  { ...base, id: 'pnormal', nombre: 'Producto normal', referencia: '1', precio_normal: 40000, precio_oferta: 20000, pagina_origen: '5', promocion: 'Oferta $20.000 c/u' },
  { ...base, id: 'pconnormal', nombre: 'Compra especial con normal', referencia: '2', precio_normal: 9000, precio_oferta: 3000, pagina_origen: '6', promocion: 'Compra especial; por la compra de X' }
];
const HOY = '2026-10-27';
const cat = crearCatalogo({ productos, campana, hoy: () => HOY });

test('la compra especial se reconoce: sin "precio normal faltante" y con la aclaración de que no se vende suelta', () => {
  const p = cat.buscar('Kids').productos.find(x => x.id === 'p60099');
  assert.equal(p.tipo_promocion, 'compra_especial');
  assert.equal(p.precio_oferta, 3000);
  assert.equal(p.precio_normal, null);
  assert.match(p.resumen_oferta, /solo aplica con la compra indicada.*no se vende suelto/);
  assert.ok(p.advertencias.some(a => a.startsWith('Compra especial:') && /no se vende suelto/.test(a)));
  assert.ok(!p.advertencias.includes('No tengo el precio normal de este producto.'));
  assert.ok(!p.advertencias.includes('No tiene oferta registrada.'));
});

test('la regla es estricta: necesita el texto "Compra especial" al inicio, precio de oferta y ningún precio normal', () => {
  const b = { id: 'x', nombre: 'X', categoria: 'c', estado: 'pendiente_revision' };
  const prep = (extra) => prepararProducto({ ...b, ...extra }, campana, HOY);
  assert.equal(prep({ precio_normal: 0, precio_oferta: 3000, promocion: 'Compra especial; por la compra de X' }).tipo_promocion, 'compra_especial');
  assert.equal(prep({ precio_normal: 0, precio_oferta: 3000, promocion: '  COMPRA ESPECIAL por la compra de X' }).tipo_promocion, 'compra_especial');
  // con precio normal: es una oferta común
  assert.equal(prep({ precio_normal: 9000, precio_oferta: 3000, promocion: 'Compra especial; por la compra de X' }).tipo_promocion, null);
  // sin precio de oferta: no hay precio que aclarar
  assert.equal(prep({ precio_normal: 0, precio_oferta: 0, promocion: 'Compra especial; por la compra de X' }).tipo_promocion, null);
  // "compra especial" en medio del texto: no
  assert.equal(prep({ precio_normal: 0, precio_oferta: 3000, promocion: 'Oferta; compra especial' }).tipo_promocion, null);
  // sin el texto: sigue siendo dato faltante
  const sin = prep({ precio_normal: 0, precio_oferta: 3000, promocion: 'A tan solo $3.000' });
  assert.equal(sin.tipo_promocion, null);
  assert.ok(sin.advertencias.includes('No tengo el precio normal de este producto.'));
});

test('verificador: citar el precio exige aclarar "solo con la compra" Y "no se vende suelto"', () => {
  const r = [cat.buscar('Kids')];
  const ok = 'La compra especial cuesta $3.000 y solo aplica con la compra de productos de la línea Yanbal Kids; no se vende suelta.';
  assert.deepEqual(verificarCompraEspecial(ok, r), { ok: true, faltan: [] });
  const soloPrecio = verificarCompraEspecial('Cuesta $3.000.', r);
  assert.deepEqual(soloPrecio.faltan, ['solo_aplica_con_compra', 'no_se_vende_suelto']);
  assert.deepEqual(verificarCompraEspecial('Cuesta $3.000, solo aplica con la compra de Kids.', r).faltan, ['no_se_vende_suelto']);
  assert.deepEqual(verificarCompraEspecial('Cuesta $3.000 y no se vende suelto.', r).faltan, ['solo_aplica_con_compra']);
  // sin citar el precio no hay nada que exigir
  assert.equal(verificarCompraEspecial('Esa referencia es de la línea Kids.', r).ok, true);
  // un producto normal no activa la regla
  assert.equal(verificarCompraEspecial('Cuesta $20.000.', [cat.buscar('Producto normal')]).ok, true);
});

test('asistente comercial: si el modelo cita el precio sin aclarar, se entrega la ficha, que siempre lo aclara', async () => {
  const uso = { input_tokens: 10, output_tokens: 5 };
  const guion = [
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'buscar_productos', input: { consulta: '60099' } }], usage: uso },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Ese artículo cuesta $3.000.' }], usage: uso }
  ];
  const responder = crearResponder({ catalogo: cat, cliente: async () => guion.shift() });
  const r = await responder({ mensaje: 'precio del 60099' });
  assert.equal(r.respaldo, true);
  assert.equal(r.motivo, 'compra_especial_sin_aclarar');
  assert.match(r.respuesta, /\$3\.000/);
  assert.match(r.respuesta, /solo aplica con la compra indicada en el catálogo; no se vende suelto/);

  const guion2 = [
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'buscar_productos', input: { consulta: '60099' } }], usage: uso },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Cuesta $3.000, pero solo aplica con la compra de productos Yanbal Kids y no se vende suelto.' }], usage: uso }
  ];
  const r2 = await crearResponder({ catalogo: cat, cliente: async () => guion2.shift() })({ mensaje: 'precio del 60099' });
  assert.equal(r2.respaldo, false);
  assert.ok(r2.advertencias.some(a => a.startsWith('Compra especial:')));
});

test('ficha de respaldo y avisos: el precio siempre sale con la aclaración, sin "no tengo ese dato"', () => {
  const r = cat.buscar('60124');
  const ficha = fichaDeterminista([r]);
  assert.match(ficha, /Precio: \$3\.500 — solo aplica con la compra indicada en el catálogo; no se vende suelto/);
  assert.match(ficha, /Promoción \(texto del catálogo\): Compra especial; por la compra de 3 o más jabones/);
  assert.ok(!/no tengo ese dato|Precio normal|sin oferta registrada/.test(ficha));
  // el aviso explicativo solo aparece si el texto habla del tema
  assert.ok(!advertenciasDe([r], 'Hola').some(a => a.startsWith('Compra especial:')));
  assert.ok(advertenciasDe([r], 'Es una compra especial de $3.500').some(a => a.startsWith('Compra especial:')));
});

test('las instrucciones de los dos agentes cubren la compra especial', () => {
  assert.match(SISTEMA, /compra_especial/);
  assert.match(SISTEMA, /solo aplica con la compra de un producto/);
  assert.match(SISTEMA, /no se vende suelto/);
});

test('estudio de contenido: un texto con el precio de una compra especial sin aclararlo se rechaza', () => {
  const r = [cat.buscar('60099')];
  const mal = verificarContenido('Llévate la compra especial por $3.000 (vigente hasta 06/11/2026). #YanbalKids', r);
  assert.ok(mal.violaciones.some(v => v.tipo === 'compra_especial_sin_aclarar'));
  const bien = verificarContenido('Llévate la compra especial por $3.000, solo con la compra de productos Yanbal Kids; no se vende suelta (vigente hasta 06/11/2026). #YanbalKids', r);
  assert.ok(!bien.violaciones.some(v => v.tipo === 'compra_especial_sin_aclarar'));
});

test('auditor: las compras especiales tienen su propia categoría y no cuentan como datos faltantes', () => {
  const c = auditar(productos, campana, HOY).categorias;
  assert.deepEqual(c.compras_especiales.map(p => p.id).sort(), ['p60099', 'p60124']);
  assert.ok(!c.sin_ningun_precio.some(p => /^p6/.test(p.id)));
});
