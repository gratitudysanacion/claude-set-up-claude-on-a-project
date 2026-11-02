'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { construirLectura, exportar, leerArgumentos, CAMPOS_AUTORIZADOS, ErrorExportacion } = require('../scripts/exportar-lectura');
const { cargarProductos, crearCatalogo } = require('../src/catalogo');
const { productos } = require('./fixtures');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'exportar-lectura.js');
const PROHIBIDOS = ['notas', 'origen', 'aviso_revision', 'estado_importacion'];

// Catálogo "del panel": fixtures + campos internos que NO deben llegar al asistente.
function origenPanel() {
  return {
    version: '2026-10-26', moneda: 'COP',
    productos: productos.map((p, i) => ({
      ...p, notas: `nota interna ${i}`, origen: 'catalogo_impreso', aviso_revision: 'REVISAR_SECRETO', estado_importacion: 'ok'
    })),
    historial: [{ quien: 'admin', cuando: 'x' }]
  };
}

function carpeta() { return fs.mkdtempSync(path.join(os.tmpdir(), 'exportar-')); }
const sha = ruta => crypto.createHash('sha256').update(fs.readFileSync(ruta)).digest('hex');

test('solo se copian los campos autorizados; notas, origen, avisos e historial no salen', () => {
  const { datos } = construirLectura(origenPanel());
  assert.equal(datos.productos.length, productos.length);
  for (const p of datos.productos) {
    assert.deepEqual(Object.keys(p), CAMPOS_AUTORIZADOS);
    for (const prohibido of PROHIBIDOS) assert.ok(!(prohibido in p), prohibido);
  }
  const texto = JSON.stringify(datos);
  assert.ok(!texto.includes('REVISAR_SECRETO') && !texto.includes('nota interna') && !texto.includes('historial') && !texto.includes('admin'));
  assert.equal(datos.moneda, 'COP');
  assert.equal(datos.origen_version, '2026-10-26');
});

test('normaliza precios (texto, vacío, nulo, negativo, no numérico) y cuenta las anomalías sin inventar valores', () => {
  const origen = { version: 'v', moneda: 'COP', productos: [
    { id: 'a', nombre: 'A', precio_normal: '89000', precio_oferta: '' },
    { id: 'b', nombre: 'B', precio_normal: null, precio_oferta: undefined },
    { id: 'c', nombre: 'C', precio_normal: -5, precio_oferta: 'abc' },
    { id: 'd', nombre: '  D  ', precio_normal: 10, precio_oferta: 5, referencia: 670 }
  ] };
  const { datos, resumen } = construirLectura(origen);
  assert.deepEqual(datos.productos.map(p => [p.precio_normal, p.precio_oferta]), [[89000, 0], [0, 0], [0, 0], [10, 5]]);
  assert.equal(datos.productos[3].nombre, 'D');
  assert.equal(datos.productos[3].referencia, '670');
  assert.equal(resumen.anomalias.precio_negativo, 1);
  assert.equal(resumen.anomalias.precio_no_numerico, 1);
});

test('rechaza origen sin lista, vacío, con ids repetidos o sin id, y conteo distinto del esperado', () => {
  assert.throws(() => construirLectura(null), ErrorExportacion);
  assert.throws(() => construirLectura({ productos: [] }), ErrorExportacion);
  assert.throws(() => construirLectura({ productos: 'x' }), ErrorExportacion);
  assert.throws(() => construirLectura({ productos: [{ id: 'a', nombre: 'A' }, { id: 'a', nombre: 'B' }] }), /repetidos: 1/);
  assert.throws(() => construirLectura({ productos: [{ nombre: 'A' }] }), /sin id: 1/);
  assert.throws(() => construirLectura(origenPanel(), { esperados: 437 }), /Se esperaban 437/);
  assert.doesNotThrow(() => construirLectura(origenPanel(), { esperados: productos.length }));
});

test('contrato con el asistente: lo exportado se carga y se busca igual que los datos originales', () => {
  const dir = carpeta();
  const origen = path.join(dir, 'catalogo.json');
  const destino = path.join(dir, 'lectura', 'catalogo_lectura.json');
  fs.writeFileSync(origen, JSON.stringify(origenPanel()));
  const r = exportar({ origen, destino, esperados: productos.length });
  assert.equal(r.total, productos.length);
  assert.equal(r.estados.pendiente_revision, productos.length - 1); // uno está confirmado
  const cargados = cargarProductos(destino);
  const hoy = () => '2026-10-27';
  const a = crearCatalogo({ productos: cargados, campana: null, hoy }).buscar('670');
  const b = crearCatalogo({ productos, campana: null, hoy }).buscar('670');
  assert.deepEqual(a.productos, b.productos);
  assert.equal(a.productos[0].precio_oferta, 48500);
  assert.equal(r.sha256, sha(destino));
  assert.equal(fs.statSync(destino).mode & 0o777, 0o600);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI: no modifica el origen, no imprime valores del catálogo y entrega la huella', () => {
  const dir = carpeta();
  const origen = path.join(dir, 'catalogo.json');
  const destino = path.join(dir, 'salida.json');
  fs.writeFileSync(origen, JSON.stringify(origenPanel()));
  const antes = sha(origen);
  const r = spawnSync(process.execPath, [SCRIPT, '--origen', origen, '--destino', destino, '--esperados', String(productos.length)], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(sha(origen), antes);
  assert.match(r.stdout, new RegExp(`Exportados ${productos.length} productos`));
  assert.match(r.stdout, /SHA-256: [0-9a-f]{64}/);
  for (const p of productos) assert.ok(!r.stdout.includes(p.nombre), 'no debe imprimir nombres');
  assert.ok(!r.stdout.includes('48500') && !r.stdout.includes('89000'));
  assert.ok(fs.existsSync(destino));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI: ante un error no deja archivo de destino ni temporal y sale con código 1', () => {
  const dir = carpeta();
  const origen = path.join(dir, 'catalogo.json');
  const destino = path.join(dir, 'salida.json');
  fs.writeFileSync(origen, JSON.stringify(origenPanel()));
  const malo = spawnSync(process.execPath, [SCRIPT, '--origen', origen, '--destino', destino, '--esperados', '437'], { encoding: 'utf8' });
  assert.equal(malo.status, 1);
  assert.match(malo.stderr, /Se esperaban 437/);
  assert.deepEqual(fs.readdirSync(dir), ['catalogo.json']);
  const inexistente = spawnSync(process.execPath, [SCRIPT, '--origen', path.join(dir, 'no.json'), '--destino', destino], { encoding: 'utf8' });
  assert.equal(inexistente.status, 1);
  assert.match(inexistente.stderr, /No se pudo leer el origen \(ENOENT\)/);
  const mismo = spawnSync(process.execPath, [SCRIPT, '--origen', origen, '--destino', origen], { encoding: 'utf8' });
  assert.equal(mismo.status, 1);
  assert.match(mismo.stderr, /mismo archivo/);
  assert.equal(JSON.parse(fs.readFileSync(origen, 'utf8')).productos.length, productos.length);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('argumentos inválidos se rechazan con el modo de uso', () => {
  assert.throws(() => leerArgumentos(['--otra', 'x']), /Uso:/);
  assert.throws(() => leerArgumentos(['--origen']), /Uso:/);
  assert.deepEqual(leerArgumentos(['--origen', 'a', '--esperados', '5']), { origen: 'a', esperados: '5' });
});
