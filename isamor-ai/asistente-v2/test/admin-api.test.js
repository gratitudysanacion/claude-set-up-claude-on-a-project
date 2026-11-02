'use strict';
// API de administración de usuarios y cambio de clave, con el servidor real y el archivo usuarios.json real (en una carpeta temporal).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { crearServidor } = require('../src/server');
const { crearAuth, crearRegistroUsuario } = require('../src/auth');
const { crearGuardado, leerUsuarios } = require('../src/usuarios-archivo');
const { crearLimites } = require('../src/limites');
const { crearCatalogo } = require('../src/catalogo');
const { productos, campana } = require('./fixtures');

const CLAVE = 'clave-de-prueba-123';
let publicDir;
test.before(() => {
  publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-public-'));
  for (const f of ['index.html', 'app.js', 'styles.css']) fs.writeFileSync(path.join(publicDir, f), 'x');
});
test.after(() => fs.rmSync(publicDir, { recursive: true, force: true }));

async function conServidor(prueba, { atender } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-datos-'));
  const ruta = path.join(dir, 'usuarios.json');
  const reg = await crearRegistroUsuario(CLAVE);
  fs.writeFileSync(ruta, JSON.stringify({ nota: 'se conserva', usuarios: { jefa: { ...reg, modulos: ['sales', 'content'], rol: 'admin' }, ana: { ...reg, modulos: ['sales'] } } }), { mode: 0o644 });
  const { usuarios, resto } = leerUsuarios(ruta);
  const registros = [];
  const auth = crearAuth({ usuarios, guardar: crearGuardado(ruta, resto) });
  const servidor = crearServidor({
    auth, limites: crearLimites({ porMinuto: 50 }), catalogo: crearCatalogo({ productos, campana, hoy: () => '2026-10-27' }),
    responderes: { sales: atender || (async () => ({ respuesta: 'hola', advertencias: [], uso: {} })) }, publicDir, log: d => registros.push(d)
  });
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  const puerto = servidor.address().port;
  const llamar = ({ metodo = 'GET', ruta: r = '/', cuerpo, cookie, origen, ip = '10.0.0.1' }) => new Promise((resolve, reject) => {
    const datos = cuerpo === undefined ? null : JSON.stringify(cuerpo);
    const h = { 'x-real-ip': ip };
    if (cookie) h.Cookie = cookie;
    if (origen) h.Origin = origen;
    if (datos !== null) { h['Content-Type'] = 'application/json'; h['Content-Length'] = Buffer.byteLength(datos); }
    const req = http.request({ host: '127.0.0.1', port: puerto, method: metodo, path: r, headers: h }, res => {
      const t = []; res.on('data', c => t.push(c));
      res.on('end', () => { const texto = Buffer.concat(t).toString(); let json = null; try { json = JSON.parse(texto); } catch { /* no JSON */ } resolve({ estado: res.statusCode, json, texto, cabeceras: res.headers }); });
    });
    req.on('error', reject); if (datos !== null) req.write(datos); req.end();
  });
  const entrar = async (usuario, clave = CLAVE, ip) => {
    const r = await llamar({ metodo: 'POST', ruta: '/api/login', cuerpo: { usuario, clave }, ip });
    return { estado: r.estado, cookie: r.cabeceras['set-cookie'] ? r.cabeceras['set-cookie'][0].split(';')[0] : null };
  };
  try { await prueba({ llamar, entrar, registros, ruta, dir }); } finally { await new Promise(r => servidor.close(r)); fs.rmSync(dir, { recursive: true, force: true }); }
}

test('admin API: exige sesión y rol de administradora; las escrituras desde otro origen se rechazan', async () => {
  await conServidor(async ({ llamar, entrar }) => {
    assert.equal((await llamar({ ruta: '/api/admin/usuarios' })).estado, 401);
    assert.equal((await llamar({ metodo: 'POST', ruta: '/api/cuenta/clave', cuerpo: {} })).estado, 401);
    const ana = (await entrar('ana')).cookie;
    for (const [metodo, ruta, cuerpo] of [['GET', '/api/admin/usuarios'], ['POST', '/api/admin/usuarios', { usuario: 'x'.repeat(5), clave: 'temporal-12345', modulos: ['sales'] }],
      ['PUT', '/api/admin/usuarios/jefa', { activo: false }], ['POST', '/api/admin/usuarios/jefa/clave', { clave: 'temporal-12345' }]]) {
      const r = await llamar({ metodo, ruta, cuerpo, cookie: ana });
      assert.equal(r.estado, 403, `${metodo} ${ruta}`);
      assert.equal(r.json.codigo, 'sin_permiso');
    }
    const jefa = (await entrar('jefa')).cookie;
    for (const metodo of ['POST', 'PUT']) {
      const r = await llamar({ metodo, ruta: metodo === 'POST' ? '/api/admin/usuarios' : '/api/admin/usuarios/ana', cuerpo: { activo: false }, cookie: jefa, origen: 'https://malo.example' });
      assert.equal(r.estado, 403, metodo);
    }
    assert.equal((await llamar({ ruta: '/api/admin/inexistente', cookie: jefa })).estado, 404);
  });
});

