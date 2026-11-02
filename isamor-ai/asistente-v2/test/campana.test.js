'use strict';
// Campaña programada (C12 entra sola en su fecha) y script de carga de campañas.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawnSync, spawn } = require('node:child_process');
const { crearCatalogoProgramado, crearCatalogo } = require('../src/catalogo');
const { fechaValida } = require('../scripts/cargar-campana');
const { productos, campana } = require('./fixtures');

const C11 = campana; // C11 2026: 2026-10-10 a 2026-11-06
const C12 = { campana: 'C12 2026', vigencia_desde: '2026-11-07', vigencia_hasta: '2026-12-04' };
const productosC12 = productos.filter(p => p.referencia !== '9300').map(p => (p.referencia === '670' ? { ...p, precio_oferta: 50000, promocion: 'Oferta $50.000 c/u' } : p));

function reloj(inicial) { const r = { f: inicial }; r.hoy = () => r.f; return r; }
function programado(r, siguiente = { productos: productosC12, campana: C12 }) {
  return crearCatalogoProgramado({ actual: { productos, campana: C11 }, siguiente, hoy: r.hoy });
}

test('antes del inicio de C12 responde C11; a partir del 7 de noviembre responde C12, sin reiniciar nada', () => {
  const r = reloj('2026-11-06');
  const cat = programado(r);
  assert.equal(cat.estado().campana.nombre, 'C11 2026');
  assert.equal(cat.buscar('670').productos[0].precio_oferta, 48500);
  assert.equal(cat.total, productos.length);
  assert.equal(cat.programacion().activa, 'actual');
  assert.deepEqual(cat.programacion().siguiente, { nombre: 'C12 2026', desde: '2026-11-07', productos: productosC12.length });

  r.f = '2026-11-07';
  assert.equal(cat.estado().campana.nombre, 'C12 2026');
  assert.equal(cat.estado().campana.estado, 'vigente');
  assert.equal(cat.buscar('670').productos[0].precio_oferta, 50000);
  assert.equal(cat.total, productosC12.length);
  assert.equal(cat.programacion().activa, 'siguiente');
  assert.equal(cat.detalle({ referencia: '9300' }).encontrado, false); // producto que ya no está en C12
  assert.equal(cat.estado().campana.hasta, '2026-12-04');

  r.f = '2026-12-05'; // C12 vencida: el catálogo no la presenta como vigente
  assert.equal(cat.estado().campana.estado, 'vencida');
  assert.match(cat.estado().aviso_campana, /terminó el 2026-12-04/);
});

test('el último día de C11 todavía es C11 y el primero de C12 ya es C12 (sin hueco ni solapamiento)', () => {
  const r = reloj('2026-11-06');
  const cat = programado(r);
  assert.equal(cat.estado().campana.estado, 'vigente');
  assert.equal(cat.estado().campana.nombre, 'C11 2026');
  r.f = '2026-11-07';
  assert.equal(cat.estado().campana.nombre, 'C12 2026');
});

test('sin campaña siguiente, o con una inválida, se comporta como el catálogo normal', () => {
  const r = reloj('2026-11-20');
  const base = crearCatalogo({ productos, campana: C11, hoy: r.hoy });
  for (const siguiente of [null, { productos: productosC12, campana: { campana: 'X' } }, { productos: productosC12, campana: { vigencia_desde: 'mañana' } }, { productos: productosC12, campana: null }]) {
    const cat = programado(r, siguiente);
    assert.deepEqual(cat.estado(), base.estado());
    assert.equal(cat.total, productos.length);
    assert.equal(cat.programacion().activa, 'actual');
    assert.equal(cat.programacion().siguiente, null);
  }
});

test('la interfaz del catálogo programado es la misma que la del catálogo normal', () => {
  const r = reloj('2026-10-27');
  const cat = programado(r);
  const base = crearCatalogo({ productos, campana: C11, hoy: r.hoy });
  assert.deepEqual(cat.buscar('labial'), base.buscar('labial'));
  assert.deepEqual(cat.detalle({ id: 'p670' }), base.detalle({ id: 'p670' }));
});

test('fechaValida rechaza fechas imposibles', () => {
  assert.equal(fechaValida('2026-11-07'), true);
  for (const f of ['2026-02-30', '2026-13-01', '2026-11-7', '07/11/2026', '', undefined, '2026-00-10']) assert.equal(fechaValida(f), false, String(f));
});

