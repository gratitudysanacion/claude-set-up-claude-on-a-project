'use strict';
// Prueba de extremo a extremo en Chromium real. Datos ficticios; no usa red externa.
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const base = path.join(__dirname, 'asistente-v2');
const { crearServidor } = require(path.join(base, 'src/server'));
const { crearAuth, crearRegistroUsuario } = require(path.join(base, 'src/auth'));
const { crearLimites } = require(path.join(base, 'src/limites'));
const { crearCatalogo } = require(path.join(base, 'src/catalogo'));
const { productos, campana } = require(path.join(base, 'test/fixtures'));
const FUERA = path.join(__dirname, 'capturas');
require('node:fs').mkdirSync(FUERA, { recursive: true });

async function levantar({ hoy = '2026-10-27', porMinuto = 50 } = {}) {
  const registro = await crearRegistroUsuario('clave-de-prueba-123');
  const servidor = crearServidor({
    auth: crearAuth({ usuarios: { isa: registro, cris: { ...registro, modulos: ['sales', 'content'] } } }),
    limites: crearLimites({ porMinuto, porDia: 200 }),
    catalogo: crearCatalogo({ productos, campana, hoy: () => hoy }),
    responderes: {
      sales: async ({ mensaje }) => ({ respuesta: `Eco: ${mensaje}`, advertencias: ['Dato pendiente de revisión.', 'Se vende solo dentro de un set.'], uso: {} }),
      content: async ({ mensaje }) => ({ respuesta: `GUION REEL:\nTexto de contenido para ${mensaje}\nHASHTAGS: #Yanbal`, advertencias: [], uso: {} })
    },
    publicDir: path.join(base, 'public'), log: () => {}
  });
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  return { servidor, url: `http://127.0.0.1:${servidor.address().port}` };
}

