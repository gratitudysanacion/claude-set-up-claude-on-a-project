'use strict';
// Módulos y permisos por usuario: cada módulo tiene su agente y cada usuaria solo entra a los que se le habilitaron.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { crearServidor } = require('../src/server');
const { crearAuth, crearRegistroUsuario, MODULOS_VALIDOS } = require('../src/auth');
const { crearLimites } = require('../src/limites');
const { crearCatalogo } = require('../src/catalogo');
const { productos, campana } = require('./fixtures');

const CLAVE = 'clave-de-prueba-123';
let registro;
let publicDir;
test.before(async () => {
  registro = await crearRegistroUsuario(CLAVE);
  publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modulos-public-'));
  for (const f of ['index.html', 'app.js', 'styles.css']) fs.writeFileSync(path.join(publicDir, f), 'x');
});
test.after(() => fs.rmSync(publicDir, { recursive: true, force: true }));

async function conServidor({ usuarios, responderes, responder = null, porMinuto = 50 }, prueba) {
  const reloj = { t: Date.UTC(2026, 9, 27, 15, 0, 0) };
  const ahora = () => reloj.t;
  const registros = [];
  const servidor = crearServidor({
    auth: crearAuth({ usuarios, ahora }), limites: crearLimites({ ahora, porMinuto }),
    catalogo: crearCatalogo({ productos, campana, hoy: () => '2026-10-27' }),
    responder, responderes, publicDir, log: d => registros.push(d), ahora
  });
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  const puerto = servidor.address().port;
  const llamar = ({ metodo = 'GET', ruta = '/', cuerpo, cookie }) => new Promise((resolve, reject) => {
    const datos = cuerpo === undefined ? null : JSON.stringify(cuerpo);
    const h = { 'x-real-ip': '10.0.0.1' };
    if (cookie) h.Cookie = cookie;
    if (datos !== null) { h['Content-Type'] = 'application/json'; h['Content-Length'] = Buffer.byteLength(datos); }
    const req = http.request({ host: '127.0.0.1', port: puerto, method: metodo, path: ruta, headers: h }, res => {
      const trozos = [];
      res.on('data', c => trozos.push(c));
      res.on('end', () => { const texto = Buffer.concat(trozos).toString(); let json = null; try { json = JSON.parse(texto); } catch { /* no JSON */ } resolve({ estado: res.statusCode, cabeceras: res.headers, json }); });
    });
    req.on('error', reject);
    if (datos !== null) req.write(datos);
    req.end();
  });
  const entrar = async usuario => {
    const r = await llamar({ metodo: 'POST', ruta: '/api/login', cuerpo: { usuario, clave: CLAVE } });
    assert.equal(r.estado, 200);
    return r.cabeceras['set-cookie'][0].split(';')[0];
  };
  try { await prueba({ llamar, entrar, registros }); } finally { await new Promise(r => servidor.close(r)); }
}

const espia = nombre => { const llamadas = []; const fn = async args => { llamadas.push(args); return { respuesta: `de ${nombre}`, advertencias: [] }; }; fn.llamadas = llamadas; return fn; };
test('la sesión informa los módulos habilitados; sin lista solo el comercial, y se filtran duplicados e inválidos', async () => {
  const u = { completa: { ...registro, modulos: ['sales', 'content', 'beauty'] }, basica: { ...registro }, duplicados: { ...registro, modulos: ['content', 'content', 'inexistente'] },
    vacia: { ...registro, modulos: [] } };
  await conServidor({ usuarios: u, responderes: {} }, async ({ llamar, entrar }) => {
    assert.deepEqual((await llamar({ ruta: '/api/sesion' })).json.modulos, []);
    for (const [nombre, esperado] of [['completa', ['sales', 'content', 'beauty']], ['basica', ['sales']], ['duplicados', ['content']], ['vacia', ['sales']]]) {
      assert.deepEqual((await llamar({ ruta: '/api/sesion', cookie: await entrar(nombre) })).json.modulos, esperado, nombre);
    }
  });
});

test('cada módulo se atiende con su propio agente; sin módulo indicado se usa el comercial', async () => {
  const sales = espia('ventas'); const content = espia('contenido');
  const u = { completa: { ...registro, modulos: ['sales', 'content'] } };
  await conServidor({ usuarios: u, responderes: { sales, content } }, async ({ llamar, entrar }) => {
    const cookie = await entrar('completa');
    assert.equal((await llamar({ metodo: 'POST', ruta: '/api/chat', cuerpo: { mensaje: 'a' }, cookie })).json.respuesta, 'de ventas');
    assert.equal((await llamar({ metodo: 'POST', ruta: '/api/chat', cuerpo: { mensaje: 'b', modulo: 'sales' }, cookie })).json.respuesta, 'de ventas');
    assert.equal((await llamar({ metodo: 'POST', ruta: '/api/chat', cuerpo: { mensaje: 'c', modulo: 'content' }, cookie })).json.respuesta, 'de contenido');
    assert.equal(sales.llamadas.length, 2);
    assert.equal(content.llamadas.length, 1);
    assert.equal(content.llamadas[0].modulo, 'content');
    assert.equal(content.llamadas[0].usuario, 'completa');
  });
});

