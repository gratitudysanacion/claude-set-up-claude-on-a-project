'use strict';
// Sets del catálogo C12: la promoción empieza por "Set" y lista los componentes sin la marca "componentes en oferta:".
const test = require('node:test');
const assert = require('node:assert/strict');
const { analizarPromocion, extraerImportes } = require('../src/reglas');

test('set sin marca: la suma de componentes debe dar el precio de oferta del set', () => {
  const ok = analizarPromocion('Set al 55% dscto.; Ccori Parfum oferta $108.500; Loción Perfumada oferta $27.000 (ml a $135,00); Desodorante Perfumado oferta $11.000', 146500);
  assert.deepEqual([ok.estado, ok.motivo, ok.suma], ['ok', 'set_coincide', 146500]);
  const ok2 = analizarPromocion('Set 50% dscto.; Uniquecil Extra XL oferta a $27.000; Delineador Plumón Tattoo oferta a $28.000', 55000);
  assert.equal(ok2.estado, 'ok');
  const mal = analizarPromocion('Set al 55% dscto.; Ccori Parfum oferta $108.500; Loción Perfumada oferta $27.000', 146500);
  assert.deepEqual([mal.estado, mal.motivo, mal.suma], ['inconsistente', 'set_no_coincide', 135500]);
});

test('set sin marca: el precio por unidad (ml a $...) no cuenta como componente', () => {
  const im = extraerImportes('Set al 50% dscto.; Crema oferta $30.500 (ml a $122); Gel oferta $30.500 (ml a $122)');
  assert.deepEqual(im.map(i => i.tipo), ['componente', 'unidad', 'componente', 'unidad']);
  assert.equal(analizarPromocion('Set al 50% dscto.; Crema oferta $30.500 (ml a $122); Gel oferta $30.500 (ml a $122)', 61000).estado, 'ok');
});

test('los textos que no empiezan por Set y el formato con marca siguen igual', () => {
  assert.equal(analizarPromocion('Oferta $48.500 c/u; 45% dscto.; ml a $64,67', 48500).estado, 'ok');
  assert.equal(analizarPromocion('Oferta $50.000 c/u', 48500).estado, 'inconsistente');
  assert.equal(extraerImportes('Oferta WOW 50%; Settings a $1.000')[0].tipo, 'oferta'); // "Settings" no es un set
  assert.equal(analizarPromocion('SET $49.500 c/u; 55% dscto.; componentes en oferta: Colonia $38.500, Jabón $11.000', 49500).estado, 'ok');
  assert.equal(analizarPromocion('SET 55% dscto.; componentes en oferta: Colonia $38.500, Jabón $11.000', 60000).estado, 'inconsistente');
});
