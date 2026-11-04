'use strict';
// Prueba de extremo a extremo (Chromium real) de las pantallas del Gestor de ventas. Datos ficticios, base en memoria.
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const base = path.join(__dirname, process.env.CODIGO || 'asistente-v2');
const { crearServidor } = require(path.join(base, 'src/server'));
const { crearAuth, crearRegistroUsuario } = require(path.join(base, 'src/auth'));
const { crearLimites } = require(path.join(base, 'src/limites'));
const { crearCatalogo } = require(path.join(base, 'src/catalogo'));
const { crearCifrado, generarLlaveHex } = require(path.join(base, 'src/cifrado'));
const { crearRedactor } = require(path.join(base, 'src/redaccion'));
const { crearGasto } = require(path.join(base, 'src/gasto'));
const { crearGestor, abrirBase, ETAPAS, ETAPAS_ROTULO, TEXTO_CONSENTIMIENTO, CONSENTIMIENTO_VERSION } = require(path.join(base, 'src/gestor'));
const { productos, campana } = require(path.join(base, 'test/fixtures'));
const FUERA = path.join(__dirname, 'capturas');
fs.mkdirSync(FUERA, { recursive: true });
const CLAVE = 'clave-de-prueba-123';

(async () => {
  const reg = await crearRegistroUsuario(CLAVE);
  const gestor = crearGestor({ db: abrirBase(':memory:'), cifrado: crearCifrado(generarLlaveHex()) });
  const gestorMeta = { etapas: ETAPAS.map(e => ({ id: e, rotulo: ETAPAS_ROTULO[e] })), consentimiento: { version: CONSENTIMIENTO_VERSION, texto: TEXTO_CONSENTIMIENTO } };
  // IA simulada: devuelve un borrador correcto, salvo si en el mensaje aparece la palabra "TRAMPA", que devuelve un teléfono inventado.
  const llamadasIA = [];
  const cliente = async cuerpo => {
    llamadasIA.push(JSON.stringify(cuerpo));
    const dato = cuerpo.messages[0].content;
    const texto = /TRAMPA/.test(dato) ? 'Llámame al 3105551234' : 'Hola Marta, ¿cómo vas con tu pedido? Quedo atenta por si te ayudo con algo más.';
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: texto }], usage: { input_tokens: 400, output_tokens: 60 } };
  };
  const gasto = crearGasto({ topeUsd: 10 });
  const servidor = crearServidor({
    redactor: crearRedactor({ cliente }), gasto,
    auth: crearAuth({ usuarios: { ana: { ...reg, modulos: ['sales', 'manager'] }, jefa: { ...reg, modulos: ['sales', 'manager'], rol: 'admin' }, sola: { ...reg, modulos: ['sales'] } } }),
    limites: crearLimites({ porMinuto: 60, porDia: 500 }), catalogo: crearCatalogo({ productos, campana, hoy: () => '2026-10-27' }),
    responderes: {}, gestor, gestorMeta, publicDir: path.join(base, 'public'), log: () => {}
  });
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${servidor.address().port}`;
  const navegador = await chromium.launch();
  const problemas = [];
  const ok = n => console.log('OK  ', n);
  const contexto = async (ancho = 1280) => {
    const ctx = await navegador.newContext({ viewport: { width: ancho, height: 900 } });
    const p = await ctx.newPage();
    await p.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI)); });
    p.on('pageerror', e => problemas.push('pageerror: ' + e.message));
    p.on('console', m => { if (m.type() === 'error' && !/yanbal-logo|favicon|404|status of (400|401|403|409|429|503)/.test(m.text())) problemas.push('console: ' + m.text()); });
    return { ctx, p };
  };
  const entrar = async (p, usuario) => {
    await p.goto(url);
    await p.click('.card[data-module="manager"]');
    await p.waitForSelector('#login-form:not(.hidden)');
    await p.fill('#login-user', usuario);
    await p.fill('#login-pass', CLAVE);
    await p.click('#login-submit');
  };

  // ---------- Usuaria ----------
  const a = await contexto();
  await entrar(a.p, 'ana');
  await a.p.waitForSelector('#mg-indicadores .mg-kpi');
  assert.ok(!(await a.p.isVisible('#chat-area')));
  assert.equal(await a.p.textContent('#workspace-title'), 'Gestor de ventas');
  assert.match(await a.p.textContent('#mg-contenido'), /No hay clientas|aún no tiene|Todavía no/i);
  assert.ok(!/\bnull\b|undefined/.test(await a.p.textContent('#manager-area')), 'la pantalla no debe mostrar "null" ni "undefined"');
  ok('la usuaria entra al Gestor: sin chat, con indicadores y lista vacía');

  const estilo = await a.p.evaluate(() => { const c = getComputedStyle(document.querySelector('.mg-pestana')); return { f: c.fontFamily, t: parseFloat(c.fontSize) }; });
  assert.ok(estilo.t <= 14 && !/Georgia/i.test(estilo.f), `las pestañas deben tener el tamaño de los controles, no el del cuerpo (${JSON.stringify(estilo)})`);
  await a.p.click('#mg-nueva');
  await a.p.waitForSelector('#mg-form');
  assert.ok(await a.p.isDisabled('#mg-guardar'));
  await a.p.fill('#mg-nombre', '<img src=x onerror=alert(1)> Marta Pérez');
  await a.p.fill('#mg-telefono', '3001234567');
  await a.p.fill('#mg-cedula', '1020304050');
  await a.p.fill('#mg-notas', 'Prefiere llamada por la tarde');
  assert.ok(await a.p.isDisabled('#mg-guardar'));
  ok('sin consentimiento no se puede guardar');
  await a.p.check('#mg-consentimiento');
  assert.ok(await a.p.isEnabled('#mg-guardar'));
  await a.p.screenshot({ path: path.join(FUERA, 'g1-nueva.png') });
  await a.p.click('#mg-guardar');
  await a.p.waitForFunction(() => /Clienta guardada/.test(document.querySelector('#mg-mensaje').textContent));
  assert.equal(await a.p.inputValue('#mg-cedula'), '1020304050');
  assert.equal(await a.p.locator('#mg-contenido img').count(), 0);
  ok('crea la clienta; el nombre con HTML se muestra como texto, no se ejecuta');

  await a.p.selectOption('#mg-etapa', 'interesada');
  await a.p.click('#mg-guardar');
  await a.p.waitForFunction(() => /Cambios guardados/.test(document.querySelector('#mg-mensaje').textContent));
  assert.match(await a.p.textContent('.mg-historial'), /Nueva → Interesada|Interesada/);
  ok('cambiar la etapa deja registro en el historial');

  await a.p.fill('#mg-rec-texto', 'Llamar para confirmar pedido');
  await a.p.click('#mg-rec-form button[type="submit"]');
  await a.p.waitForSelector('.mg-recs li input[type="checkbox"]');
  assert.match(await a.p.textContent('.mg-recs'), /Llamar para confirmar pedido/);
  ok('agrega un recordatorio');

  await a.p.click('#mg-contenido .mg-ficha-cabecera button');
  await a.p.waitForSelector('#mg-lista');
  const fila = await a.p.textContent('#mg-lista');
  assert.match(fila, /Marta/);
  assert.ok(!/1020304050|3001234567/.test(fila), 'la lista no muestra cédula ni teléfono completo');
  assert.match(fila, /4567/);
  assert.ok(!/\bnull\b|undefined/.test(await a.p.textContent('#manager-area')), 'la lista no debe mostrar "null" ni "undefined"');
  await a.p.fill('#mg-buscar', 'zzz');
  await a.p.waitForFunction(() => /No hay clientas que coincidan/.test(document.querySelector('#mg-contenido').textContent));
  await a.p.fill('#mg-buscar', 'Marta');
  await a.p.waitForSelector('#mg-lista');
  ok('la lista solo muestra los últimos 4 dígitos del teléfono y filtra por nombre');

  await a.p.click('.mg-pestana[data-vista="recordatorios"]');
  await a.p.waitForSelector('.mg-grupo');
  assert.match(await a.p.textContent('#mg-contenido'), /Para hoy \(1\)/);
  await a.p.screenshot({ path: path.join(FUERA, 'g2-recordatorios.png') });
  await a.p.locator('.mg-grupo input[type="checkbox"]').first().check();
  await a.p.waitForFunction(() => /Para hoy \(0\)/.test(document.querySelector('#mg-contenido').textContent));
  ok('recordatorios agrupados; marcar uno como hecho lo saca de la lista');

  assert.equal(await a.p.locator('.mg-pestana[data-vista="soporte"]').count(), 0);
  ok('una usuaria común no ve la pestaña Soporte');

  // ---- Redacción asistida ----
  await a.p.click('.mg-pestana[data-vista="lista"]');
  await a.p.waitForSelector('#mg-lista .mg-fila');
  await a.p.click('#mg-lista .mg-fila');
  await a.p.waitForSelector('#mg-redactar');
  // el nombre de la prueba de seguridad (con HTML) se cambia por uno normal para probar la redacción
  await a.p.fill('#mg-nombre', 'Marta Pérez');
  await a.p.click('#mg-guardar');
  await a.p.waitForFunction(() => /Cambios guardados/.test(document.querySelector('#mg-mensaje').textContent));
  assert.ok(await a.p.isVisible('#mg-red-ir'));
  assert.ok(!(await a.p.isVisible('#mg-red-mensaje')));
  assert.match(await a.p.textContent('#mg-redactar'), /solo su primer nombre.*sin teléfonos, cédulas ni direcciones/);
  // el estilo se puede elegir; por defecto es el cercano
  assert.equal(await a.p.inputValue('#mg-red-estilo'), 'cercano');
  assert.deepEqual(await a.p.locator('#mg-red-estilo option').allTextContents(), ['Cercano y cálido', 'Formal y respetuoso (usted)', 'Breve y directo', 'Entusiasta y motivador']);
  await a.p.click('#mg-red-ir');
  await a.p.waitForSelector('#mg-red-borrador:visible');
  assert.match(llamadasIA.at(-1), /Tono cercano y cálido/);
  assert.match(await a.p.inputValue('#mg-red-borrador'), /^Hola Marta/);
  assert.match(await a.p.textContent('#mg-red-estado'), /No se guarda/);
  const enviado = llamadasIA.join('|');
  for (const x of ['1020304050', '3001234567', 'Pérez']) assert.ok(!enviado.includes(x), `la IA no debe recibir ${x}`);
  assert.match(enviado, /Marta/);
  await a.p.screenshot({ path: path.join(FUERA, 'g5-redactar.png') });
  ok('redactar seguimiento: borrador editable; la IA recibió solo el primer nombre, sin cédula, teléfono ni apellido');

  await a.p.fill('#mg-red-borrador', 'Hola Marta, mensaje editado por mí.');
  await a.ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  await a.p.click('#mg-red-copiar');
  await a.p.waitForFunction(() => /Copiado/.test(document.querySelector('#mg-red-estado').textContent));
  assert.equal(await a.p.evaluate(() => navigator.clipboard.readText()), 'Hola Marta, mensaje editado por mí.');
  ok('copiar deja en el portapapeles el texto editado, no el original');

  await a.p.selectOption('#mg-red-estilo', 'formal');
  await a.p.click('#mg-red-ir');
  await a.p.waitForFunction(() => /^Hola Marta/.test(document.querySelector('#mg-red-borrador').value));
  assert.match(llamadasIA.at(-1), /Tono formal y respetuoso, tratando de usted/);
  assert.equal(await a.p.evaluate(() => localStorage.getItem('mg-estilo')), 'formal');
  ok('el estilo elegido viaja al modelo y la pantalla lo recuerda la próxima vez');

  await a.p.selectOption('#mg-red-tipo', 'respuesta');
  assert.ok(await a.p.isVisible('#mg-red-mensaje'));
  await a.p.click('#mg-red-ir');
  await a.p.waitForFunction(() => /Pega el mensaje de la clienta/.test(document.querySelector('#mg-red-estado').textContent));
  await a.p.fill('#mg-red-mensaje', '¿Cuánto vale? Mi número es 3109998877');
  await a.p.fill('#mg-red-indic', 'dile que confirmo el valor');
  const antes = llamadasIA.length;
  await a.p.click('#mg-red-ir');
  await a.p.waitForFunction(n => /^Hola Marta/.test(document.querySelector('#mg-red-borrador').value), 0);
  await a.p.waitForFunction(() => /Revisa el borrador/.test(document.querySelector('#mg-red-estado').textContent));
  assert.equal(llamadasIA.length, antes + 1);
  assert.ok(!llamadasIA.at(-1).includes('3109998877'), 'el teléfono pegado en el mensaje de la clienta no sale al proveedor');
  assert.match(llamadasIA.at(-1), /confirmo el valor/);
  ok('responder a la clienta: exige pegar su mensaje y enmascara el teléfono que venga dentro');

  await a.p.fill('#mg-red-indic', 'TRAMPA');
  await a.p.click('#mg-red-ir');
  await a.p.waitForFunction(() => /plantilla/.test(document.querySelector('#mg-red-estado').textContent));
  assert.match(await a.p.inputValue('#mg-red-borrador'), /^Buen día, Marta\. Gracias por escribirme/);   // estilo formal elegido: la plantilla trata de usted
  assert.ok(!/3105551234/.test(await a.p.inputValue('#mg-red-borrador')));
  ok('si la IA incumple las reglas, la pantalla muestra la plantilla y lo avisa (nunca el texto rechazado)');

  gasto.registrar({ entrada: 0, salida: 30_000_000 });   // pasa el tope mensual
  await a.p.fill('#mg-red-indic', '');
  await a.p.click('#mg-red-ir');
  await a.p.waitForFunction(() => /límite mensual/.test(document.querySelector('#mg-red-estado').textContent));
  assert.ok(!(await a.p.isVisible('#mg-red-resultado')));
  ok('al llegar al tope mensual de gasto la pantalla lo explica y no muestra borrador');
  assert.ok(!/\bnull\b|undefined/.test(await a.p.textContent('#manager-area')));

  // Salir del módulo vacía los datos personales del DOM
  await a.p.click('.mg-pestana[data-vista="lista"]');
  await a.p.waitForSelector('#mg-lista');
  await a.p.click('#back-home');
  assert.equal(await a.p.evaluate(() => document.getElementById('manager-area').children.length), 0);
  assert.ok(!(await a.p.content()).includes('Marta'));
  ok('al salir del Gestor no queda ningún dato personal en la pantalla');

  // Exportar y borrar
  await a.p.click('.card[data-module="manager"]');
  await a.p.waitForSelector('#mg-lista');
  await a.p.click('#mg-lista .mg-fila');
  await a.p.waitForSelector('#mg-exportar');
  const [descarga] = await Promise.all([a.p.waitForEvent('download'), a.p.click('#mg-exportar')]);
  assert.match(descarga.suggestedFilename(), /^clienta-.*\.json$/);
  const datos = JSON.parse(fs.readFileSync(await descarga.path(), 'utf8'));
  assert.ok(JSON.stringify(datos).includes('Marta'));
  ok('descarga los datos de la clienta en JSON');
  await a.p.click('#mg-borrar');
  assert.ok(await a.p.isVisible('#mg-confirmar'));
  await a.p.click('#mg-confirmar-si');
  await a.p.waitForFunction(() => /Clienta borrada/.test(document.querySelector('#mg-mensaje').textContent));
  assert.equal(await a.p.locator('#mg-lista').count(), 0);
  ok('borrar pide confirmación y elimina la ficha');
  assert.deepEqual(await a.p.evaluate(() => window.__csp), []);
  ok('sin violaciones de la política de seguridad (CSP)');
  await a.ctx.close();

  // ---------- Sin permiso ----------
  const s = await contexto();
  await entrar(s.p, 'sola');
  await s.p.waitForSelector('#sin-permiso:not(.hidden)');
  assert.equal(await s.p.evaluate(() => document.getElementById('manager-area').children.length), 0);
  ok('una usuaria sin el módulo Gestor ve el aviso de permiso y ninguna pantalla');
  await s.ctx.close();

  // ---------- Administradora: soporte de solo lectura ----------
  const dueña = await contexto();
  await entrar(dueña.p, 'ana');
  await dueña.p.waitForSelector('#mg-nueva');
  await dueña.p.click('#mg-nueva');
  await dueña.p.fill('#mg-nombre', 'Clienta de Ana');
  await dueña.p.fill('#mg-telefono', '3109876543');
  await dueña.p.check('#mg-consentimiento');
  await dueña.p.click('#mg-guardar');
  await dueña.p.waitForFunction(() => /Clienta guardada/.test(document.querySelector('#mg-mensaje').textContent));
  await dueña.ctx.close();

  const adm = await contexto();
  await entrar(adm.p, 'jefa');
  await adm.p.waitForSelector('.mg-pestana[data-vista="soporte"]');
  await adm.p.click('.mg-pestana[data-vista="soporte"]');
  await adm.p.waitForSelector('#mg-usuaria');
  await adm.p.selectOption('#mg-usuaria', 'ana');
  await adm.p.click('#mg-ver-usuaria');
  await adm.p.waitForSelector('#mg-modo:not(.hidden)');
  assert.match(await adm.p.textContent('#mg-modo'), /solo lectura.*ana/i);
  assert.equal(await adm.p.locator('#mg-nueva').count(), 0);
  await adm.p.click('#mg-lista .mg-fila');
  await adm.p.waitForSelector('#mg-form');
  assert.ok(await adm.p.isDisabled('#mg-nombre'));
  assert.equal(await adm.p.locator('#mg-guardar').count(), 0);
  assert.equal(await adm.p.locator('#mg-redactar').count(), 0);
  assert.equal(await adm.p.locator('#mg-borrar').count(), 0);
  await adm.p.screenshot({ path: path.join(FUERA, 'g3-soporte.png') });
  ok('modo soporte: la administradora ve las clientas de otra usuaria sin poder crear, editar ni borrar');
  await adm.p.click('.mg-pestana[data-vista="soporte"]');
  await adm.p.waitForSelector('.mg-tabla');
  assert.match(await adm.p.textContent('.mg-tabla'), /jefa/);
  ok('cada consulta de soporte queda en el registro de accesos');
  await adm.ctx.close();

  // ---------- Celular ----------
  const m = await contexto(390);
  await entrar(m.p, 'ana');
  await m.p.waitForSelector('#mg-indicadores .mg-kpi');
  await m.p.click('#mg-lista .mg-fila');
  await m.p.waitForSelector('#mg-form');
  const desborde = await m.p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(desborde <= 1, `desborde horizontal de ${desborde}px`);
  await m.p.screenshot({ path: path.join(FUERA, 'g4-celular.png') });
  ok('en pantalla de celular (390 px) no hay desborde horizontal');
  await m.ctx.close();

  await navegador.close();
  servidor.close();
  assert.deepEqual(problemas, [], 'errores en consola/página: ' + problemas.join(' | '));
  ok('sin errores de consola ni de página');
  console.log('TODO BIEN');
  process.exit(0);
})().catch(e => { console.error('FALLÓ:', e.message); process.exit(1); });
