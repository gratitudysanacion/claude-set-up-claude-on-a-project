'use strict';
// «Mi estilo»: mensajes de ejemplo de la usuaria, cifrados, enmascarados y solo suyos. Migración del esquema 1 -> 2.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { crearGestor, abrirBase, sqliteDisponible, LIMITES_ESTILO } = require('../src/gestor');
const { crearCifrado, generarLlaveHex } = require('../src/cifrado');

const conSqlite = { skip: sqliteDisponible() ? false : 'node:sqlite no disponible en esta versión de Node' };
const ana = { usuario: 'ana', esAdmin: false };
const bea = { usuario: 'bea', esAdmin: false };
const jefa = { usuario: 'jefa', esAdmin: true };
const nuevo = () => { const db = abrirBase(':memory:'); return { db, g: crearGestor({ db, cifrado: crearCifrado(generarLlaveHex()) }) }; };

test('estilo: guardar y leer; cada usuaria tiene el suyo y la administradora no lee el de otra', conSqlite, () => {
  const { g } = nuevo();
  assert.deepEqual(g.obtenerEstilo(ana), { ejemplos: [], actualizado: null });
  const r = g.guardarEstilo(ana, ['  Hola linda, ¿cómo vas? 💖  ', 'Qué alegría saludarte', '']);
  assert.deepEqual(r.ejemplos, ['Hola linda, ¿cómo vas? 💖', 'Qué alegría saludarte']);
  assert.equal(r.enmascarados, false);
  assert.deepEqual(g.obtenerEstilo(ana).ejemplos, r.ejemplos);
  assert.deepEqual(g.obtenerEstilo(bea).ejemplos, [], 'otra usuaria no ve el de ana');
  assert.deepEqual(g.obtenerEstilo(jefa).ejemplos, [], 'la administradora lee solo el suyo');
  g.guardarEstilo(bea, ['Buen día']);
  assert.deepEqual(g.obtenerEstilo(ana).ejemplos, r.ejemplos);
  // reemplazar
  g.guardarEstilo(ana, ['Nuevo ejemplo']);
  assert.deepEqual(g.obtenerEstilo(ana).ejemplos, ['Nuevo ejemplo']);
  // borrar
  assert.deepEqual(g.borrarEstilo(ana), { ok: true });
  assert.deepEqual(g.obtenerEstilo(ana).ejemplos, []);
  assert.deepEqual(g.obtenerEstilo(bea).ejemplos, ['Buen día']);
});

test('estilo: se guarda cifrado (la base no contiene el texto) y atado a su dueña', conSqlite, () => {
  const { db, g } = nuevo();
  g.guardarEstilo(ana, ['Texto secretísimo de ana']);
  const fila = db.prepare('SELECT * FROM estilos').get();
  assert.ok(!JSON.stringify(fila).includes('secretísimo'));
  assert.match(fila.ejemplos_cif, /^v1:/);
  // copiado a otra usuaria no se puede descifrar
  db.prepare('UPDATE estilos SET usuaria = ?').run('bea');
  assert.throws(() => g.obtenerEstilo(bea), { codigo: 'descifrado_fallido' });
});

test('estilo: se enmascaran teléfonos, cédulas, correos y direcciones antes de guardar y se avisa', conSqlite, () => {
  const { db, g } = nuevo();
  const r = g.guardarEstilo(ana, ['Escríbeme al 300 123 4567 o a ana@correo.com', 'Visítame en Calle 45 #12-34', 'Sin datos']);
  assert.equal(r.enmascarados, true);
  assert.deepEqual(r.ejemplos, ['Escríbeme al [TELÉFONO] o a [CORREO]', 'Visítame en [DIRECCIÓN]', 'Sin datos']);
  const crudo = JSON.stringify(db.prepare('SELECT * FROM estilos').get());
  assert.ok(!/3001234567|ana@correo|Calle 45/.test(crudo));
});

test('estilo: límites de cantidad, largo y total; tipos inválidos; nada llega a guardarse', conSqlite, () => {
  const { g } = nuevo();
  const falla = (v, re) => assert.throws(() => g.guardarEstilo(ana, v), e => e.codigo === 'ejemplos_invalidos' && re.test(e.message));
  falla('texto', /lista de textos/);
  falla([1, 2], /lista de textos/);
  falla(undefined, /lista de textos/);
  falla([], /al menos un mensaje/);
  falla(['  ', ''], /al menos un mensaje/);
  falla(['a', 'b', 'c', 'd'], /Máximo 3/);
  falla(['x'.repeat(LIMITES_ESTILO.caracteres + 1)], /hasta 500/);
  falla(['x'.repeat(480), 'y'.repeat(480), 'z'.repeat(480)], /máximo 1200/);
  g.guardarEstilo(ana, ['x'.repeat(500), 'y'.repeat(400), 'z'.repeat(300)]);   // 1.200 justo
  assert.equal(g.obtenerEstilo(ana).ejemplos.length, 3);
  falla(['no cambia nada'.repeat(100)], /hasta 500/);
  assert.equal(g.obtenerEstilo(ana).ejemplos.length, 3, 'un intento inválido no toca lo guardado');
});

test('estilo: migración del esquema 1 al 2 sin perder clientas; un respaldo antiguo se abre y se actualiza', conSqlite, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'estilo-'));
  try {
    const ruta = path.join(dir, 'g.db');
    const llave = generarLlaveHex();
    let db = abrirBase(ruta);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 2);
    const g = crearGestor({ db, cifrado: crearCifrado(llave) });
    g.crearClienta(ana, { nombre: 'Clienta Uno', telefono: '3001234567', consentimiento: true });
    // se vuelve a dejar como la versión 1 (sin la tabla de estilos)
    db.exec('DROP TABLE estilos; PRAGMA user_version = 1;');
    db.close();
    db = abrirBase(ruta);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 2);
    const g2 = crearGestor({ db, cifrado: crearCifrado(llave) });
    assert.equal(g2.listar(ana, {}).total, 1, 'las clientas se conservan');
    assert.equal(g2.guardarEstilo(ana, ['ya funciona']).ejemplos.length, 1);
    db.close();
    db = abrirBase(ruta);   // reabrir no repite la migración ni falla
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 2);
    db.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
