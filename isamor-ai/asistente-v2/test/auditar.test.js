'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { auditar } = require('../scripts/auditar-catalogo');
const { productos, campana } = require('./fixtures');

test('la auditoría clasifica los productos de prueba con las reglas del asistente', () => {
  const { total, categorias: c } = auditar(productos, campana, '2026-10-27');
  const refs = lista => lista.map(p => p.referencia).sort();
  assert.equal(total, productos.length);
  assert.deepEqual(refs(c.dos_por_uno_deducido), ['5104', '723']);
  assert.deepEqual(refs(c.dos_por_uno_sin_deducir), ['9400', '9401']);
  assert.ok(refs(c.solo_oferta).includes('9402') && refs(c.solo_oferta).includes('9400'));
  assert.ok(!refs(c.solo_oferta).includes('5104'));
  assert.ok(refs(c.sin_ningun_precio).includes('9001'));
  assert.ok(refs(c.promocion_no_coincide).includes('79001') && refs(c.promocion_no_coincide).includes('9400'));
});

test('el comando solo lee: no cambia el archivo auditado y muestra conteos', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auditar-'));
  const lectura = path.join(dir, 'lectura.json');
  const camp = path.join(dir, 'campana.json');
  fs.writeFileSync(lectura, JSON.stringify({ productos }));
  fs.writeFileSync(camp, JSON.stringify(campana));
  const antes = fs.readFileSync(lectura, 'utf8');
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'auditar-catalogo.js'), lectura, camp], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`Productos auditados: ${productos.length}`));
  assert.match(r.stdout, /dos_por_uno_deducido: 2/);
  assert.equal(fs.readFileSync(lectura, 'utf8'), antes);
  const malo = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'auditar-catalogo.js'), path.join(dir, 'no.json')], { encoding: 'utf8' });
  assert.equal(malo.status, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});
