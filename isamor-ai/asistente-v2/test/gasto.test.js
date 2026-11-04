'use strict';
// Tope mensual de gasto de la IA: valoración de tokens, aviso al 80 %, bloqueo al tope, cambio de mes y persistencia segura.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { crearGasto } = require('../src/gasto');

const carpeta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gasto-'));
// 1 millón de tokens de salida cuestan 0,50 USD; de entrada, 0,10 USD (precios por defecto).
const t = (y, m, d, h = 12) => Date.UTC(y, m - 1, d, h + 5, 0, 0); // hora de Colombia = UTC-5

test('gasto: valora entrada y salida, avisa al 80 % y bloquea al llegar al tope', () => {
  const g = crearGasto({ topeUsd: 10, ahora: () => t(2026, 11, 4) });
  assert.deepEqual(g.estado(), { mes: '2026-11', usd: 0, tope: 10, porcentaje: 0, llamadas: 0, aviso: false, bloqueado: false });
  g.registrar({ entrada: 1_000_000, salida: 1_000_000 });            // 0,60 USD
  assert.equal(g.estado().usd, 0.6);
  g.registrar({ entrada: 0, salida: 15_000_000 });                   // +7,50 = 8,10
  const e = g.estado();
  assert.equal(e.usd, 8.1);
  assert.equal(e.aviso, true);
  assert.equal(e.bloqueado, false);
  assert.equal(e.porcentaje, 81);
  g.registrar({ entrada: 0, salida: 4_000_000 });                    // +2,00 = 10,10
  assert.equal(g.estado().bloqueado, true);
  assert.equal(g.estado().aviso, false, 'bloqueado ya no es solo aviso');
});

test('gasto: el tope exacto bloquea y un valor justo por debajo no', () => {
  const g = crearGasto({ topeUsd: 1, ahora: () => t(2026, 11, 4) });
  g.registrar({ entrada: 0, salida: 1_999_999 });
  assert.equal(g.estado().bloqueado, false);
  g.registrar({ entrada: 0, salida: 1 });
  assert.equal(g.estado().bloqueado, true);
});

test('gasto: al cambiar el mes (hora de Colombia) el contador vuelve a cero', () => {
  let ahora = t(2026, 11, 30, 22);
  const g = crearGasto({ topeUsd: 1, ahora: () => ahora });
  g.registrar({ entrada: 0, salida: 5_000_000 });
  assert.equal(g.estado().bloqueado, true);
  ahora = t(2026, 12, 1, 0);       // 00:00 del 1 de diciembre en Colombia
  assert.deepEqual([g.estado().mes, g.estado().usd, g.estado().bloqueado], ['2026-12', 0, false]);
  // a las 23:30 del 30 de noviembre en Colombia (04:30 UTC del 1 dic) todavía es noviembre
  ahora = Date.UTC(2026, 11, 1, 4, 30);
  const h = crearGasto({ topeUsd: 1, ahora: () => ahora });
  assert.equal(h.estado().mes, '2026-11');
});

test('gasto: valores inválidos no suman ni rompen, y cada llamada se cuenta', () => {
  const g = crearGasto({ topeUsd: 10, ahora: () => t(2026, 11, 4) });
  g.registrar({ entrada: 'x', salida: -5 });
  g.registrar(null);
  g.registrar({ entrada: NaN, salida: Infinity });
  assert.equal(g.estado().usd, 0);
  assert.equal(g.estado().llamadas, 3);
  assert.throws(() => crearGasto({ topeUsd: 0 }), /mayor que cero/);
  assert.throws(() => crearGasto({ topeUsd: -1 }), /mayor que cero/);
});

test('gasto: persiste con permisos 600, solo guarda totales y se recupera al reiniciar', () => {
  const dir = carpeta();
  try {
    const ruta = path.join(dir, 'gasto.json');
    const g = crearGasto({ ruta, topeUsd: 10, ahora: () => t(2026, 11, 4) });
    g.registrar({ entrada: 2_000_000, salida: 3_000_000 });
    assert.equal((fs.statSync(ruta).mode & 0o777).toString(8), '600');
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(ruta, 'utf8'))).sort(), ['entrada', 'llamadas', 'mes', 'salida']);
    assert.equal(fs.existsSync(`${ruta}.tmp`), false);
    const otra = crearGasto({ ruta, topeUsd: 10, ahora: () => t(2026, 11, 5) });
    assert.equal(otra.estado().usd, 1.7);
    assert.equal(otra.estado().llamadas, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('gasto: un archivo dañado o con datos raros empieza en cero y un mes anterior no se arrastra', () => {
  const dir = carpeta();
  try {
    const ruta = path.join(dir, 'gasto.json');
    fs.writeFileSync(ruta, '{no es json');
    assert.equal(crearGasto({ ruta, ahora: () => t(2026, 11, 4) }).estado().usd, 0);
    fs.writeFileSync(ruta, JSON.stringify({ mes: '2026-11', entrada: 'mucho', salida: null }));
    assert.equal(crearGasto({ ruta, ahora: () => t(2026, 11, 4) }).estado().usd, 0);
    fs.writeFileSync(ruta, JSON.stringify({ mes: '2026-10', entrada: 0, salida: 50_000_000, llamadas: 9 }));
    const g = crearGasto({ ruta, topeUsd: 10, ahora: () => t(2026, 11, 4) });
    assert.deepEqual([g.estado().mes, g.estado().usd, g.estado().bloqueado], ['2026-11', 0, false]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('gasto: si no se puede escribir, sigue contando en memoria y avisa sin tumbar el servicio', () => {
  const dir = carpeta();
  try {
    const registros = [];
    const g = crearGasto({ ruta: path.join(dir, 'no-existe', 'x', 'gasto.json'), log: d => registros.push(d), ahora: () => t(2026, 11, 4) });
    fs.writeFileSync(path.join(dir, 'no-existe'), 'archivo, no carpeta');   // impide crear la carpeta
    g.registrar({ entrada: 1_000_000, salida: 0 });
    assert.equal(g.estado().usd, 0.1);
    assert.ok(registros.some(r => r.evento === 'gasto_no_guardado'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('gasto: los precios se pueden cambiar', () => {
  const g = crearGasto({ topeUsd: 10, precioEntrada: 1, precioSalida: 5, ahora: () => t(2026, 11, 4) });
  g.registrar({ entrada: 1_000_000, salida: 1_000_000 });
  assert.equal(g.estado().usd, 6);
});
