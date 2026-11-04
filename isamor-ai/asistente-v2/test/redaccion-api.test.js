'use strict';
// API de redacción asistida y tope mensual: permisos, aislamiento entre usuarias, límites, registro sin contenido y bloqueo por gasto.
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
const { crearRedactor, plantillaFija } = require('../src/redaccion');
const { crearGasto } = require('../src/gasto');
const { productos, campana } = require('./fixtures');

const conSqlite = { skip: sqliteDisponible() ? false : 'node:sqlite no disponible en esta versión de Node' };
const CLAVE = 'clave-de-prueba-123';
let registro, publicDir;
test.before(async () => {
  registro = await crearRegistroUsuario(CLAVE);
  publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'redac-public-'));
  for (const f of ['index.html', 'app.js', 'styles.css']) fs.writeFileSync(path.join(publicDir, f), 'x');
});
test.after(() => fs.rmSync(publicDir, { recursive: true, force: true }));

const USUARIOS = () => ({
  ana: { ...registro, modulos: ['sales', 'manager'] },
  bea: { ...registro, modulos: ['manager'] },
  sinmodulo: { ...registro, modulos: ['sales'] },
  jefa: { ...registro, modulos: ['sales', 'manager'], rol: 'admin' }
});
const uso = { input_tokens: 500, output_tokens: 100 };
const BORRADOR = 'Hola María, ¿cómo te fue con el Zentro? Quedo atenta por si te ayudo con otro pedido.';