test('un módulo no habilitado devuelve 403 sin gastar el límite de uso ni llamar al agente', async () => {
  const content = espia('contenido'); const sales = espia('ventas');
  const u = { basica: { ...registro } };
  await conServidor({ usuarios: u, responderes: { sales, content }, porMinuto: 1 }, async ({ llamar, entrar }) => {
    const cookie = await entrar('basica');
    const r = await llamar({ metodo: 'POST', ruta: '/api/chat', cuerpo: { mensaje: 'x', modulo: 'content' }, cookie });
    assert.equal(r.estado, 403);
    assert.equal(r.json.codigo, 'modulo_no_permitido');
    assert.equal(content.llamadas.length, 0);
    // El único mensaje por minuto sigue disponible para el módulo permitido:
    assert.equal((await llamar({ metodo: 'POST', ruta: '/api/chat', cuerpo: { mensaje: 'x' }, cookie })).estado, 200);
  });
});

test('módulo inválido -> 400; módulo habilitado pero sin agente -> 503', async () => {
  const u = { completa: { ...registro, modulos: ['sales', 'beauty'] } };
  await conServidor({ usuarios: u, responderes: { sales: espia('v') } }, async ({ llamar, entrar }) => {
    const cookie = await entrar('completa');
    for (const modulo of ['hacker', 5, null, ['sales'], '__proto__', 'constructor']) {
      assert.equal((await llamar({ metodo: 'POST', ruta: '/api/chat', cuerpo: { mensaje: 'x', modulo }, cookie })).estado, 400, JSON.stringify(modulo));
    }
    const r = await llamar({ metodo: 'POST', ruta: '/api/chat', cuerpo: { mensaje: 'x', modulo: 'beauty' }, cookie });
    assert.equal(r.estado, 503);
    assert.equal(r.json.codigo, 'ia_no_disponible');
  });
});

test('el responder único anterior sigue atendiendo el módulo comercial (compatibilidad)', async () => {
  const unico = espia('unico');
  await conServidor({ usuarios: { basica: { ...registro } }, responder: unico, responderes: {} }, async ({ llamar, entrar }) => {
    const r = await llamar({ metodo: 'POST', ruta: '/api/chat', cuerpo: { mensaje: 'x' }, cookie: await entrar('basica') });
    assert.equal(r.json.respuesta, 'de unico');
    assert.equal((await llamar({ ruta: '/health' })).json.ai, 'connected');
  });
});

test('/health indica IA conectada si algún módulo tiene agente, y desconectada si ninguno', async () => {
  await conServidor({ usuarios: {}, responderes: { content: espia('c') } }, async ({ llamar }) => assert.equal((await llamar({ ruta: '/health' })).json.ai, 'connected'));
  await conServidor({ usuarios: {}, responderes: { content: null, sales: null } }, async ({ llamar }) => assert.equal((await llamar({ ruta: '/health' })).json.ai, 'not_connected'));
});

test('el registro de uso incluye el módulo y nunca el texto del mensaje', async () => {
  const agente = async () => ({ respuesta: 'RESPUESTA_SECRETA', advertencias: [], uso: { entrada: 1, salida: 2, vueltas: 1 } });
  await conServidor({ usuarios: { completa: { ...registro, modulos: ['content'] } }, responderes: { content: agente } }, async ({ llamar, entrar, registros }) => {
    await llamar({ metodo: 'POST', ruta: '/api/chat', cuerpo: { mensaje: 'MENSAJE_PRIVADO', modulo: 'content' }, cookie: await entrar('completa') });
    const chat = registros.find(r => r.evento === 'chat');
    assert.equal(chat.modulo, 'content');
    assert.ok(!JSON.stringify(registros).includes('MENSAJE_PRIVADO') && !JSON.stringify(registros).includes('RESPUESTA_SECRETA'));
  });
});

test('auth.modulosDe no se deja engañar por nombres especiales', () => {
  const auth = crearAuth({ usuarios: { ana: { ...registro, modulos: ['manager'] } } });
  assert.deepEqual(auth.modulosDe('ana'), ['manager']);
  for (const nombre of ['__proto__', 'constructor', 'toString', 'nadie']) assert.deepEqual(auth.modulosDe(nombre), ['sales'], nombre);
  assert.deepEqual(MODULOS_VALIDOS, ['sales', 'content', 'beauty', 'manager']);
});

// ---- Scripts ----
const SCRIPT = path.join(__dirname, '..', 'scripts', 'asignar-modulos.js');
test('asignar-modulos: cambia solo los módulos, conserva la clave y rechaza datos inválidos', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asignar-'));
  const archivo = path.join(dir, 'usuarios.json');
  fs.writeFileSync(archivo, JSON.stringify({ usuarios: { ana: { ...registro } } }), { mode: 0o600 });
  const env = { ...process.env, USUARIOS: archivo };
  const correr = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env });
  const ok = correr('ANA', 'sales, content ,content');
  assert.equal(ok.status, 0, ok.stderr);
  const datos = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  assert.deepEqual(datos.usuarios.ana.modulos, ['sales', 'content']);
  assert.equal(datos.usuarios.ana.hash, registro.hash);
  assert.equal(fs.statSync(archivo).mode & 0o777, 0o600);
  assert.notEqual(correr('ana', 'sales,hacker').status, 0);
  assert.match(correr('ana', 'sales,hacker').stderr, /hacker/);
  assert.match(correr('nadie', 'sales').stderr, /no existe/);
  assert.match(correr().stderr, /Uso:/);
  assert.deepEqual(JSON.parse(fs.readFileSync(archivo, 'utf8')).usuarios.ana.modulos, ['sales', 'content']);
  fs.rmSync(dir, { recursive: true, force: true });
});