// ---- Script de carga ----
const SCRIPT = path.join(__dirname, '..', 'scripts', 'cargar-campana.js');
function entorno() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campana-'));
  const data = path.join(dir, 'data');
  fs.mkdirSync(data);
  const origen = path.join(dir, 'c12.json');
  fs.writeFileSync(origen, JSON.stringify({ version: 'c12', moneda: 'COP', productos: productosC12.map(p => ({ ...p, notas: 'interna' })) }));
  const correr = (args, hoy = '2026-10-30') => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, DATA_DIR: data, HOY: hoy } });
  const base = ['--origen', origen, '--campana', 'C12 2026', '--desde', '2026-11-07', '--hasta', '2026-12-04', '--esperados', String(productosC12.length)];
  return { dir, data, origen, correr, base };
}
const listar = d => fs.readdirSync(d).sort();

test('ensayo: valida y audita pero no escribe nada; no imprime nombres ni precios', () => {
  const { dir, data, correr, base } = entorno();
  const r = correr(base);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Campaña: C12 2026, del 2026-11-07 al 2026-12-04. Modo: programar./);
  assert.match(r.stdout, new RegExp(`Productos en el origen: ${productosC12.length}`));
  assert.match(r.stdout, /Auditoría/);
  assert.match(r.stdout, /ENSAYO: no se escribió nada/);
  assert.deepEqual(listar(data), []);
  for (const p of productosC12) assert.ok(!r.stdout.includes(p.nombre), p.nombre);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('programar con --aplicar: crea los archivos "siguiente" con permisos 600 y deja intacta la campaña actual', () => {
  const { dir, data, correr, base } = entorno();
  fs.writeFileSync(path.join(data, 'catalogo_lectura.json'), '{"productos":[{"id":"viejo","nombre":"V"}]}');
  fs.writeFileSync(path.join(data, 'campana.json'), JSON.stringify(C11));
  const antes = fs.readFileSync(path.join(data, 'catalogo_lectura.json'), 'utf8');
  const r = correr([...base, '--aplicar']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /LISTO\. Reinicia el asistente/);
  assert.deepEqual(listar(data), ['campana.json', 'campana_siguiente.json', 'catalogo_lectura.json', 'catalogo_lectura_siguiente.json']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(data, 'campana_siguiente.json'), 'utf8')), C12);
  const sig = JSON.parse(fs.readFileSync(path.join(data, 'catalogo_lectura_siguiente.json'), 'utf8'));
  assert.equal(sig.productos.length, productosC12.length);
  assert.ok(sig.productos.every(p => !('notas' in p)));
  assert.equal(fs.statSync(path.join(data, 'catalogo_lectura_siguiente.json')).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(path.join(data, 'catalogo_lectura.json'), 'utf8'), antes);
  assert.ok(!listar(data).some(f => f.endsWith('.tmp')));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('datos inválidos: se rechazan antes de escribir nada', () => {
  const { dir, data, origen, correr, base } = entorno();
  const con = (clave, valor) => { const c = [...base]; c[c.indexOf(clave) + 1] = valor; return c; };
  const casos = [
    [con('--desde', '2026-02-30'), /fechas deben ser reales/],
    [con('--hasta', '2026-11-01'), /no puede ser anterior/],
    [con('--desde', '2026-10-30'), /ya llegó/],
    [con('--esperados', '999'), /Se esperaban 999/],
    [con('--esperados', 'abc'), /mayor que cero/],
    [con('--campana', 'x'.repeat(41)), /demasiado largo/],
    [con('--origen', path.join(dir, 'no-existe.json')), /No se pudo leer el origen \(ENOENT\)/],
    [[...base, '--modo', 'raro'], /--modo debe ser/],
    [[...base, '--raro', 'x'], /Argumento no válido/],
    [base.slice(2), /Falta --origen/]
  ];
  for (const [args, patron] of casos) {
    const r = correr([...args, '--aplicar']);
    assert.equal(r.status, 1, args.join(' '));
    assert.match(r.stderr, patron);
  }
  fs.writeFileSync(origen, '{"productos":[{"nombre":"sin id"}]}');
  assert.match(correr([...con('--esperados', '1'), '--aplicar']).stderr, /sin id: 1/);
  assert.deepEqual(listar(data), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('reemplazar: guarda copia exacta de lo reemplazado y escribe la nueva campaña como actual', () => {
  const { dir, data, correr, base } = entorno();
  const viejo = '{"productos":[{"id":"viejo","nombre":"V"}]}';
  fs.writeFileSync(path.join(data, 'catalogo_lectura.json'), viejo);
  fs.writeFileSync(path.join(data, 'campana.json'), JSON.stringify(C11));
  const r = correr([...base, '--modo', 'reemplazar', '--desde', '2026-10-10', '--aplicar']);
  assert.equal(r.status, 0, r.stderr);
  const carpetas = fs.readdirSync(path.join(data, 'campanas-anteriores'));
  assert.equal(carpetas.length, 1);
  const copia = path.join(data, 'campanas-anteriores', carpetas[0]);
  assert.equal(fs.readFileSync(path.join(copia, 'catalogo_lectura.json'), 'utf8'), viejo);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(copia, 'campana.json'), 'utf8')), C11);
  assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'campana.json'), 'utf8')).campana, 'C12 2026');
  assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'catalogo_lectura.json'), 'utf8')).productos.length, productosC12.length);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('promover: ensayo sin cambios; con --aplicar respalda la actual y deja la programada como actual', () => {
  const { dir, data, correr, base } = entorno();
  fs.writeFileSync(path.join(data, 'catalogo_lectura.json'), '{"productos":[{"id":"viejo","nombre":"V"}]}');
  fs.writeFileSync(path.join(data, 'campana.json'), JSON.stringify(C11));
  assert.match(correr(['--promover']).stderr, /No hay una campaña programada/);
  assert.equal(correr([...base, '--aplicar']).status, 0);
  const antes = listar(data);
  const ensayo = correr(['--promover']);
  assert.match(ensayo.stdout, /Se promoverá la campaña programada "C12 2026"/);
  assert.match(ensayo.stdout, /ENSAYO/);
  assert.deepEqual(listar(data), antes);
  const r = correr(['--promover', '--aplicar'], '2026-11-08');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(listar(data), ['campana.json', 'campanas-anteriores', 'catalogo_lectura.json']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'campana.json'), 'utf8')).campana, 'C12 2026');
  const [carpeta] = fs.readdirSync(path.join(data, 'campanas-anteriores'));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(data, 'campanas-anteriores', carpeta, 'campana.json'), 'utf8')), C11);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---- El servidor real carga la campaña programada ----
