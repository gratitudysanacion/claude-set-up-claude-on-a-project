'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { crearServidor, CSP } = require('../src/server');
const { crearAuth, crearRegistroUsuario } = require('../src/auth');
const { crearLimites } = require('../src/limites');
const { crearCatalogo } = require('../src/catalogo');
const { parsearEnv, cargarEnv } = require('../src/env');
const { productos, campana } = require('./fixtures');

const CLAVE = 'clave-de-prueba-123';
let registro;
let publicDir;

test.before(async () => {
  registro = await crearRegistroUsuario(CLAVE);
  publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asistente-public-'));
  fs.writeFileSync(path.join(publicDir, 'index.html'), '<!doctype html><title>prueba</title>');
  fs.writeFileSync(path.join(publicDir, 'app.js'), 'console.log("ok");');
  fs.writeFileSync(path.join(publicDir, 'styles.css'), 'body{}');
});
test.after(() => fs.rmSync(publicDir, { recursive: true, force: true }));

async function conServidor(opciones, prueba) {
  const reloj = { t: Date.UTC(2026, 9, 27, 15, 0, 0) }; // 27 oct 2026, 10:00 en Colombia
  const ahora = () => reloj.t;
  const auth = crearAuth({ usuarios: { isa: registro }, ahora, ...(opciones.auth || {}) });
  const limites = crearLimites({ ahora, ...(opciones.limites || {}) });
  const catalogo = crearCatalogo({ productos, campana, hoy: () => '2026-10-27' });
  const llamadas = [];
  const responder = opciones.sinResponder ? null : (opciones.responder || (async ({ mensaje }) => {
    llamadas.push(mensaje);
    return { respuesta: `eco: ${mensaje}`, advertencias: ['Dato pendiente de revisión.'] };
  }));
  const servidor = crearServidor({ auth, limites, catalogo, responder, publicDir, log: () => {}, ahora });
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  const puerto = servidor.address().port;

  function llamar({ metodo = 'GET', ruta = '/', cuerpo, cabeceras = {}, ip = '10.0.0.1', crudo = false }) {
    return new Promise((resolve, reject) => {
      const datos = cuerpo === undefined ? null : (crudo ? cuerpo : JSON.stringify(cuerpo));
      const h = { 'x-real-ip': ip, ...cabeceras };
      if (datos !== null) {
        if (!h['Content-Type']) h['Content-Type'] = 'application/json';
        h['Content-Length'] = Buffer.byteLength(datos);
      }
      const req = http.request({ host: '127.0.0.1', port: puerto, method: metodo, path: ruta, headers: h }, res => {
        const trozos = [];
        res.on('data', c => trozos.push(c));
        res.on('end', () => {
          const texto = Buffer.concat(trozos).toString('utf8');
          let json = null;
          try { json = JSON.parse(texto); } catch { /* no era JSON */ }
          resolve({ estado: res.statusCode, cabeceras: res.headers, texto, json });
        });
      });
      req.on('error', reject);
      if (datos !== null) req.write(datos);
      req.end();
    });
  }

  async function entrar(ip = '10.0.0.1') {
    const r = await llamar({ metodo: 'POST', ruta: '/api/login', cuerpo: { usuario: 'isa', clave: CLAVE }, ip });
    assert.equal(r.estado, 200, 'el login de prueba debe funcionar');
    return r.cabeceras['set-cookie'][0].split(';')[0];
  }

  try { await prueba({ llamar, entrar, reloj, llamadas, auth, servidor }); } finally {
    await new Promise(r => servidor.close(r));
  }
}

// ---- Estado y archivos estáticos ----
test('health y estado públicos, sin secretos', async () => {
  await conServidor({ sinResponder: true }, async ({ llamar }) => {
    const h = await llamar({ ruta: '/health' });
    assert.equal(h.estado, 200);
    assert.equal(h.json.ai, 'not_connected');
    assert.equal(h.json.productos, productos.length);
    const e = await llamar({ ruta: '/api/estado' });
    assert.equal(e.json.campana.estado, 'vigente');
    assert.equal(e.json.campana.hasta, '2026-11-06');
    assert.ok(!/clave|hash|sal/i.test(JSON.stringify(e.json).replace(/salida/gi, '')));
  });
  await conServidor({}, async ({ llamar }) => {
    assert.equal((await llamar({ ruta: '/health' })).json.ai, 'connected');
  });
});