test('admin API: la administradora crea, lista, cambia módulos, restablece e inactiva; todo queda en el archivo con permisos 600', async () => {
  await conServidor(async ({ llamar, entrar, ruta, registros }) => {
    const jefa = (await entrar('jefa')).cookie;
    const lista = await llamar({ ruta: '/api/admin/usuarios', cookie: jefa });
    assert.equal(lista.estado, 200);
    assert.deepEqual(lista.json.usuarios.map(u => [u.usuario, u.rol, u.activo]), [['ana', 'usuaria', true], ['jefa', 'admin', true]]);
    assert.ok(!/"hash"|"sal"|"alg"|scrypt/.test(lista.texto));

    const creado = await llamar({ metodo: 'POST', ruta: '/api/admin/usuarios', cuerpo: { usuario: 'Bea', clave: 'temporal-12345', modulos: ['sales', 'content'] }, cookie: jefa });
    assert.equal(creado.estado, 201);
    assert.deepEqual([creado.json.usuario, creado.json.cambiar_clave, creado.json.activo], ['bea', true, true]);
    assert.equal((await llamar({ metodo: 'POST', ruta: '/api/admin/usuarios', cuerpo: { usuario: 'bea', clave: 'temporal-12345', modulos: ['sales'] }, cookie: jefa })).estado, 409);
    const mal = await llamar({ metodo: 'POST', ruta: '/api/admin/usuarios', cuerpo: { usuario: 'carla', clave: 'corta', modulos: ['sales'] }, cookie: jefa });
    assert.equal(mal.estado, 400);
    assert.equal(mal.json.codigo, 'clave_debil');

    assert.equal((await llamar({ metodo: 'PUT', ruta: '/api/admin/usuarios/bea', cuerpo: { modulos: ['content'] }, cookie: jefa })).json.modulos[0], 'content');
    assert.equal((await llamar({ metodo: 'PUT', ruta: '/api/admin/usuarios/nadie', cuerpo: { activo: false }, cookie: jefa })).estado, 404);
    assert.equal((await llamar({ metodo: 'PUT', ruta: '/api/admin/usuarios/jefa', cuerpo: { activo: false }, cookie: jefa })).json.codigo, 'no_puedes_inactivarte');
    assert.equal((await llamar({ metodo: 'POST', ruta: '/api/admin/usuarios/ana/clave', cuerpo: { clave: 'otra-temporal-111' }, cookie: jefa })).json.cambiar_clave, true);
    assert.equal((await llamar({ metodo: 'POST', ruta: '/api/admin/usuarios/jefa/clave', cuerpo: { clave: 'otra-temporal-111' }, cookie: jefa })).json.codigo, 'es_tu_cuenta');

    // persistencia real
    assert.equal(fs.statSync(ruta).mode & 0o777, 0o600);
    assert.equal(fs.statSync(`${ruta}.anterior`).mode & 0o777, 0o600);
    const archivo = JSON.parse(fs.readFileSync(ruta, 'utf8'));
    assert.equal(archivo.nota, 'se conserva');
    assert.ok(archivo.usuarios.bea && archivo.usuarios.bea.cambiar_clave === true);
    assert.ok(!fs.readFileSync(ruta, 'utf8').includes('temporal-12345'));
    assert.ok(!fs.existsSync(`${ruta}.tmp`));
    // auditoría sin claves
    const auditoria = registros.filter(r => r.evento === 'admin_usuarios');
    assert.deepEqual(auditoria.map(a => a.accion), ['crear', 'actualizar', 'restablecer_clave']);
    assert.ok(auditoria.every(a => a.actor === 'jefa'));
    assert.ok(!JSON.stringify(registros).match(/temporal-12345|otra-temporal|clave-de-prueba/));
  });
});

