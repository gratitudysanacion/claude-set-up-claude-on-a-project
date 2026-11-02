'use strict';
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const base = path.join(__dirname, 'asistente-v2');
const { crearServidor } = require(path.join(base, 'src/server'));
const { crearAuth, crearRegistroUsuario } = require(path.join(base, 'src/auth'));
const { crearLimites } = require(path.join(base, 'src/limites'));
const { crearCatalogo } = require(path.join(base, 'src/catalogo'));
const { productos, campana } = require(path.join(base, 'test/fixtures'));
(async () => {
  const reg = await crearRegistroUsuario('clave-de-prueba-123');
  const servidor = crearServidor({ auth: crearAuth({ usuarios: { ana: { ...reg, modulos: ['manager'] } } }), limites: crearLimites({ porMinuto: 60 }),
    catalogo: crearCatalogo({ productos, campana, hoy: () => '2026-10-27' }), responderes: {}, gestor: null, publicDir: path.join(base, 'public'), log: () => {} });
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  const n = await chromium.launch(); const p = await n.newPage();
  await p.goto(`http://127.0.0.1:${servidor.address().port}`);
  await p.click('.card[data-module="manager"]');
  await p.fill('#login-user', 'ana'); await p.fill('#login-pass', 'clave-de-prueba-123'); await p.click('#login-submit');
  await p.waitForFunction(() => /no está disponible/.test(document.querySelector('#mg-mensaje') ? document.querySelector('#mg-mensaje').textContent : ''));
  assert.equal(await p.locator('#mg-nueva').count(), 0);
  console.log('OK   sin Gestor activo (Node 18) la pantalla lo explica y no ofrece guardar nada');
  await n.close(); servidor.close(); process.exit(0);
})().catch(e => { console.error('FALLÓ', e.message); process.exit(1); });
