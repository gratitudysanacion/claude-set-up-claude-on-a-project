'use strict';
// Búsqueda por tipo de oferta (2 x 1, obsequio, compra especial), afirmaciones falsas de "no hay" y precio normal espurio.
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearCatalogo } = require('../src/catalogo');
const { crearResponder, SISTEMA, HERRAMIENTAS } = require('../src/ia');
const { verificarAusenciaFalsa, verificarCompraEspecial } = require('../src/verificador');
const { fichaDeterminista } = require('../src/respaldo');
const { productos: base, campana } = require('./fixtures');

const b = { estado: 'pendiente_revision', vigencia_desde: '', vigencia_hasta: '', presentacion: '' };
const extra = [
  { ...b, id: 'p60099', nombre: 'Bolsa Yanbal Kids', referencia: '60099', categoria: 'Bebés y niños', precio_normal: null, precio_oferta: 3000, pagina_origen: '144', promocion: 'Compra especial; por la compra de productos de la línea Yanbal Kids' },
  { ...b, id: 'p60124', nombre: 'Caja Especial para 3 Jabones', referencia: '60124', categoria: 'Cuidado personal', precio_normal: null, precio_oferta: 3500, pagina_origen: '29', promocion: 'Compra especial; por la compra de 3 o más jabones' },
  { ...b, id: 'pbolsaobs', nombre: 'Bolsa Obsequio Kids', referencia: '', categoria: 'Accesorios', precio_normal: 0, precio_oferta: 0, pagina_origen: '6', promocion: 'Obsequio GRATIS por la compra de productos Kids; sin precio ni código propio.' },
  { ...b, id: 'p60121', nombre: 'Bolsa de Regalo', referencia: '60121', categoria: 'Accesorios', precio_normal: null, precio_oferta: 3000, pagina_origen: '5', promocion: 'Bolsa de Regalo; oferta $3.000; sin condición de compra' }
];
// 14 productos 2 x 1 más, para probar el límite de 10 y el conteo por categoría
const muchos = Array.from({ length: 14 }, (_, i) => ({
  ...b, id: `pdos${i}`, nombre: `Producto dos por uno ${String(i).padStart(2, '0')}`, referencia: `88${i}`, categoria: i % 2 ? 'Perfumes' : 'Cuidado facial',
  precio_normal: 0, precio_oferta: 20000 + i, pagina_origen: '70', promocion: `2 x 1 por $${20000 + i} (pide 1, recibe 2)`
}));
const cat = crearCatalogo({ productos: [...base, ...extra, ...muchos], campana, hoy: () => '2026-10-27' });
const refs = r => r.productos.map(p => p.referencia || p.id);

test('buscar por tipo: «un 2 x 1» y variantes listan los 2 x 1, con total y límite de 10', () => {
  for (const q of ['Un 2 x 1', '2x1', '2 x 1', 'dos por uno', '¿Qué productos están en 2 x 1?', 'promoción 2x1', 'cuales hay en 2x1']) {
    const r = cat.buscar(q);
    assert.equal(r.tipo_oferta, '2x1', q);
    assert.equal(r.total_coincidencias, 18, q);   // 4 de los datos de prueba + 14
    assert.equal(r.devueltos, 10, q);
    assert.equal(r.truncado, true, q);
    assert.ok(r.productos.every(p => p.tipo_promocion === '2x1'), q);
    assert.match(r.nota, /cuántos hay en total/);
  }
});

test('buscar por tipo: cuenta por categoría para poder acotar, y se puede acotar con una categoría o un término', () => {
  const r = cat.buscar('2x1');
  assert.equal(Object.values(r.por_categoria).reduce((a, n) => a + n, 0), 18);
  assert.equal(r.por_categoria.Perfumes, 7);
  const perf = cat.buscar('2x1 perfumes');
  assert.equal(perf.tipo_oferta, '2x1');
  assert.equal(perf.total_coincidencias, 7);
  assert.ok(perf.productos.every(p => p.categoria === 'Perfumes'));
  assert.equal(cat.buscar('2x1', { categoria: 'perfumes' }).total_coincidencias, 7);
  assert.equal(cat.buscar('2x1', { limite: 3 }).devueltos, 3);
});