function arrancarServidor(env, puerto) {
  return new Promise((resolve, reject) => {
    const hijo = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], { env: { ...process.env, ...env, PORT: String(puerto) } });
    let salida = '';
    const alRecibir = t => { salida += t; if (/ejecutándose en el puerto/.test(salida)) resolve({ hijo, salida: () => salida }); };
    hijo.stdout.on('data', alRecibir); hijo.stderr.on('data', alRecibir);
    hijo.on('error', reject);
    setTimeout(() => reject(new Error('el servidor no arrancó: ' + salida)), 8000);
  });
}
const pedir = (puerto, ruta) => new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port: puerto, path: ruta }, res => {
  let t = ''; res.on('data', c => { t += c; }); res.on('end', () => resolve(JSON.parse(t)));
}).on('error', reject));

test('el servidor arranca con la campaña programada: la futura queda esperando y la ya iniciada entra sola; una corrupta se ignora', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srv-camp-'));
  const escribir = (n, v) => fs.writeFileSync(path.join(dir, n), typeof v === 'string' ? v : JSON.stringify(v));
  escribir('lectura.json', { productos });
  escribir('campana.json', C11);
  escribir('usuarios.json', { usuarios: {} });
  escribir('lectura_sig.json', { productos: productosC12 });
  const base = { CATALOGO_LECTURA: path.join(dir, 'lectura.json'), CAMPANA: path.join(dir, 'campana.json'), USUARIOS: path.join(dir, 'usuarios.json'),
    CATALOGO_LECTURA_SIGUIENTE: path.join(dir, 'lectura_sig.json'), CAMPANA_SIGUIENTE: path.join(dir, 'campana_sig.json'), ANTHROPIC_API_KEY: '' };
  const casos = [
    [{ campana: 'C99 2099', vigencia_desde: '2099-01-01', vigencia_hasta: '2099-02-01' }, 'C11 2026', productos.length, /entra en vigor el 2099-01-01/],
    [{ campana: 'C00 2000', vigencia_desde: '2000-01-01', vigencia_hasta: '2099-02-01' }, 'C00 2000', productosC12.length, /Campaña siguiente programada: C00 2000/],
    ['{ esto no es json', 'C11 2026', productos.length, /AVISO: la campaña siguiente no es válida y se ignora/]
  ];
  let puerto = 3191;
  for (const [sig, nombreActivo, total, aviso] of casos) {
    escribir('campana_sig.json', sig);
    const { hijo, salida } = await arrancarServidor(base, puerto);
    try {
      const estado = await pedir(puerto, '/api/estado');
      assert.equal(estado.campana.nombre, nombreActivo);
      assert.equal(estado.productos, total);
      assert.match(salida(), aviso);
    } finally { hijo.kill(); }
    puerto++;
  }
  fs.rmSync(dir, { recursive: true, force: true });
});