(async () => {
  const navegador = await chromium.launch();
  const resultados = [];
  const ok = (nombre) => { resultados.push(nombre); console.log('OK  ', nombre); };

  // ---------- Escenario principal ----------
  const { servidor, url } = await levantar({ porMinuto: 4 });
  const ctx = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
  const pagina = await ctx.newPage();
  const problemas = [];
  const peticiones = [];
  await pagina.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));
  });
  pagina.on('pageerror', e => problemas.push('pageerror: ' + e.message));
  pagina.on('console', m => { if (m.type() === 'error' && !/yanbal-logo|favicon|404|status of (401|429)/.test(m.text())) problemas.push('console: ' + m.text()); });
  pagina.on('request', r => peticiones.push(r.method() + ' ' + new URL(r.url()).pathname));

  await pagina.goto(url);
  assert.equal(await pagina.title(), 'Yanbal | Asistente Comercial');
  await pagina.screenshot({ path: path.join(FUERA, '1-inicio.png') });
  ok('inicio carga sin errores de script');

  await pagina.click('.card[data-module="sales"]');
  await pagina.waitForSelector('#login-form:not(.hidden)');
  assert.match(await pagina.textContent('#campaign'), /Campaña C11 2026: vigente del 10\/10\/2026 al 06\/11\/2026\./);
  assert.ok(!(await pagina.textContent('#campaign')).includes('Termina en'));
  assert.ok(await pagina.isVisible('#review-label'));
  assert.ok(!(await pagina.isVisible('#chat-area')));
  assert.ok(!(await pagina.isVisible('#demo-notice')));
  await pagina.screenshot({ path: path.join(FUERA, '2-login.png') });
  ok('módulo comercial: banner de campaña, aviso de catálogo en revisión y login (chat oculto)');

  await pagina.fill('#login-user', 'isa');
  await pagina.fill('#login-pass', 'clave-equivocada');
  await pagina.click('#login-submit');
  await pagina.waitForFunction(() => document.getElementById('login-error').textContent.length > 0);
  assert.equal(await pagina.textContent('#login-error'), 'Usuario o clave incorrectos.');
  ok('clave incorrecta muestra mensaje genérico');

  await pagina.fill('#login-pass', 'clave-de-prueba-123');
  await pagina.click('#login-submit');
  await pagina.waitForSelector('#chat-area:not(.hidden)');
  assert.equal(await pagina.inputValue('#login-pass'), '');
  assert.match(await pagina.textContent('#session-user'), /Sesión de isa/);
  assert.ok(!(await pagina.isVisible('#login-form')));
  const cookies = await ctx.cookies();
  const sesion = cookies.find(c => c.name === 'isamor_sesion');
  assert.ok(sesion && sesion.httpOnly && sesion.sameSite === 'Strict');
  assert.equal(await pagina.evaluate(() => document.cookie), '', 'JavaScript no ve la cookie de sesión');
  ok('login correcto: chat visible, clave limpiada, cookie HttpOnly invisible para JS');

  await pagina.fill('#message-input', 'precio del 670');
  await pagina.press('#message-input', 'Enter');
  await pagina.waitForFunction(() => document.querySelectorAll('.message.assistant:not(.pending)').length >= 2);
  const textos = await pagina.$$eval('.message', n => n.map(x => x.textContent));
  assert.ok(textos.includes('precio del 670') && textos.includes('Eco: precio del 670'));
  const avisos = await pagina.$$eval('.message-warnings li', n => n.map(x => x.textContent));
  assert.deepEqual(avisos, ['⚠ Se vende solo dentro de un set.']);
  await pagina.screenshot({ path: path.join(FUERA, '3-chat.png') });
  ok('Enter envía; respuesta mostrada; "pendiente de revisión" no se repite pero las demás advertencias sí');

  const intento = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>**negrita**';
  await pagina.fill('#message-input', intento);
  await pagina.click('#send');
  await pagina.waitForFunction(() => document.querySelectorAll('.message.assistant:not(.pending)').length >= 3);
  assert.equal(await pagina.evaluate(() => window.__xss), undefined);
  assert.equal(await pagina.$$eval('#chat-log img, #chat-log script', n => n.length), 0);
  assert.ok((await pagina.$$eval('.message.user', n => n.map(x => x.textContent))).includes(intento));
  ok('HTML/JS en el mensaje se muestra como texto y no se ejecuta');

  await pagina.fill('#message-input', 'tercera');
  await pagina.click('#send');
  await pagina.waitForFunction(() => document.querySelectorAll('.message.assistant:not(.pending)').length >= 4);
  await pagina.fill('#message-input', 'cuarta');
  await pagina.click('#send');
  await pagina.waitForFunction(() => document.querySelectorAll('.message.assistant:not(.pending)').length >= 5);
  await pagina.fill('#message-input', 'quinta (excede el límite de 4/min)');
  await pagina.click('#send');
  await pagina.waitForFunction(() => [...document.querySelectorAll('.message.assistant')].some(m => /Demasiadas consultas seguidas/.test(m.textContent)));
  assert.match(await pagina.textContent('.message.assistant:last-of-type'), /Inténtalo en/);
  await pagina.waitForFunction(() => !document.getElementById('send').disabled);
  ok('límite por minuto: mensaje claro con tiempo de espera y el botón se reactiva');

  assert.equal(await pagina.evaluate(() => window.__csp.length), 0, 'sin violaciones de CSP');
  ok('cero violaciones de la política de seguridad (CSP)');

  // Sesión vencida: se borran las cookies y se intenta enviar
  const { servidor: s2, url: url2 } = await levantar();
  const ctx2 = await navegador.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto(url2);
  await p2.click('.card[data-module="sales"]');
  await p2.fill('#login-user', 'isa'); await p2.fill('#login-pass', 'clave-de-prueba-123'); await p2.click('#login-submit');
  await p2.waitForSelector('#chat-area:not(.hidden)');
  await ctx2.clearCookies();
  await p2.fill('#message-input', 'hola'); await p2.click('#send');
  await p2.waitForSelector('#login-form:not(.hidden)');
  assert.equal(await p2.textContent('#login-error'), 'Tu sesión terminó. Inicia sesión de nuevo.');
  assert.ok(!(await p2.isVisible('#chat-area')));
  ok('sesión vencida: vuelve al login con aviso claro');

  // Recarga con sesión viva y logout
  await p2.fill('#login-user', 'isa'); await p2.fill('#login-pass', 'clave-de-prueba-123'); await p2.click('#login-submit');
  await p2.waitForSelector('#chat-area:not(.hidden)');
  await p2.reload();
  await p2.click('.card[data-module="sales"]');
  await p2.waitForSelector('#chat-area:not(.hidden)');
  assert.ok(!(await p2.isVisible('#login-form')));
  await p2.click('#logout');
  await p2.waitForSelector('#login-form:not(.hidden)');
  assert.equal(await p2.$$eval('.message', n => n.length), 0);
  await p2.reload(); await p2.click('.card[data-module="sales"]');
  await p2.waitForSelector('#login-form:not(.hidden)');
  ok('recarga conserva la sesión; cerrar sesión limpia el chat y exige login otra vez');

  // Módulo no conectado
  await pagina.click('#back-home');
  await pagina.click('.card[data-module="beauty"]');
  await pagina.waitForSelector('#demo-notice:not(.hidden)');
  assert.ok(!(await pagina.isVisible('#sales-extras')));
  const antes = peticiones.filter(p => p === 'POST /api/chat').length;
  await pagina.fill('#message-input', 'consulta de belleza');
  await pagina.click('#send');
  await pagina.waitForFunction(() => /todavía no está conectado/.test(document.getElementById('chat-log').textContent));
  assert.equal(peticiones.filter(p => p === 'POST /api/chat').length, antes);
  ok('módulos no conectados: aviso de versión inicial y nada sale del navegador');

  // ---------- Estudio de contenido y permisos ----------
  {
    const { servidor: s3, url: url3 } = await levantar();
    const ctx3 = await navegador.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const p3 = await ctx3.newPage();
    const cuerpos = [];
    p3.on('request', r => { if (r.url().endsWith('/api/chat')) cuerpos.push(JSON.parse(r.postData())); });
    await p3.goto(url3);
    // Usuaria solo con el módulo comercial
    await p3.click('.card[data-module="content"]');
    await p3.waitForSelector('#login-form:not(.hidden)');
    assert.match(await p3.textContent('#workspace-description'), /guiones, descripciones, hashtags/);
    assert.ok(await p3.isVisible('#campaign'));
    await p3.fill('#login-user', 'isa'); await p3.fill('#login-pass', 'clave-de-prueba-123'); await p3.click('#login-submit');
    await p3.waitForSelector('#sin-permiso:not(.hidden)');
    assert.ok(!(await p3.isVisible('#chat-area')));
    assert.ok(await p3.isVisible('#session-bar'));
    ok('contenido: una usuaria sin el módulo habilitado ve el aviso y no el chat');
    await p3.click('[data-module="sales"] >> nth=0');
    await p3.waitForSelector('#chat-area:not(.hidden)');
    await p3.fill('#message-input', 'hola ventas'); await p3.click('#send');
    await p3.waitForFunction(() => /Eco: hola ventas/.test(document.getElementById('chat-log').textContent));
    assert.equal(cuerpos.at(-1).modulo, 'sales');
    ok('el módulo comercial sigue funcionando para esa usuaria y envía modulo=sales');
    await p3.click('#logout');
    await p3.waitForSelector('#login-form:not(.hidden)');

    // Usuaria con contenido habilitado
    await p3.fill('#login-user', 'cris'); await p3.fill('#login-pass', 'clave-de-prueba-123'); await p3.click('#login-submit');
    await p3.waitForSelector('#chat-area:not(.hidden)');
    await p3.click('#back-home');
    await p3.click('.card[data-module="content"]');
    await p3.waitForSelector('#chat-area:not(.hidden)');
    assert.match(await p3.textContent('#chat-log'), /Te entrego descripción, hashtags/);
    assert.ok(!(await p3.isVisible('#sin-permiso')));
    await p3.fill('#message-input', 'reel del 5104'); await p3.press('#message-input', 'Enter');
    await p3.waitForFunction(() => /Texto de contenido para reel del 5104/.test(document.getElementById('chat-log').textContent));
    assert.equal(cuerpos.at(-1).modulo, 'content');
    assert.equal(await p3.$$eval('.copy-btn', n => n.length), 1);
    await p3.click('.copy-btn');
    await p3.waitForFunction(() => document.querySelector('.copy-btn').textContent.includes('Copiado'));
    const copiado = await p3.evaluate(() => navigator.clipboard.readText());
    assert.equal(copiado, 'GUION REEL:\nTexto de contenido para reel del 5104\nHASHTAGS: #Yanbal');
    await p3.screenshot({ path: path.join(FUERA, '6-contenido.png') });
    ok('contenido: chat propio, envía modulo=content y el botón "Copiar texto" copia exactamente la respuesta');
    // El botón de copiar no aparece en el módulo comercial
    await p3.click('#back-home'); await p3.click('.card[data-module="sales"]');
    await p3.waitForSelector('#chat-area:not(.hidden)');
    await p3.fill('#message-input', 'otra'); await p3.click('#send');
    await p3.waitForFunction(() => /Eco: otra/.test(document.getElementById('chat-log').textContent));
    assert.equal(await p3.$$eval('.copy-btn', n => n.length), 0);
    ok('el botón de copiar solo existe en el Estudio de contenido');
    assert.equal(await p3.evaluate(() => window.__csp ? window.__csp.length : 0), 0);
    await ctx3.close(); await new Promise(r => s3.close(r));
  }

  // Móvil
  await pagina.setViewportSize({ width: 390, height: 844 });
  await pagina.click('[data-module="sales"] >> nth=0');
  await pagina.waitForTimeout(300);
  await pagina.screenshot({ path: path.join(FUERA, '4-movil.png'), fullPage: true });
  assert.ok(await pagina.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'sin desbordamiento horizontal');
  ok('vista móvil sin desbordamiento horizontal');

  // Campaña vencida y por terminar
  for (const [hoy, patron, nivel, archivo] of [
    ['2026-11-20', /terminó el 06\/11\/2026\. Los precios mostrados son de referencia: no los ofrezcas como vigentes/, 'alert', '5-vencida.png'],
    ['2026-11-04', /Termina en 2 día\(s\)\./, 'warn', null],
    ['2026-10-01', /aún no rige \(desde el 10\/10\/2026\)/, 'warn', null]
  ]) {
    const { servidor: s, url: u } = await levantar({ hoy });
    const c = await navegador.newContext({ viewport: { width: 1000, height: 700 } });
    const p = await c.newPage();
    await p.goto(u); await p.click('.card[data-module="sales"]');
    await p.waitForSelector('#login-form:not(.hidden)');
    assert.match(await p.textContent('#campaign'), patron);
    assert.ok((await p.getAttribute('#campaign', 'class')).includes(nivel));
    if (archivo) await p.screenshot({ path: path.join(FUERA, archivo) });
    await c.close(); await new Promise(r => s.close(r));
    ok(`banner de campaña (${hoy}): ${nivel}`);
  }

  assert.deepEqual(problemas, [], 'errores de consola o de script: ' + problemas.join(' | '));
  ok('sin errores de consola ni de script durante toda la prueba');

  await navegador.close();
  await new Promise(r => servidor.close(r));
  await new Promise(r => s2.close(r));
  console.log(`\n${resultados.length} verificaciones de navegador superadas`);
})().catch(e => { console.error('FALLÓ:', e.message); process.exit(1); });