test('archivos estáticos: solo la lista blanca, con CSP y nosniff', async () => {
  await conServidor({}, async ({ llamar }) => {
    for (const ruta of ['/', '/index.html', '/app.js', '/styles.css']) {
      const r = await llamar({ ruta });
      assert.equal(r.estado, 200, ruta);
      assert.equal(r.cabeceras['content-security-policy'], CSP);
      assert.equal(r.cabeceras['x-content-type-options'], 'nosniff');
    }
    for (const ruta of ['/src/server.js', '/package.json', '/data/usuarios.json', '/.env', '/%2e%2e/package.json', '/test/fixtures.js']) {
      assert.equal((await llamar({ ruta })).estado, 404, ruta);
    }
    assert.equal((await llamar({ ruta: '/yanbal-logo.jpg' })).estado, 404); // no existe en el directorio de prueba
  });
});

test('la API responde con no-store y las mismas cabeceras de seguridad', async () => {
  await conServidor({}, async ({ llamar }) => {
    const r = await llamar({ ruta: '/api/estado' });
    assert.equal(r.cabeceras['cache-control'], 'no-store');
    assert.equal(r.cabeceras['content-security-policy'], CSP);
    assert.ok(CSP.includes("frame-ancestors 'none'"));
  });
});

// ---- Login ----
test('login correcto: cookie HttpOnly, Secure, SameSite=Strict y 8 horas', async () => {
  await conServidor({}, async ({ llamar }) => {
    const r = await llamar({ metodo: 'POST', ruta: '/api/login', cuerpo: { usuario: 'isa', clave: CLAVE } });
    assert.equal(r.estado, 200);
    const cookie = r.cabeceras['set-cookie'][0];
    assert.match(cookie, /^isamor_sesion=[0-9a-f]{64};/);
    for (const parte of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', 'Max-Age=28800']) assert.ok(cookie.includes(parte), parte);
    assert.ok(!JSON.stringify(r.json).includes(cookie.split(';')[0].split('=')[1]), 'el token no va en el cuerpo');
  });
});

test('login incorrecto: siempre el mismo 401, sin filtrar usuario ni largo de la clave', async () => {
  await conServidor({}, async ({ llamar }) => {
    const casos = [
      { usuario: 'isa', clave: 'x' },
      { usuario: 'isa', clave: 'x'.repeat(200) },
      { usuario: 'inexistente', clave: CLAVE },
      { usuario: '__proto__', clave: CLAVE },
      { usuario: 'constructor', clave: CLAVE },
      { usuario: 'isa', clave: 12345 },
      { usuario: null, clave: null }
    ];
    const cuerpos = new Set();
    for (const [i, c] of casos.entries()) {
      const r = await llamar({ metodo: 'POST', ruta: '/api/login', cuerpo: c, ip: `10.1.0.${i}` });
      assert.equal(r.estado, 401, JSON.stringify(c));
      cuerpos.add(r.texto);
    }
    assert.equal(cuerpos.size, 1);
  });
});

test('el usuario no distingue mayúsculas', async () => {
  await conServidor({}, async ({ llamar }) => {
    const r = await llamar({ metodo: 'POST', ruta: '/api/login', cuerpo: { usuario: ' ISA ', clave: CLAVE } });
    assert.equal(r.estado, 200);
  });
});

test('límite de intentos: 5 fallos bloquean la IP (429 con Retry-After), otra IP no se afecta y se libera con el tiempo', async () => {
  await conServidor({}, async ({ llamar, reloj }) => {
    for (let i = 0; i < 5; i++) {
      assert.equal((await llamar({ metodo: 'POST', ruta: '/api/login', cuerpo: { usuario: 'isa', clave: 'mala' }, ip: '10.9.9.9' })).estado, 401);
    }
    const bloqueado = await llamar({ metodo: 'POST', ruta: '/api/login', cuerpo: { usuario: 'isa', clave: CLAVE }, ip: '10.9.9.9' });
    assert.equal(bloqueado.estado, 429);
    assert.ok(Number(bloqueado.cabeceras['retry-after']) > 0);
    assert.equal((await llamar({ metodo: 'POST', ruta: '/api/login', cuerpo: { usuario: 'isa', clave: CLAVE }, ip: '10.9.9.8' })).estado, 200);
    reloj.t += 15 * 60 * 1000 + 1000;
    assert.equal((await llamar({ metodo: 'POST', ruta: '/api/login', cuerpo: { usuario: 'isa', clave: CLAVE }, ip: '10.9.9.9' })).estado, 200);
  });
});

test('un cuerpo de login inválido cuenta como intento fallido', async () => {
  await conServidor({ auth: { maxFallos: 2 } }, async ({ llamar }) => {
    assert.equal((await llamar({ metodo: 'POST', ruta: '/api/login', cuerpo: 'no es json', crudo: true, ip: '10.8.8.8' })).estado, 400);
    assert.equal((await llamar({ metodo: 'POST', ruta: '/api/login', cuerpo: 'tampoco', crudo: true, ip: '10.8.8.8' })).estado, 400);
    assert.equal((await llamar({ metodo: 'POST', ruta: '/api/login', cuerpo: { usuario: 'isa', clave: CLAVE }, ip: '10.8.8.8' })).estado, 429);
  });
});

test('login: cuerpo mayor de 4 KB se rechaza con 413', async () => {
  await conServidor({}, async ({ llamar }) => {
    const r = await llamar({ metodo: 'POST', ruta: '/api/login', cuerpo: { usuario: 'isa', clave: 'a'.repeat(5000) } });
    assert.equal(r.estado, 413);
  });
});

test('sesión: vence a las 8 horas en el servidor y el logout la invalida', async () => {
  await conServidor({}, async ({ llamar, entrar, reloj }) => {
    const cookie = await entrar();
    assert.equal((await llamar({ ruta: '/api/sesion', cabeceras: { Cookie: cookie } })).json.autenticada, true);
    const salida = await llamar({ metodo: 'POST', ruta: '/api/logout', cuerpo: {}, cabeceras: { Cookie: cookie } });
    assert.equal(salida.estado, 200);
    assert.ok(salida.cabeceras['set-cookie'][0].includes('Max-Age=0'));
    assert.equal((await llamar({ ruta: '/api/sesion', cabeceras: { Cookie: cookie } })).json.autenticada, false);

    const otra = await entrar();
    reloj.t += 8 * 60 * 60 * 1000 + 1000;
    assert.equal((await llamar({ ruta: '/api/sesion', cabeceras: { Cookie: otra } })).json.autenticada, false);
    assert.equal((await llamar({ metodo: 'POST', ruta: '/api/chat', cuerpo: { mensaje: 'hola' }, cabeceras: { Cookie: otra } })).estado, 401);
  });
});

test('una cookie mal formada no autentica', async () => {
  await conServidor({}, async ({ llamar }) => {
    for (const c of ['isamor_sesion=abc', 'isamor_sesion=' + 'g'.repeat(64), 'otra=valor', '']) {
      const r = await llamar({ metodo: 'POST', ruta: '/api/chat', cuerpo: { mensaje: 'hola' }, cabeceras: c ? { Cookie: c } : {} });
      assert.equal(r.estado, 401, c);
    }
  });
});

// ---- Chat ----
test('chat: sin sesión 401; con sesión llama al responder con el mensaje recortado', async () => {
  await conServidor({}, async ({ llamar, entrar, llamadas }) => {
    assert.equal((await llamar({ metodo: 'POST', ruta: '/api/chat', cuerpo: { mensaje: 'hola' } })).estado, 401);
    const cookie = await entrar();
    const r = await llamar({ metodo: 'POST', ruta: '/api/chat', cuerpo: { mensaje: '  precio de 670  ' }, cabeceras: { Cookie: cookie } });
    assert.equal(r.estado, 200);
    assert.equal(r.json.respuesta, 'eco: precio de 670');
    assert.deepEqual(r.json.advertencias, ['Dato pendiente de revisión.']);
    assert.equal(r.json.campana.estado, 'vigente');
    assert.deepEqual(llamadas, ['precio de 670']);
  });
});

test('chat: validaciones (vacío, no texto, demasiado largo, no JSON, tipo de contenido) y no consumen el límite', async () => {
  await conServidor({ limites: { porMinuto: 2 } }, async ({ llamar, entrar }) => {
    const cookie = await entrar();
    const c = { Cookie: cookie };
    assert.equal((await llamar({ metodo: 'POST', ruta: '/api/chat', cuerpo: { mensaje: '   ' }, cabeceras: c })).estado, 400);
    assert.equal((await llamar({ metodo: 'POST', ruta: '/api/chat', cuerpo: { mensaje: 42 }, cabeceras: c })).estado, 400);
    assert.equal((await llamar({ metodo: 'POST', ruta: '/api/chat', cuerpo: { mensaje: 'a'.repeat(1501) }, cabeceras: c })).estado, 413);
    assert.equal((await llamar({ metodo: 'POST', ruta: '/api/chat', cuerpo: { mensaje: 'a'.repeat(9000) }, cabeceras: c })).estado, 413);
    assert.equal((await llamar({ metodo: 'POST', ruta: '/api/chat', cuerpo: 'no es json', crudo: true, cabeceras: c })).estado, 400);
    assert.equal((await llamar({ metodo: 'POST', ruta: '/api/chat', cuerpo: '[1,2]', crudo: true, cabeceras: c })).estado, 400);
    assert.equal((await llamar({ metodo: 'POST', ruta: '/api/chat', cuerpo: 'mensaje=hola', crudo: true, cabeceras: { ...c, 'Content-Type': 'text/plain' } })).estado, 415);
    // Las solicitudes inválidas no gastaron el límite de 2 por minuto:
    assert.equal((await llamar({ metodo: 'POST', ruta: '/api/chat', cuerpo: { mensaje: 'uno' }, cabeceras: c })).estado, 200);
    assert.equal((await llamar({ metodo: 'POST', ruta: '/api/chat', cuerpo: { mensaje: 'dos' }, cabeceras: c })).estado, 200);
  });
});

test('chat: límite por minuto (429 con Retry-After) que se libera con el tiempo', async () => {
  await conServidor({ limites: { porMinuto: 3 } }, async ({ llamar, entrar, reloj }) => {
    const c = { Cookie: await entrar() };
    for (let i = 0; i < 3; i++) assert.equal((await llamar({ metodo: 'POST', ruta: '/api/chat', cuerpo: { mensaje: `m${i}` }, cabeceras: c })).estado, 200);
    const r = await llamar({ metodo: 'POST', ruta: '/api/chat', cuerpo: { mensaje: 'otro' }, cabeceras: c });
    assert.equal(r.estado, 429);
    assert.ok(Number(r.cabeceras['retry-after']) >= 1);
    reloj.t += 61 * 1000;
    assert.equal((await llamar({ metodo: 'POST', ruta: '/api/chat', cuerpo: { mensaje: 'otro' }, cabeceras: c })).estado, 200);
  });
});

test('chat: límite diario por usuaria, reiniciado a medianoche de Colombia', async () => {
  await conServidor({ limites: { porMinuto: 100, porDia: 3 } }, async ({ llamar, entrar, reloj }) => {
    const c = { Cookie: await entrar() };
    for (let i = 0; i < 3; i++) assert.equal((await llamar({ metodo: 'POST', ruta: '/api/chat', cuerpo: { mensaje: `m${i}` }, cabeceras: c })).estado, 200);
    const r = await llamar({ metodo: 'POST', ruta: '/api/chat', cuerpo: { mensaje: 'x' }, cabeceras: c });
    assert.equal(r.estado, 429);
    assert.match(r.json.error, /límite diario/);
    reloj.t = Date.UTC(2026, 9, 28, 5, 1, 0); // 28 oct 00:01 en Colombia (sesión vigente: < 8 h no; renovar)
    const nueva = { Cookie: await entrar() };
    assert.equal((await llamar({ metodo: 'POST', ruta: '/api/chat', cuerpo: { mensaje: 'nuevo día' }, cabeceras: nueva })).estado, 200);
  });
});

test('chat: errores del responder se traducen sin filtrar detalles internos', async () => {
  const falla = codigo => async () => { const e = new Error('DETALLE_SECRETO_INTERNO'); if (codigo) e.codigo = codigo; throw e; };
  for (const [codigo, estado] of [['saldo_agotado', 503], ['ia_no_disponible', 503], ['tiempo_agotado', 503], [null, 500]]) {
    await conServidor({ responder: falla(codigo) }, async ({ llamar, entrar }) => {
      const r = await llamar({ metodo: 'POST', ruta: '/api/chat', cuerpo: { mensaje: 'hola' }, cabeceras: { Cookie: await entrar() } });
      assert.equal(r.estado, estado, String(codigo));
      assert.ok(!r.texto.includes('DETALLE_SECRETO_INTERNO'));
    });
  }
});

test('chat sin IA conectada responde 503 claro', async () => {
  await conServidor({ sinResponder: true }, async ({ llamar, entrar }) => {
    const r = await llamar({ metodo: 'POST', ruta: '/api/chat', cuerpo: { mensaje: 'hola' }, cabeceras: { Cookie: await entrar() } });
    assert.equal(r.estado, 503);
    assert.equal(r.json.codigo, 'ia_no_disponible');
  });
});

// ---- Defensa CSRF ----
test('POST desde otro origen se rechaza con 403; mismo origen o sin Origin pasa', async () => {
  await conServidor({}, async ({ llamar, servidor }) => {
    const cuerpo = { usuario: 'isa', clave: CLAVE };
    assert.equal((await llamar({ metodo: 'POST', ruta: '/api/login', cuerpo, cabeceras: { Origin: 'https://sitio-malicioso.example' } })).estado, 403);
    assert.equal((await llamar({ metodo: 'POST', ruta: '/api/login', cuerpo, cabeceras: { Origin: 'no es una url' } })).estado, 403);
    const propio = `http://127.0.0.1:${servidor.address().port}`;
    assert.equal((await llamar({ metodo: 'POST', ruta: '/api/login', cuerpo, cabeceras: { Origin: propio }, ip: '10.2.2.2' })).estado, 200);
    assert.equal((await llamar({ metodo: 'POST', ruta: '/api/login', cuerpo, ip: '10.2.2.3' })).estado, 200);
  });
});

test('rutas y métodos inesperados devuelven 404', async () => {
  await conServidor({}, async ({ llamar }) => {
    assert.equal((await llamar({ ruta: '/api/chat' })).estado, 404);
    assert.equal((await llamar({ metodo: 'PUT', ruta: '/api/login', cuerpo: {} })).estado, 404);
    assert.equal((await llamar({ metodo: 'DELETE', ruta: '/' })).estado, 404);
    assert.equal((await llamar({ ruta: '/api/no-existe' })).json.error, 'Ruta no encontrada');
  });
});

// ---- Usuarios y configuración ----
test('el registro de usuario nunca contiene la clave y usa una sal distinta cada vez', async () => {
  const a = await crearRegistroUsuario(CLAVE);
  const b = await crearRegistroUsuario(CLAVE);
  assert.notEqual(a.sal, b.sal);
  assert.notEqual(a.hash, b.hash);
  assert.ok(!JSON.stringify(a).includes(CLAVE));
  assert.equal(a.alg, 'scrypt-N16384-r8-p1');
  assert.equal(a.hash.length, 64);
});

test('lector de .env: comentarios, comillas, no pisa variables existentes y solo devuelve nombres', () => {
  const texto = '# comentario\nA=1\nB="dos palabras"\nC=\'x\'\n  D = 4  \nmal formato\n';
  assert.deepEqual(parsearEnv(texto), { A: '1', B: 'dos palabras', C: 'x', D: '4' });
  const destino = { A: 'existente' };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-'));
  const archivo = path.join(dir, '.env');
  fs.writeFileSync(archivo, 'A=nuevo\nCLAVE_PRUEBA=valor-secreto\n');
  const nombres = cargarEnv(archivo, destino);
  assert.deepEqual(nombres, ['A', 'CLAVE_PRUEBA']);
  assert.ok(!JSON.stringify(nombres).includes('valor-secreto'));
  assert.equal(destino.A, 'existente');
  assert.equal(destino.CLAVE_PRUEBA, 'valor-secreto');
  assert.deepEqual(cargarEnv(path.join(dir, 'no-existe'), {}), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('el asistente comercial remite la redacción de textos al Estudio de contenido', () => {
  const { SISTEMA } = require('../src/ia');
  assert.ok(SISTEMA.includes('NO los redactes ni ofrezcas hacerlo'));
  assert.ok(SISTEMA.includes('módulo "Estudio de contenido" del menú de la izquierda'));
});
