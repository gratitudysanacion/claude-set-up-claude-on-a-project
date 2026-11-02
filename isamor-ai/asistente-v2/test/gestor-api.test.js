'use strict';
// API del Gestor de ventas: sesión, permiso por módulo, aislamiento entre usuarias y acceso del administrador.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { crearServidor } = require('../src/server');
const { crearAuth, crearRegistroUsuario } = require('../src/auth');
const { crearLimites } = require('../src/limites');
const { crearCatalogo } = require('../src/catalogo');
const { crearCifrado, generarLlaveHex } = require('../src/cifrado');
const { crearGestor, abrirBase, sqliteDisponible, ETAPAS, ETAPAS_ROTULO, TEXTO_CONSENTIMIENTO, CONSENTIMIENTO_VERSION } = require('../src/gestor');
const { productos, campana } = require('./fixtures');

const conSqlite = { skip: sqliteDisponible() ? false : 'node:sqlite no disponible en esta versión de Node' };
const CLAVE = 'clave-de-prueba-123';
let registro;
let publicDir;
test.before(async () => {
  registro = await crearRegistroUsuario(CLAVE);
  publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gestor-public-'));
  for (const f of ['index.html', 'app.js', 'styles.css']) fs.writeFileSync(path.join(publicDir, f), 'x');
});
test.after(() => fs.rmSync(publicDir, { recursive: true, force: true }));

const USUARIOS = () => ({
  ana: { ...registro, modulos: ['sales', 'manager'] },
  bea: { ...registro, modulos: ['manager'] },
  sinmodulo: { ...registro, modulos: ['sales'] },
  jefa: { ...registro, modulos: ['sales', 'manager'], rol: 'admin' }
});

async function conServidor({ conGestor = true }, prueba) {
  const ahora = () => Date.UTC(2026, 10, 2, 15, 0, 0);
  const gestor = conGestor ? crearGestor({ db: abrirBase(':memory:'), cifrado: crearCifrado(generarLlaveHex()), ahora }) : null;
  const gestorMeta = { etapas: ETAPAS.map(e => ({ id: e, rotulo: ETAPAS_ROTULO[e] })), consentimiento: { version: CONSENTIMIENTO_VERSION, texto: TEXTO_CONSENTIMIENTO } };
  const registros = [];
  const servidor = crearServidor({
    auth: crearAuth({ usuarios: USUARIOS(), ahora }), limites: crearLimites({ ahora, porMinuto: 50 }),
    catalogo: crearCatalogo({ productos, campana, hoy: () => '2026-11-02' }),
    responderes: {}, gestor, gestorMeta, publicDir, log: d => registros.push(d), ahora
  });
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  const puerto = servidor.address().port;
  const llamar = ({ metodo = 'GET', ruta = '/', cuerpo, cookie, origen }) => new Promise((resolve, reject) => {
    const datos = cuerpo === undefined ? null : JSON.stringify(cuerpo);
    const h = { 'x-real-ip': '10.0.0.1' };
    if (cookie) h.Cookie = cookie;
    if (origen) h.Origin = origen;
    if (datos !== null) { h['Content-Type'] = 'application/json'; h['Content-Length'] = Buffer.byteLength(datos); }
    const req = http.request({ host: '127.0.0.1', port: puerto, method: metodo, path: ruta, headers: h }, res => {
      const trozos = [];
      res.on('data', c => trozos.push(c));
      res.on('end', () => { const texto = Buffer.concat(trozos).toString(); let json = null; try { json = JSON.parse(texto); } catch { /* no JSON */ } resolve({ estado: res.statusCode, json, texto }); });
    });
    req.on('error', reject);
    if (datos !== null) req.write(datos);
    req.end();
  });
  const entrar = async usuario => {
    const r = await new Promise((resolve, reject) => {
      const datos = JSON.stringify({ usuario, clave: CLAVE });
      const req = http.request({ host: '127.0.0.1', port: puerto, method: 'POST', path: '/api/login', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(datos), 'x-real-ip': '10.0.0.1' } },
        res => { res.resume(); res.on('end', () => resolve(res)); });
      req.on('error', reject); req.write(datos); req.end();
    });
    assert.equal(r.statusCode, 200);
    return r.headers['set-cookie'][0].split(';')[0];
  };
  try { await prueba({ llamar, entrar, registros }); } finally { await new Promise(r => servidor.close(r)); }
}

const ficha = (extra = {}) => ({ nombre: 'María Gómez', telefono: '300 123 4567', cedula: '1020304050', direccion: 'Calle 45 #12-34', notas: 'Le gusta el Zentro', consentimiento: true, ...extra });