test('buscar por tipo: obsequios, regalos y compras especiales', () => {
  for (const q of ['obsequios', 'obsequio', 'regalos', 'productos de regalo', 'qué obsequios hay']) {
    const r = cat.buscar(q);
    assert.equal(r.tipo_oferta, 'obsequio', q);
    assert.deepEqual(refs(r).sort(), ['pbolsaobs', 'pobsequio'], q);
  }
  const ce = cat.buscar('compra especial');
  assert.equal(ce.tipo_oferta, 'compra_especial');
  assert.deepEqual(refs(ce).sort(), ['60099', '60124']);
  assert.deepEqual(refs(cat.buscar('¿Qué compras especiales hay?')).sort(), ['60099', '60124']);
  assert.deepEqual(refs(cat.buscar('obsequio zentro')), ['pobsequio'], 'tipo + término');
  assert.deepEqual(refs(cat.buscar('obsequio bolsa')), ['pbolsaobs'], 'tipo + término');
});

test('buscar por tipo: «regalo» dentro de un nombre sigue siendo búsqueda por nombre; nombres y referencias no cambian', () => {
  const bolsa = cat.buscar('bolsa de regalo');
  assert.equal(bolsa.tipo_oferta, undefined);
  assert.deepEqual(refs(bolsa), ['60121']);
  assert.equal(cat.buscar('60099').tipo_oferta, undefined);
  assert.deepEqual(refs(cat.buscar('60099')), ['60099']);
  assert.deepEqual(refs(cat.buscar('Kids')).sort(), ['60099', 'pbolsaobs']);
  assert.equal(cat.buscar('Zentro').tipo_oferta, undefined);
  assert.ok(cat.buscar('Zentro').productos.length >= 1);
});

test('buscar por tipo: sin productos del tipo lo dice; un término extra sin coincidencias cae a la búsqueda normal', () => {
  const sin = crearCatalogo({ productos: extra.filter(p => p.id === 'p60121'), campana, hoy: () => '2026-10-27' });
  const r = sin.buscar('2x1');
  assert.deepEqual([r.tipo_oferta, r.total_coincidencias, r.productos.length], ['2x1', 0, 0]);
  assert.match(r.nota, /no tiene productos de este tipo/);
  const mixta = cat.buscar('2x1 joyería inexistente');
  assert.equal(mixta.tipo_oferta, undefined);
  assert.equal(mixta.total_coincidencias, 0);
});

test('instrucciones y herramienta: el modelo sabe usar la búsqueda por tipo y no decir que no hay', () => {
  assert.match(SISTEMA, /tipo_oferta/);
  assert.match(SISTEMA, /NUNCA digas que no hay productos de ese tipo/);
  assert.match(HERRAMIENTAS[0].description, /TIPO de oferta.*2 x 1.*obsequio.*compra especial/);
});

// ---- verificadores ----
const resultadoCon = tipo => [{ productos: [{ id: 'x', tipo_promocion: tipo, precio_normal: null, precio_oferta: 3000 }] }];

