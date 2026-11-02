'use strict';
// Prueba de extremo a extremo (Chromium real) de la administración de usuarios. Datos ficticios; archivo usuarios.json temporal.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const base = path.join(__dirname, process.env.CODIGO || 'asistente-v2');
const { crearServidor } = require(path.join(base, 'src/server'));
const { crearAuth, crearRegistroUsuario } = require(path.join(base, 'src/auth'));
const { crearGuardado, leerUsuarios } = require(path.join(base, 'src/usuarios-archivo'));
const { crearLimites } = require(path.join(base, 'src/limites'));
const { crearCatalogo } = require(path.join(base, 'src/catalogo'));
const { productos, campana } = require(path.join(base, 'test/fixtures'));
const FUERA = path.join(__dirname, 'capturas');
fs.mkdirSync(FUERA, { recursive: true });
const CLAVE = 'clave-de-prueba-123';

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-usuarios-'));
  const ruta = path.join(dir, 'usuarios.json');
  const reg = await crearRegistroUsuario(CLAVE);
  fs.writeFileSync(ruta, JSON.stringify({ usuarios: { jefa: { ...reg, modulos: ['sales', 'content'], rol: 'admin' }, ana: { ...reg, modulos: ['sales'] } } }), { mode: 0o600 });
  const { usuarios, resto } = leerUsuarios(ruta);
  const servidor = crearServidor({
    auth: crearAuth({ usuarios, guardar: crearGuardado(ruta, resto) }), limites: crearLimites({ porMinuto: 60, porDia: 500 }),
    catalogo: crearCatalogo({ productos, campana, hoy: () => '2026-10-27' }),
    responderes: { sales: async ({ mensaje }) => ({ respuesta: `Eco: ${mensaje}`, advertencias: [], uso: {} }) },
    publicDir: path.join(base, 'public'), log: () => {}
  });
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${servidor.address().port}`;
  const navegador = await chromium.launch();
  const resultados = [];
  const ok = n => { resultados.push(n); console.log('OK  ', n); };
  const problemas = [];
  const contexto = async (ancho = 1280) => {
    const ctx = await navegador.newContext({ viewport: { width: ancho, height: 900 } });
    const p = await ctx.newPage();
    await p.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI)); });
    p.on('pageerror', e => problemas.push('pageerror: ' + e.message));
    p.on('console', m => { if (m.type() === 'error' && !/yanbal-logo|favicon|404|status of (400|401|403|409|429)/.test(m.text())) problemas.push('console: ' + m.text()); });
    return { ctx, p };
  };
  const entrarComercial = async (p, usuario, clave) => {
    await p.goto(url);
    await p.click('.card[data-module="sales"]');
    await p.waitForSelector('#login-form:not(.hidden)');
    await p.fill('#login-user', usuario);
    await p.fill('#login-pass', clave);
    await p.click('#login-submit');
  };

  // ---------- Administradora ----------
  const adm = await contexto();
  await entrarComercial(adm.p, 'jefa', CLAVE);
  await adm.p.waitForSelector('#chat-area:not(.hidden)');
  assert.ok(await adm.p.isVisible('#nav-users'));
  ok('la administradora ve el menú Usuarios al iniciar sesión');

  await adm.p.click('#nav-users');
  await adm.p.waitForSelector('#us-lista tr[data-usuario="ana"]');
  assert.ok(!(await adm.p.isVisible('#chat-area')));
  assert.equal(await adm.p.textContent('#workspace-title'), 'Usuarios');
  const filaJefa = adm.p.locator('tr[data-usuario="jefa"]');
  assert.match(await filaJefa.textContent(), /\(tú\)/);
  assert.equal(await filaJefa.locator('[data-accion="estado"]').count(), 0);
  assert.equal(await filaJefa.locator('[data-accion="clave"]').count(), 0);
  assert.match(await adm.p.locator('tr[data-usuario="ana"]').textContent(), /Usuaria.*Asistente comercial.*Activo/);
  await adm.p.screenshot({ path: path.join(FUERA, 'u1-lista.png') });
  ok('lista de usuarios: estado, rol y módulos; sin acciones peligrosas sobre su propia cuenta');

  // Crear usuario
  await adm.p.fill('#us-nuevo-usuario', 'Beto');
  await adm.p.fill('#us-nuevo-clave', 'corta');
  await adm.p.click('#us-crear');
  assert.match(await adm.p.textContent('#us-mensaje'), /al menos 12 caracteres/);
  await adm.p.fill('#us-nuevo-clave', 'temporal-12345');
  await adm.p.check('#us-nuevo-content');
  await adm.p.click('#us-crear');
  await adm.p.waitForSelector('tr[data-usuario="beto"]');
  assert.match(await adm.p.textContent('#us-mensaje'), /Usuario beto creado/);
  assert.match(await adm.p.locator('tr[data-usuario="beto"]').textContent(), /Clave temporal pendiente de cambio.*Asistente comercial, Estudio de contenido/s);
  assert.equal(await adm.p.inputValue('#us-nuevo-clave'), ''); // el campo de clave se vacía
  await adm.p.screenshot({ path: path.join(FUERA, 'u2-creado.png') });
  ok('crear usuario: valida la clave, lo crea, queda "clave temporal pendiente" y el campo de clave se vacía');
  await adm.p.fill('#us-nuevo-usuario', 'beto');
  await adm.p.fill('#us-nuevo-clave', 'temporal-12345');
  await adm.p.click('#us-crear');
  await adm.p.waitForFunction(() => /ya existe/.test(document.getElementById('us-mensaje').textContent));
  ok('un usuario repetido se rechaza con un mensaje claro');

  // ---------- Beto entra con la clave temporal ----------
  const beto = await contexto();
  await entrarComercial(beto.p, 'beto', 'temporal-12345');
  await beto.p.waitForSelector('#cuenta-form');
  assert.ok(await beto.p.isVisible('#cuenta-area'));
  assert.ok(!(await beto.p.isVisible('#chat-area')));
  assert.equal(await beto.p.locator('#cuenta-cancelar').count(), 0);
  assert.ok(!(await beto.p.isVisible('#nav-users')));
  assert.ok(!(await beto.p.isVisible('#change-pass')));
  await beto.p.screenshot({ path: path.join(FUERA, 'u3-clave-obligatoria.png') });
  ok('con clave temporal solo ve el cambio de clave: sin chat, sin cancelar y sin menú Usuarios');

  await beto.p.fill('#cuenta-actual', 'temporal-12345');
  await beto.p.fill('#cuenta-nueva', 'definitiva-67890');
  await beto.p.fill('#cuenta-repetir', 'otra-distinta-123');
  await beto.p.click('#cuenta-guardar');
  assert.match(await beto.p.textContent('#cuenta-mensaje'), /no coinciden/);
  await beto.p.fill('#cuenta-actual', 'equivocada-1234');
  await beto.p.fill('#cuenta-nueva', 'definitiva-67890');
  await beto.p.fill('#cuenta-repetir', 'definitiva-67890');
  await beto.p.click('#cuenta-guardar');
  await beto.p.waitForFunction(() => /actual no es correcta/.test(document.getElementById('cuenta-mensaje').textContent));
  assert.equal(await beto.p.inputValue('#cuenta-nueva'), '');
  ok('errores del cambio de clave: no coinciden y clave actual incorrecta; los campos se vacían');

  await beto.p.fill('#cuenta-actual', 'temporal-12345');
  await beto.p.fill('#cuenta-nueva', 'definitiva-67890');
  await beto.p.fill('#cuenta-repetir', 'definitiva-67890');
  await beto.p.click('#cuenta-guardar');
  await beto.p.waitForSelector('#chat-area:not(.hidden)');
  assert.ok(!(await beto.p.isVisible('#cuenta-area')));
  await beto.p.fill('#message-input', 'hola desde beto');
  await beto.p.click('#send');
  await beto.p.waitForFunction(() => /Eco: hola desde beto/.test(document.getElementById('chat-log').textContent));
  ok('al cambiar la clave temporal queda libre el módulo y el chat responde');

  // Cambio voluntario desde la barra de sesión, con cancelar
  await beto.p.click('#change-pass');
  await beto.p.waitForSelector('#cuenta-cancelar');
  await beto.p.click('#cuenta-cancelar');
  await beto.p.waitForSelector('#chat-area:not(.hidden)');
  ok('"Cambiar mi clave" desde la barra de sesión se puede cancelar y vuelve al chat');

  // ---------- Inactivar a Beto ----------
  await adm.p.locator('tr[data-usuario="beto"] [data-accion="estado"]').click();
  await adm.p.click('#us-confirmar-estado');
  await adm.p.waitForFunction(() => /beto quedó inactivo/.test(document.getElementById('us-mensaje').textContent));
  assert.match(await adm.p.locator('tr[data-usuario="beto"]').textContent(), /Inactivo/);
  await beto.p.fill('#message-input', 'sigues ahí');
  await beto.p.click('#send');
  await beto.p.waitForSelector('#login-form:not(.hidden)');
  assert.match(await beto.p.textContent('#login-error'), /sesión terminó/);
  await beto.p.fill('#login-user', 'beto');
  await beto.p.fill('#login-pass', 'definitiva-67890');
  await beto.p.click('#login-submit');
  await beto.p.waitForFunction(() => document.getElementById('login-error').textContent === 'Usuario o clave incorrectos.');
  ok('inactivar: la sesión abierta se cierra y no puede volver a entrar (mensaje genérico)');
  await adm.p.screenshot({ path: path.join(FUERA, 'u4-inactivo.png') });

  await adm.p.locator('tr[data-usuario="beto"] [data-accion="estado"]').click();
  await adm.p.click('#us-confirmar-estado');
  await adm.p.waitForFunction(() => /beto quedó activo/.test(document.getElementById('us-mensaje').textContent));
  await beto.p.click('#login-submit');
  await beto.p.waitForSelector('#chat-area:not(.hidden)');
  ok('reactivar: vuelve a entrar con su clave');

  // ---------- Restablecer la clave de Ana ----------
  const ana = await contexto();
  await entrarComercial(ana.p, 'ana', CLAVE);
  await ana.p.waitForSelector('#chat-area:not(.hidden)');
  assert.ok(!(await ana.p.isVisible('#nav-users')));
  ok('una usuaria común no ve el menú Usuarios');
  await adm.p.locator('tr[data-usuario="ana"] [data-accion="clave"]').click();
  await adm.p.fill('#us-rein-clave', 'nueva-temporal-99');
  await adm.p.click('#us-form-reinicio button[type="submit"]');
  await adm.p.waitForFunction(() => /Clave temporal puesta a ana/.test(document.getElementById('us-mensaje').textContent));
  assert.equal(await adm.p.locator('#us-rein-clave').count(), 0);
  await ana.p.fill('#message-input', 'hola');
  await ana.p.click('#send');
  await ana.p.waitForSelector('#login-form:not(.hidden)');
  ok('restablecer clave: la sesión de la persona se cierra y deberá usar la clave temporal');

  // ---------- Editar módulos ----------
  await adm.p.locator('tr[data-usuario="ana"] [data-accion="editar"]').click();
  await adm.p.check('#us-ed-content');
  await adm.p.click('#us-form-edicion button[type="submit"]');
  await adm.p.waitForFunction(() => /Cambios guardados para ana/.test(document.getElementById('us-mensaje').textContent));
  assert.match(await adm.p.locator('tr[data-usuario="ana"]').textContent(), /Asistente comercial, Estudio de contenido/);
  ok('editar módulos y rol');

  // ---------- Archivo, CSP y limpieza ----------
  const archivo = fs.readFileSync(ruta, 'utf8');
  assert.ok(!/temporal-12345|definitiva-67890|nueva-temporal-99|clave-de-prueba/.test(archivo));
  assert.equal(fs.statSync(ruta).mode & 0o777, 0o600);
  ok('el archivo usuarios.json no contiene claves en claro y tiene permisos 600');

  await adm.p.click('#logout');
  await adm.p.waitForSelector('#login-form:not(.hidden)');
  assert.equal((await adm.p.locator('#users-area').innerHTML()).trim(), '');
  assert.ok(!(await adm.p.isVisible('#nav-users')));
  ok('al cerrar sesión se vacía la pantalla de usuarios y desaparece el menú');

  for (const c of [adm, beto, ana]) {
    const violaciones = await c.p.evaluate(() => window.__csp);
    assert.deepEqual(violaciones, []);
  }
  ok('ninguna violación de la política de seguridad de contenido (CSP)');

  // ---------- Celular ----------
  const movil = await contexto(390);
  await entrarComercial(movil.p, 'jefa', CLAVE);
  await movil.p.waitForSelector('#chat-area:not(.hidden)');
  await movil.p.evaluate(() => document.getElementById('nav-users').click());
  await movil.p.waitForSelector('#us-lista tr[data-usuario="ana"]');
  const anchoDoc = await movil.p.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(anchoDoc <= 392, `desborde horizontal en celular: ${anchoDoc}px`);
  await movil.p.screenshot({ path: path.join(FUERA, 'u5-celular.png') });
  ok('en celular (390 px) la lista no desborda horizontalmente');

  assert.deepEqual(problemas, []);
  ok('sin errores de script ni de consola');
  await navegador.close();
  await new Promise(r => servidor.close(r));
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${resultados.length} comprobaciones de navegador aprobadas`);
})().catch(e => { console.error('FALLÓ:', e.message); process.exit(1); });