async function conServidor({ modeloRespuestas, conRedactor = true, gasto = null, limitesRedaccion, conGestor = true, responderes = {} }, prueba) {
  const ahora = () => Date.UTC(2026, 10, 4, 15, 0, 0);
  const cuerpos = [];
  const cola = modeloRespuestas ? [...modeloRespuestas] : [];
  const cliente = async cuerpo => {
    cuerpos.push(cuerpo);
    const r = cola.length ? cola.shift() : { stop_reason: 'end_turn', content: [{ type: 'text', text: BORRADOR }], usage: uso };
    if (r instanceof Error) throw r;
    return r;
  };
  const gestor = conGestor ? crearGestor({ db: abrirBase(':memory:'), cifrado: crearCifrado(generarLlaveHex()), ahora }) : null;
  const gestorMeta = { etapas: ETAPAS.map(e => ({ id: e, rotulo: ETAPAS_ROTULO[e] })), consentimiento: { version: CONSENTIMIENTO_VERSION, texto: TEXTO_CONSENTIMIENTO } };
  const registros = [];
  const servidor = crearServidor({
    auth: crearAuth({ usuarios: USUARIOS(), ahora }), limites: crearLimites({ ahora, porMinuto: 50 }),
    catalogo: crearCatalogo({ productos, campana, hoy: () => '2026-11-04' }), responderes, gestor, gestorMeta, publicDir,
    redactor: conRedactor ? crearRedactor({ cliente }) : null, gasto, limitesRedaccion: limitesRedaccion || crearLimites({ ahora, porMinuto: 20, porDia: 100 }),
    log: d => registros.push(d), ahora
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
  try { await prueba({ llamar, entrar, registros, cuerpos }); } finally { await new Promise(r => servidor.close(r)); }
}

const ficha = (extra = {}) => ({ nombre: 'María Gómez', telefono: '300 123 4567', cedula: '1020304050', direccion: 'Calle 45 #12-34', notas: 'Le gusta el Zentro', consentimiento: true, ...extra });
async function crear(llamar, cookie, extra) {
  const r = await llamar({ metodo: 'POST', ruta: '/api/gestor/clientas', cuerpo: ficha(extra), cookie });
  assert.equal(r.estado, 201);
  return r.json.id;
}
const redactar = (llamar, cookie, id, cuerpo = { tipo: 'seguimiento' }, extra = {}) => llamar({ metodo: 'POST', ruta: `/api/gestor/clientas/${id}/redactar`, cuerpo, cookie, ...extra });

test('redactar API: devuelve el borrador, no guarda nada y el registro solo tiene metadatos', conSqlite, async () => {
  await conServidor({}, async ({ llamar, entrar, registros, cuerpos }) => {
    const cookie = await entrar('ana');
    const id = await crear(llamar, cookie);
    const antes = (await llamar({ ruta: `/api/gestor/clientas/${id}`, cookie })).json;
    const r = await redactar(llamar, cookie, id, { tipo: 'respuesta', mensaje_clienta: 'Hola, ¿sigues teniendo el Zentro?', indicaciones: 'dile que sí' });
    assert.equal(r.estado, 200);
    assert.deepEqual(r.json, { borrador: BORRADOR, respaldo: false, aviso: null });
    assert.deepEqual((await llamar({ ruta: `/api/gestor/clientas/${id}`, cookie })).json, antes, 'la ficha no cambia');
    // el modelo no recibió teléfono, cédula, dirección ni apellido
    const enviado = JSON.stringify(cuerpos);
    for (const x of ['3001234567', '300 123 4567', '1020304050', 'Calle 45', 'Gómez']) assert.ok(!enviado.includes(x), x);
    assert.match(enviado, /sigues teniendo el Zentro/);
    // registro: sin contenido
    const logs = JSON.stringify(registros);
    assert.ok(!/Zentro|María|Hola, ¿cómo|sigues teniendo|dile que sí/.test(logs.replace(/"ruta":"[^"]*"/g, '')), 'el registro no debe llevar texto');
    const ev = registros.find(x => x.evento === 'redactar');
    assert.deepEqual([ev.usuario, ev.tipo, ev.entrada, ev.salida, ev.respaldo, ev.caracteres], ['ana', 'respuesta', 500, 100, false, BORRADOR.length]);
  });
});

test('redactar API: permisos (sin sesión, sin módulo, sin Gestor, sin IA) y origen cruzado', conSqlite, async () => {
  await conServidor({}, async ({ llamar, entrar }) => {
    assert.equal((await llamar({ metodo: 'POST', ruta: '/api/gestor/clientas/x/redactar', cuerpo: { tipo: 'seguimiento' } })).estado, 401);
    const sin = await llamar({ metodo: 'POST', ruta: '/api/gestor/clientas/x/redactar', cuerpo: { tipo: 'seguimiento' }, cookie: await entrar('sinmodulo') });
    assert.deepEqual([sin.estado, sin.json.codigo], [403, 'modulo_no_permitido']);
    const cookie = await entrar('ana');
    const id = await crear(llamar, cookie);
    const csrf = await redactar(llamar, cookie, id, { tipo: 'seguimiento' }, { origen: 'https://malo.example' });
    assert.equal(csrf.estado, 403);
  });
  await conServidor({ conRedactor: false }, async ({ llamar, entrar }) => {
    const cookie = await entrar('ana');
    const id = await crear(llamar, cookie);
    const r = await redactar(llamar, cookie, id);
    assert.deepEqual([r.estado, r.json.codigo], [503, 'ia_no_disponible']);
  });
  await conServidor({ conGestor: false }, async ({ llamar, entrar }) => {
    const r = await redactar(llamar, await entrar('ana'), 'x');
    assert.deepEqual([r.estado, r.json.codigo], [503, 'gestor_no_disponible']);
  });
});

test('redactar API: solo sobre fichas propias; ni otra usuaria ni la administradora (aunque use ?duena=)', conSqlite, async () => {
  await conServidor({}, async ({ llamar, entrar, cuerpos }) => {
    const ana = await entrar('ana');
    const id = await crear(llamar, ana);
    const bea = await redactar(llamar, await entrar('bea'), id);
    assert.deepEqual([bea.estado, bea.json.codigo], [404, 'no_encontrada']);
    const jefa = await entrar('jefa');
    assert.equal((await redactar(llamar, jefa, id)).estado, 404);
    const conDuena = await llamar({ metodo: 'POST', ruta: `/api/gestor/clientas/${id}/redactar?duena=ana`, cuerpo: { tipo: 'seguimiento' }, cookie: jefa });
    assert.equal(conDuena.estado, 404);
    assert.equal(cuerpos.length, 0, 'no se llamó a la IA para fichas ajenas');
  });
});

test('redactar API: el estilo viaja hasta el modelo; uno inválido da 400 sin llamar a la IA', conSqlite, async () => {
  await conServidor({}, async ({ llamar, entrar, cuerpos }) => {
    const cookie = await entrar('ana');
    const id = await crear(llamar, cookie);
    assert.equal((await redactar(llamar, cookie, id, { tipo: 'seguimiento', estilo: 'formal' })).estado, 200);
    assert.match(cuerpos[0].messages[0].content, /Tono formal y respetuoso/);
    assert.equal((await redactar(llamar, cookie, id, { tipo: 'seguimiento' })).estado, 200);
    assert.match(cuerpos[1].messages[0].content, /Tono cercano y cálido/);
    const mala = await redactar(llamar, cookie, id, { tipo: 'seguimiento', estilo: 'pirata' });
    assert.deepEqual([mala.estado, mala.json.codigo], [400, 'solicitud_invalida']);
    assert.equal(cuerpos.length, 2);
  });
});

test('redactar API: solicitudes inválidas dan 400 sin llamar a la IA ni gastar el cupo', conSqlite, async () => {
  await conServidor({ limitesRedaccion: crearLimites({ porMinuto: 1, porDia: 1 }) }, async ({ llamar, entrar, cuerpos }) => {
    const cookie = await entrar('ana');
    const id = await crear(llamar, cookie);
    for (const cuerpo of [{}, { tipo: 'otro' }, { tipo: 'respuesta' }, { tipo: 'seguimiento', indicaciones: 'x'.repeat(301) }]) {
      const r = await redactar(llamar, cookie, id, cuerpo);
      assert.equal(r.estado, 400, JSON.stringify(cuerpo));
      assert.equal(r.json.codigo, 'solicitud_invalida');
    }
    // un cuerpo que ni siquiera es un objeto JSON lo rechaza el lector común, sin código propio
    assert.equal((await redactar(llamar, cookie, id, 'texto')).estado, 400)
    assert.equal(cuerpos.length, 0);
    assert.equal((await redactar(llamar, cookie, id)).estado, 200, 'el cupo seguía intacto');
  });
});

test('redactar API: límite por minuto y por día por usuaria, con Retry-After', conSqlite, async () => {
  await conServidor({ limitesRedaccion: crearLimites({ ahora: () => Date.UTC(2026, 10, 4, 15), porMinuto: 2, porDia: 100 }) }, async ({ llamar, entrar }) => {
    const cookie = await entrar('ana');
    const id = await crear(llamar, cookie);
    assert.equal((await redactar(llamar, cookie, id)).estado, 200);
    assert.equal((await redactar(llamar, cookie, id)).estado, 200);
    const r = await redactar(llamar, cookie, id);
    assert.equal(r.estado, 429);
    assert.match(r.json.error, /Demasiados borradores/);
    // otra usuaria no se ve afectada
    const bea = await entrar('bea');
    const idBea = await crear(llamar, bea);
    assert.equal((await redactar(llamar, bea, idBea)).estado, 200);
  });
  await conServidor({ limitesRedaccion: crearLimites({ ahora: () => Date.UTC(2026, 10, 4, 15), porMinuto: 50, porDia: 1 }) }, async ({ llamar, entrar }) => {
    const cookie = await entrar('ana');
    const id = await crear(llamar, cookie);
    assert.equal((await redactar(llamar, cookie, id)).estado, 200);
    const r = await redactar(llamar, cookie, id);
    assert.equal(r.estado, 429);
    assert.match(r.json.error, /límite diario de borradores/);
  });
});

test('redactar API: si el modelo falla se entrega la plantilla con aviso y el gasto igual se registra', conSqlite, async () => {
  const gasto = crearGasto({ topeUsd: 10, ahora: () => Date.UTC(2026, 10, 4, 15) });
  const mal = { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Llámame al 3001234567' }], usage: uso };
  await conServidor({ gasto, modeloRespuestas: [mal, mal] }, async ({ llamar, entrar }) => {
    const cookie = await entrar('ana');
    const id = await crear(llamar, cookie);
    const r = await redactar(llamar, cookie, id);
    assert.equal(r.estado, 200);
    assert.equal(r.json.respaldo, true);
    assert.equal(r.json.borrador, plantillaFija('seguimiento', { nombre: 'María Gómez' }));
    assert.match(r.json.aviso, /plantilla/);
    assert.equal(gasto.estado().llamadas, 1);
    assert.equal(gasto.estado().usd, (1000 * 0.1 + 200 * 0.5) / 1e6);
  });
});

test('tope mensual: al llegar al tope la redacción y el chat responden 503 limite_mensual sin llamar a la IA; la administradora ve el gasto', conSqlite, async () => {
  const gasto = crearGasto({ topeUsd: 1, ahora: () => Date.UTC(2026, 10, 4, 15) });
  let llamadasChat = 0;
  const responderes = { sales: async () => { llamadasChat++; return { respuesta: 'ok', uso: { entrada: 1_000_000, salida: 1_000_000, vueltas: 1 } }; } };
  await conServidor({ gasto, responderes }, async ({ llamar, entrar, cuerpos }) => {
    const ana = await entrar('ana');
    const id = await crear(llamar, ana);
    // el chat suma su consumo (0,60 USD)
    assert.equal((await llamar({ metodo: 'POST', ruta: '/api/chat', cuerpo: { mensaje: 'hola', modulo: 'sales' }, cookie: ana })).estado, 200);
    assert.equal(gasto.estado().usd, 0.6);
    assert.equal(gasto.estado().aviso, false);
    // 0,60 + 0,60 = 1,20: queda bloqueado
    assert.equal((await llamar({ metodo: 'POST', ruta: '/api/chat', cuerpo: { mensaje: 'hola', modulo: 'sales' }, cookie: ana })).estado, 200);
    assert.equal(gasto.estado().bloqueado, true);
    const chat = await llamar({ metodo: 'POST', ruta: '/api/chat', cuerpo: { mensaje: 'hola', modulo: 'sales' }, cookie: ana });
    assert.deepEqual([chat.estado, chat.json.codigo], [503, 'limite_mensual']);
    assert.equal(llamadasChat, 2);
    const red = await redactar(llamar, ana, id);
    assert.deepEqual([red.estado, red.json.codigo], [503, 'limite_mensual']);
    assert.match(red.json.error, /límite mensual/);
    assert.equal(cuerpos.length, 0);
    // solo la administradora ve el gasto
    assert.equal((await llamar({ ruta: '/api/admin/gasto', cookie: ana })).estado, 403);
    const jefa = await llamar({ ruta: '/api/admin/gasto', cookie: await entrar('jefa') });
    assert.equal(jefa.estado, 200);
    assert.deepEqual([jefa.json.gasto.bloqueado, jefa.json.gasto.tope, jefa.json.gasto.mes], [true, 1, '2026-11']);
    assert.deepEqual(Object.keys(jefa.json.gasto).sort(), ['aviso', 'bloqueado', 'llamadas', 'mes', 'porcentaje', 'tope', 'usd']);
  });
  await conServidor({}, async ({ llamar, entrar }) => {
    const r = await llamar({ ruta: '/api/admin/gasto', cookie: await entrar('jefa') });
    assert.deepEqual([r.estado, r.json.gasto], [200, null]);
  });
});