test('ausencia falsa: decir que no hay 2 x 1, obsequios o compras especiales cuando el resultado los trae se rechaza', () => {
  const v = (t, tipo) => verificarAusenciaFalsa(t, resultadoCon(tipo));
  assert.deepEqual(v('No encontré productos con promoción 2x1 en la búsqueda.', '2x1').tipos, ['2x1']);
  assert.deepEqual(v('Actualmente no hay productos en 2 x 1.', '2x1').tipos, ['2x1']);
  assert.deepEqual(v('No tengo ningún producto con dos por uno', '2x1').tipos, ['2x1']);
  assert.deepEqual(v('No encontré obsequios en el catálogo', 'obsequio').tipos, ['obsequio']);
  assert.deepEqual(v('No hay regalos disponibles', 'obsequio').tipos, ['obsequio']);
  assert.deepEqual(v('No existen compras especiales', 'compra_especial').tipos, ['compra_especial']);
  assert.equal(v('NO ENCONTRÉ PRODUCTOS CON PROMOCIÓN 2X1', '2x1').ok, false);
  // coherente con el resultado: no se rechaza
  assert.equal(verificarAusenciaFalsa('No hay productos 2 x 1 en la categoría joyería.', [{ productos: [] }]).ok, true);
  assert.equal(verificarAusenciaFalsa('No encontré obsequios', resultadoCon('2x1')).ok, true, 'el resultado trae otro tipo');
  assert.equal(v('Hay 18 productos en 2 x 1. Aquí están los primeros 10.', '2x1').ok, true);
});

test('compra especial: «precio normal: no tengo ese dato» se rechaza, salvo que otro producto del resultado sí carezca de precio normal', () => {
  const ce = { id: 'a', tipo_promocion: 'compra_especial', precio_normal: null, precio_oferta: 3000 };
  const ok = 'Precio especial: $3.000. Solo aplica con la compra de productos de Yanbal Kids. No se vende suelto.';
  assert.deepEqual(verificarCompraEspecial(ok, [{ productos: [ce] }]), { ok: true, faltan: [] });
  for (const mal of [`${ok}\n- Precio normal: no tengo ese dato.`, `${ok} No tengo el precio normal.`, `${ok} Precio normal: no tengo ese dato`]) {
    assert.deepEqual(verificarCompraEspecial(mal, [{ productos: [ce] }]).faltan, ['sin_precio_normal_espurio'], mal);
  }
  const otro = { id: 'b', tipo_promocion: null, precio_normal: null, precio_oferta: null };
  assert.equal(verificarCompraEspecial(`${ok} Precio normal: no tengo ese dato.`, [{ productos: [ce, otro] }]).ok, true);
});

test('asistente comercial: la ausencia falsa y el precio normal espurio caen a la ficha del catálogo con su motivo', async () => {
  const uso = { input_tokens: 10, output_tokens: 5 };
  const conTexto = ({ consulta, dice }) => {
    const guion = [
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'buscar_productos', input: { consulta } }], usage: uso },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: dice }], usage: uso }
    ];
    return crearResponder({ catalogo: cat, cliente: async () => guion.shift() });
  };
  const a = await conTexto({ consulta: 'Un 2 x 1', dice: 'No encontré productos con promoción 2x1.' })({ mensaje: 'Un 2 x 1' });
  assert.deepEqual([a.respaldo, a.motivo], [true, 'afirma_ausencia_falsa']);
  assert.match(a.respuesta, /Producto dos por uno|Delineador|Línea Reparación/);
  const ok = await conTexto({ consulta: 'Un 2 x 1', dice: 'Hay 18 productos en 2 x 1; estos son los primeros 10, indícame la categoría para acotar.' })({ mensaje: 'Un 2 x 1' });
  assert.equal(ok.respaldo, false);
  const c = await conTexto({ consulta: '60099', dice: 'Precio especial: $3.000. Solo aplica con la compra de productos Yanbal Kids y no se vende suelto. Precio normal: no tengo ese dato.' })({ mensaje: 'precio del 60099' });
  assert.equal(c.respaldo, true);
  assert.match(c.respuesta, /solo aplica con la compra indicada en el catálogo; no se vende suelto/);
  assert.ok(!/Precio normal: no tengo/.test(c.respuesta), 'la ficha no repite el precio normal espurio');
});

test('ficha de respaldo de una búsqueda por tipo: muestra 5 fichas y cuántas coincidencias más hay (18 en total)', () => {
  const f = fichaDeterminista([cat.buscar('2x1')]);
  assert.match(f, /Hay 13 coincidencia\(s\) más/);
});