test('gestor API: sin sesión 401; sin el módulo habilitado 403; sin gestor configurado 503', conSqlite, async () => {
  await conServidor({}, async ({ llamar, entrar }) => {
    assert.equal((await llamar({ ruta: '/api/gestor/clientas' })).estado, 401);
    const r = await llamar({ ruta: '/api/gestor/clientas', cookie: await entrar('sinmodulo') });
    assert.equal(r.estado, 403);
    assert.equal(r.json.codigo, 'modulo_no_permitido');
  });
  await conServidor({ conGestor: false }, async ({ llamar, entrar }) => {
    const r = await llamar({ ruta: '/api/gestor/clientas', cookie: await entrar('ana') });
    assert.equal(r.estado, 503);
    assert.equal(r.json.codigo, 'gestor_no_disponible');
  });
});

test('gestor API: meta con etapas y texto de consentimiento', conSqlite, async () => {
  await conServidor({}, async ({ llamar, entrar }) => {
    const r = await llamar({ ruta: '/api/gestor/meta', cookie: await entrar('ana') });
    assert.equal(r.estado, 200);
    assert.equal(r.json.etapas.length, 7);
    assert.match(r.json.consentimiento.texto, /exterior/);
  });
});

test('gestor API: ciclo completo (crear, listar, leer, editar, recordatorio, exportar, borrar)', conSqlite, async () => {
  await conServidor({}, async ({ llamar, entrar }) => {
    const cookie = await entrar('ana');
    const c = await llamar({ metodo: 'POST', ruta: '/api/gestor/clientas', cuerpo: ficha(), cookie });
    assert.equal(c.estado, 201);
    const id = c.json.id;
    const lista = await llamar({ ruta: '/api/gestor/clientas?q=maria', cookie });
    assert.equal(lista.json.total, 1);
    assert.equal(lista.json.clientas[0].telefono_ult4, '4567');
    assert.ok(!lista.texto.includes('3001234567'));
    assert.equal((await llamar({ ruta: `/api/gestor/clientas/${id}`, cookie })).json.cedula, '1020304050');
    const e = await llamar({ metodo: 'PUT', ruta: `/api/gestor/clientas/${id}`, cuerpo: { etapa: 'interesada', notas: 'Quiere el set' }, cookie });
    assert.equal(e.estado, 200);
    assert.equal(e.json.etapa, 'interesada');
    const r = await llamar({ metodo: 'POST', ruta: `/api/gestor/clientas/${id}/recordatorios`, cuerpo: { fecha: '2026-11-02', texto: 'Llamar hoy' }, cookie });
    assert.equal(r.estado, 201);
    assert.equal((await llamar({ ruta: '/api/gestor/recordatorios?estado=hoy', cookie })).json.recordatorios.length, 1);
    assert.equal((await llamar({ metodo: 'POST', ruta: `/api/gestor/recordatorios/${r.json.id}/completar`, cuerpo: { hecho: true }, cookie })).estado, 200);
    assert.equal((await llamar({ ruta: '/api/gestor/recordatorios?estado=hoy', cookie })).json.recordatorios.length, 0);
    assert.equal((await llamar({ ruta: '/api/gestor/indicadores', cookie })).json.por_etapa.interesada, 1);
    const x = await llamar({ ruta: `/api/gestor/clientas/${id}/exportar`, cookie });
    assert.equal(x.json.telefono, '3001234567');
    assert.equal((await llamar({ metodo: 'DELETE', ruta: `/api/gestor/clientas/${id}`, cookie })).estado, 200);
    assert.equal((await llamar({ ruta: `/api/gestor/clientas/${id}`, cookie })).estado, 404);
  });
});

test('gestor API: validaciones devuelven 400 y consentimiento obligatorio', conSqlite, async () => {
  await conServidor({}, async ({ llamar, entrar }) => {
    const cookie = await entrar('ana');
    const sin = await llamar({ metodo: 'POST', ruta: '/api/gestor/clientas', cuerpo: ficha({ consentimiento: false }), cookie });
    assert.equal(sin.estado, 400);
    assert.equal(sin.json.codigo, 'consentimiento_requerido');
    assert.equal((await llamar({ metodo: 'POST', ruta: '/api/gestor/clientas', cuerpo: ficha({ telefono: '1' }), cookie })).json.codigo, 'telefono_invalido');
    assert.equal((await llamar({ ruta: '/api/gestor/clientas?etapa=vip', cookie })).estado, 400);
    assert.equal((await llamar({ ruta: '/api/gestor/inexistente', cookie })).estado, 404);
    assert.equal((await llamar({ metodo: 'POST', ruta: '/api/gestor/clientas', cuerpo: [], cookie })).estado, 400);
  });
});