test('clave temporal: hasta cambiarla solo se puede cambiarla; después todo vuelve a funcionar', async () => {
  await conServidor(async ({ llamar, entrar, ruta }) => {
    const jefa = (await entrar('jefa')).cookie;
    await llamar({ metodo: 'POST', ruta: '/api/admin/usuarios', cuerpo: { usuario: 'bea', clave: 'temporal-12345', modulos: ['sales'] }, cookie: jefa });
    const bea = (await entrar('bea', 'temporal-12345')).cookie;
    const sesion = (await llamar({ ruta: '/api/sesion', cookie: bea })).json;
    assert.deepEqual([sesion.autenticada, sesion.cambiar_clave, sesion.admin], [true, true, false]);
    const chat = await llamar({ metodo: 'POST', ruta: '/api/chat', cuerpo: { mensaje: 'hola' }, cookie: bea });
    assert.equal(chat.estado, 403);
    assert.equal(chat.json.codigo, 'cambiar_clave');
    assert.equal((await llamar({ ruta: '/api/gestor/meta', cookie: bea })).json.codigo, 'cambiar_clave');
    // una administradora con clave temporal tampoco puede administrar hasta cambiarla
    assert.equal((await llamar({ metodo: 'POST', ruta: '/api/admin/usuarios', cuerpo: { usuario: 'beto', clave: 'temporal-12345', modulos: ['sales'], rol: 'admin' }, cookie: jefa })).estado, 201);
    const beto = (await entrar('beto', 'temporal-12345')).cookie;
    const sinPermisoAun = await llamar({ ruta: '/api/admin/usuarios', cookie: beto });
    assert.deepEqual([sinPermisoAun.estado, sinPermisoAun.json.codigo], [403, 'cambiar_clave']);

    assert.equal((await llamar({ metodo: 'POST', ruta: '/api/cuenta/clave', cuerpo: { actual: 'equivocada-1234', nueva: 'definitiva-67890' }, cookie: bea })).json.codigo, 'clave_actual_incorrecta');
    assert.equal((await llamar({ metodo: 'POST', ruta: '/api/cuenta/clave', cuerpo: { actual: 'temporal-12345', nueva: 'corta' }, cookie: bea })).json.codigo, 'clave_debil');
    assert.equal((await llamar({ metodo: 'POST', ruta: '/api/cuenta/clave', cuerpo: { actual: 'temporal-12345', nueva: 'definitiva-67890' }, cookie: bea, origen: 'https://malo.example' })).estado, 403);
    const ok = await llamar({ metodo: 'POST', ruta: '/api/cuenta/clave', cuerpo: { actual: 'temporal-12345', nueva: 'definitiva-67890' }, cookie: bea });
    assert.equal(ok.estado, 200);
    assert.equal((await llamar({ ruta: '/api/sesion', cookie: bea })).json.cambiar_clave, false);
    assert.equal((await llamar({ metodo: 'POST', ruta: '/api/chat', cuerpo: { mensaje: 'hola' }, cookie: bea })).estado, 200);
    assert.equal((await entrar('bea', 'temporal-12345')).estado, 401);
    assert.equal((await entrar('bea', 'definitiva-67890')).estado, 200);
    assert.ok(!fs.readFileSync(ruta, 'utf8').includes('definitiva-67890'));
  });
});

test('inactivar: no entra (mensaje idéntico al de una clave mala), su sesión se cierra y la administradora lo reactiva', async () => {
  await conServidor(async ({ llamar, entrar }) => {
    const jefa = (await entrar('jefa')).cookie;
    const ana = (await entrar('ana')).cookie;
    assert.equal((await llamar({ ruta: '/api/sesion', cookie: ana })).json.autenticada, true);
    assert.equal((await llamar({ metodo: 'PUT', ruta: '/api/admin/usuarios/ana', cuerpo: { activo: false }, cookie: jefa })).json.activo, false);
    assert.equal((await llamar({ ruta: '/api/sesion', cookie: ana })).json.autenticada, false);
    const inactivo = await llamar({ metodo: 'POST', ruta: '/api/login', cuerpo: { usuario: 'ana', clave: CLAVE }, ip: '7.7.7.7' });
    const malaClave = await llamar({ metodo: 'POST', ruta: '/api/login', cuerpo: { usuario: 'ana', clave: 'mala-clave-0000' }, ip: '8.8.8.8' });
    assert.deepEqual([inactivo.estado, inactivo.json], [malaClave.estado, malaClave.json]);
    assert.equal((await llamar({ ruta: '/api/admin/usuarios', cookie: jefa })).json.usuarios.find(u => u.usuario === 'ana').activo, false);
    await llamar({ metodo: 'PUT', ruta: '/api/admin/usuarios/ana', cuerpo: { activo: true }, cookie: jefa });
    assert.equal((await entrar('ana')).estado, 200);
  });
});

test('cambiar la propia clave comparte el límite de intentos del inicio de sesión', async () => {
  await conServidor(async ({ llamar, entrar }) => {
    const ana = (await entrar('ana')).cookie;
    for (let i = 0; i < 5; i++) assert.equal((await llamar({ metodo: 'POST', ruta: '/api/cuenta/clave', cuerpo: { actual: 'mala-clave-0000', nueva: 'definitiva-67890' }, cookie: ana, ip: '5.5.5.5' })).json.codigo, 'clave_actual_incorrecta');
    const bloqueado = await llamar({ metodo: 'POST', ruta: '/api/cuenta/clave', cuerpo: { actual: CLAVE, nueva: 'definitiva-67890' }, cookie: ana, ip: '5.5.5.5' });
    assert.equal(bloqueado.estado, 429);
    assert.ok(Number(bloqueado.cabeceras['retry-after']) > 0);
  });
});
