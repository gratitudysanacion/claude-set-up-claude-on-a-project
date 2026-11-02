'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearAgente, recortarRespuesta, NOTA_RECORTE } = require('../src/agente');
const { compactarResultado, ejecutarHerramienta } = require('../src/ia');
const { fichaDeterminista } = require('../src/respaldo');
const { verificarRespuesta } = require('../src/verificador');
const { crearCatalogo } = require('../src/catalogo');
const { productos, campana } = require('./fixtures');

const dice = t => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }], usage: { input_tokens: 10, output_tokens: 5 } });
const base = { sistema: 's', herramientas: [], ejecutar: () => ({}), advertencias: () => ['aviso'] };

test('agente genérico: sin cliente ni llave es null; con cliente responde y acumula el uso', async () => {
  assert.equal(crearAgente({ ...base, verificar: () => ({ ok: true }), respaldo: () => 'x', apiKey: '' }), null);
  const r = await crearAgente({ ...base, verificar: () => ({ ok: true }), respaldo: () => 'x', cliente: async () => dice('hola') })({ mensaje: 'm' });
  assert.deepEqual(r, { respuesta: 'hola', advertencias: ['aviso'], uso: { entrada: 10, salida: 5, vueltas: 1, cortada: false }, respaldo: false });
});

test('agente genérico: el verificador decide, el motivo viaja al respaldo y sin reintentos no se vuelve a llamar al modelo', async () => {
  let llamadas = 0;
  let recibido = null;
  const agente = crearAgente({
    ...base, cliente: async () => { llamadas++; return dice('texto malo'); },
    verificar: () => ({ ok: false, violaciones: ['x'], motivo: 'mi_motivo' }),
    respaldo: (resultados, motivo, v) => { recibido = { motivo, v }; return 'respaldo'; }
  });
  const r = await agente({ mensaje: 'm' });
  assert.equal(llamadas, 1);
  assert.equal(r.respaldo, true);
  assert.equal(r.motivo, 'mi_motivo');
  assert.equal(r.respuesta, 'respaldo');
  assert.deepEqual(recibido.v.violaciones, ['x']);
});

test('agente genérico: los reintentos son exactamente los configurados', async () => {
  for (const reintentos of [0, 1, 2]) {
    let llamadas = 0;
    const agente = crearAgente({
      ...base, reintentos, cliente: async () => { llamadas++; return dice('malo'); },
      verificar: () => ({ ok: false, violaciones: [], correccion: 'corrige' }), respaldo: () => 'r'
    });
    const r = await agente({ mensaje: 'm' });
    assert.equal(llamadas, 1 + reintentos);
    assert.equal(r.respaldo, true);
    assert.equal(r.uso.reintentos, reintentos || undefined);
  }
});

test('agente genérico: un error del cliente se propaga con su código', async () => {
  const agente = crearAgente({ ...base, verificar: () => ({ ok: true }), respaldo: () => 'x', cliente: async () => { const e = new Error('x'); e.codigo = 'saldo_agotado'; throw e; } });
  await assert.rejects(agente({ mensaje: 'm' }), { codigo: 'saldo_agotado' });
});

// ---- Recorte de datos enviados al modelo ----
test('recorte de datos: el resultado enviado al modelo pesa bastante menos y conserva todo lo que se usa', () => {
  const cat = crearCatalogo({ productos, campana, hoy: () => '2026-10-27' });
  const completo = cat.buscar('labial');
  const compacto = ejecutarHerramienta(cat, 'buscar_productos', { consulta: 'labial' });
  const antes = JSON.stringify(completo).length;
  const despues = JSON.stringify(compacto).length;
  assert.ok(despues < antes * 0.8, `se esperaba ≥20 % menos: ${antes} -> ${despues}`);
  assert.equal(compacto.productos.length, completo.productos.length);
  for (const [i, p] of compacto.productos.entries()) {
    const o = completo.productos[i];
    for (const campo of ['id', 'referencia', 'nombre', 'precio_normal', 'precio_oferta', 'promocion', 'pagina_origen', 'advertencias']) assert.deepEqual(p[campo], o[campo], campo);
    assert.equal(p.oferta.estado, o.oferta.estado);
    for (const quitado of ['coherencia', 'revision', 'precio_normal_deducido']) assert.ok(!(quitado in p), quitado);
  }
  assert.ok(!('fecha' in compacto));
  assert.equal(compacto.campana.estado, 'vigente');
  assert.equal(compacto.campana.nombre, 'C11 2026');
});

test('recorte de datos: 2 x 1 y obsequio conservan su tipo y su resumen; la ficha y el verificador funcionan con datos recortados', () => {
  const cat = crearCatalogo({ productos, campana, hoy: () => '2026-10-27' });
  const r = ejecutarHerramienta(cat, 'buscar_productos', { consulta: '5104' });
  assert.equal(r.productos[0].tipo_promocion, '2x1');
  assert.equal(r.productos[0].resumen_oferta, 'Oferta 2 x 1: pides 1 y recibes 2 por el precio normal.');
  assert.deepEqual(verificarRespuesta(fichaDeterminista([r]), [r]), { ok: true, violaciones: [] });
  assert.match(fichaDeterminista([r]), /Vigente hasta el 06\/11\/2026/);
  const o = ejecutarHerramienta(cat, 'buscar_productos', { consulta: 'Zentro' });
  assert.equal(o.productos[0].tipo_promocion, 'obsequio');
});

test('recorte de datos: lo que no es un resultado de productos pasa sin cambios', () => {
  assert.deepEqual(compactarResultado({ error: 'x' }), { error: 'x' });
  assert.equal(compactarResultado(null), null);
});

test('recorte: no deja encabezados vacíos ni renglones en blanco al final, y conserva lo completo', () => {
  const texto = 'VARIANTE 1:\nDescripción completa.\n\nHASHTAGS:\n#Yanbal #Maquillaje\n\nVARIANTE 2:\nDescripción completa dos.\n\nHASHTAGS:\n#Yan';
  assert.equal(recortarRespuesta(texto), `VARIANTE 1:\nDescripción completa.\n\nHASHTAGS:\n#Yanbal #Maquillaje\n\nVARIANTE 2:\nDescripción completa dos.\n\n${NOTA_RECORTE}`);
  assert.equal(recortarRespuesta('HASHTAGS:\n#Yan'), NOTA_RECORTE);
  assert.equal(recortarRespuesta('Una línea cortada'), NOTA_RECORTE);
  assert.equal(recortarRespuesta('Primera.\nSegunda.\nTerce'), `Primera.\nSegunda.\n\n${NOTA_RECORTE}`);
});