test('gestor API: aislamiento entre usuarias por HTTP', conSqlite, async () => {
  await conServidor({}, async ({ llamar, entrar }) => {
    const cookieAna = await entrar('ana');
    const cookieBea = await entrar('bea');
    const id = (await llamar({ metodo: 'POST', ruta: '/api/gestor/clientas', cuerpo: ficha(), cookie: cookieAna })).json.id;
    assert.equal((await llamar({ ruta: '/api/gestor/clientas', cookie: cookieBea })).json.total, 0);
    for (const [metodo, ruta, cuerpo] of [['GET', `/api/gestor/clientas/${id}`], ['PUT', `/api/gestor/clientas/${id}`, { nombre: 'X' }],
      ['DELETE', `/api/gestor/clientas/${id}`], ['GET', `/api/gestor/clientas/${id}/exportar`],
      ['POST', `/api/gestor/clientas/${id}/recordatorios`, { fecha: '2026-11-05', texto: 'x' }]]) {
      const r = await llamar({ metodo, ruta, cuerpo, cookie: cookieBea });
      assert.equal(r.estado, 404, `${metodo} ${ruta}`);
      assert.ok(!r.texto.includes('3001234567'));
    }
    // pedir los datos de otra con ?duena= sin ser administradora
    assert.equal((await llamar({ ruta: '/api/gestor/clientas?duena=ana', cookie: cookieBea })).estado, 403);
    assert.equal((await llamar({ ruta: `/api/gestor/clientas/${id}?duena=ana`, cookie: cookieBea })).estado, 403);
    assert.equal((await llamar({ ruta: '/api/gestor/accesos', cookie: cookieBea })).estado, 403);
    assert.equal((await llamar({ ruta: `/api/gestor/clientas/${id}`, cookie: cookieAna })).json.nombre, 'María Gómez');
  });
});

test('gestor API: la administradora lee las de otra (queda registrado) y no las modifica', conSqlite, async () => {
  await conServidor({}, async ({ llamar, entrar }) => {
    const cookieAna = await entrar('ana');
    const cookieJefa = await entrar('jefa');
    const id = (await llamar({ metodo: 'POST', ruta: '/api/gestor/clientas', cuerpo: ficha(), cookie: cookieAna })).json.id;
    assert.equal((await llamar({ ruta: '/api/gestor/clientas?duena=ana', cookie: cookieJefa })).json.total, 1);
    assert.equal((await llamar({ ruta: `/api/gestor/clientas/${id}?duena=ana`, cookie: cookieJefa })).json.telefono, '3001234567');
    assert.equal((await llamar({ metodo: 'PUT', ruta: `/api/gestor/clientas/${id}`, cuerpo: { nombre: 'X' }, cookie: cookieJefa })).estado, 404);
    assert.equal((await llamar({ metodo: 'DELETE', ruta: `/api/gestor/clientas/${id}`, cookie: cookieJefa })).estado, 404);
    const accesos = (await llamar({ ruta: '/api/gestor/accesos', cookie: cookieJefa })).json.accesos;
    assert.deepEqual(accesos.map(a => a.accion).sort(), ['listar', 'obtener']);
    assert.ok(accesos.every(a => a.actor === 'jefa' && a.duena === 'ana'));
    assert.equal((await llamar({ ruta: `/api/gestor/clientas/${id}`, cookie: cookieAna })).json.nombre, 'María Gómez');
  });
});

test('gestor API: la sesión informa si es administradora y solo ella lista las usuarias del Gestor', conSqlite, async () => {
  await conServidor({}, async ({ llamar, entrar }) => {
    const cookieAna = await entrar('ana');
    const cookieJefa = await entrar('jefa');
    assert.equal((await llamar({ ruta: '/api/sesion' })).json.admin, false);
    assert.equal((await llamar({ ruta: '/api/sesion', cookie: cookieAna })).json.admin, false);
    assert.equal((await llamar({ ruta: '/api/sesion', cookie: cookieJefa })).json.admin, true);
    assert.equal((await llamar({ ruta: '/api/gestor/usuarias', cookie: cookieAna })).estado, 403);
    const r = await llamar({ ruta: '/api/gestor/usuarias', cookie: cookieJefa });
    assert.equal(r.estado, 200);
    assert.deepEqual(r.json.usuarias, ['ana', 'bea']); // solo las que tienen el módulo y sin ella misma
    assert.ok(!r.texto.includes(registro.hash));
  });
});

test('gestor API: escrituras desde otro origen se rechazan (CSRF) y los errores internos no filtran datos', conSqlite, async () => {
  await conServidor({}, async ({ llamar, entrar, registros }) => {
    const cookie = await entrar('ana');
    for (const metodo of ['POST', 'PUT', 'DELETE']) {
      const r = await llamar({ metodo, ruta: '/api/gestor/clientas', cuerpo: ficha(), cookie, origen: 'https://malo.example' });
      assert.equal(r.estado, 403, metodo);
    }
    assert.equal((await llamar({ ruta: '/api/gestor/clientas', cookie })).json.total, 0);
    const texto = JSON.stringify(registros);
    assert.ok(!/3001234567|1020304050|Zentro/.test(texto));
  });
});
