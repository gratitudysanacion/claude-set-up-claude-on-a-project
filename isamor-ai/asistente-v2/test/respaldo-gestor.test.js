'use strict';
// Respaldo y restauración de la base del Gestor: copia consistente con otro proceso escribiendo, verificación, permisos,
// retención por número, llave equivocada y restauración segura. Datos ficticios.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { sqliteDisponible, abrirBase, crearGestor } = require('../src/gestor');
const { crearCifrado, generarLlaveHex } = require('../src/cifrado');
const { respaldar, verificarCopia, listarCopias } = require('../scripts/respaldar-gestor');
const { restaurar } = require('../scripts/restaurar-gestor');

const conSqlite = { skip: sqliteDisponible() ? false : 'node:sqlite no disponible en esta versión de Node' };
const raiz = path.join(__dirname, '..');
const ana = { usuario: 'ana', esAdmin: false };
const NOMBRE_SECRETO = 'Zulema Secretísima';
const carpeta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'resp-gestor-'));
const modo = ruta => (fs.statSync(ruta).mode & 0o777).toString(8);
const script = (nombre, args, env = {}) => spawnSync(process.execPath, ['--no-warnings', path.join(raiz, 'scripts', nombre), ...args], { encoding: 'utf8', env: { ...process.env, ...env } });

function baseConClientas(dir, llave, cuantas = 3) {
  const ruta = path.join(dir, 'gestor.db');
  const db = abrirBase(ruta);
  const g = crearGestor({ db, cifrado: crearCifrado(llave) });
  for (let i = 0; i < cuantas; i++) {
    g.crearClienta(ana, { nombre: i === 0 ? NOMBRE_SECRETO : `Clienta ${i}`, telefono: `30012345${60 + i}`, cedula: '1020304050', notas: 'nota', consentimiento: true });
  }
  return { ruta, db, g };
}

test('respaldar: copia consistente, verificada, 600 en carpeta 700, sin datos personales en la salida', conSqlite, () => {
  const dir = carpeta();
  try {
    const { ruta, db } = baseConClientas(dir, generarLlaveHex());
    const destino = path.join(dir, 'respaldos');
    const r = script('respaldar-gestor.js', ['--origen', ruta, '--destino', destino]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /OK gestor-\d{8}-\d{6}\.db \(3 clientas/);
    assert.ok(!r.stdout.includes(NOMBRE_SECRETO) && !r.stderr.includes(NOMBRE_SECRETO));
    assert.equal(modo(destino), '700');
    const copias = fs.readdirSync(destino);
    assert.equal(copias.length, 1, 'no deben quedar temporales');
    assert.equal(modo(path.join(destino, copias[0])), '600');
    assert.deepEqual(verificarCopia(path.join(destino, copias[0])), { clientas: 3, version: 1 });
    db.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('respaldar: incluye lo que aún está en el archivo -wal (la copia directa de gestor.db lo perdería)', conSqlite, () => {
  const dir = carpeta();
  try {
    const { ruta, db } = baseConClientas(dir, generarLlaveHex(), 2);
    assert.ok(fs.existsSync(ruta + '-wal') && fs.statSync(ruta + '-wal').size > 0, 'la prueba necesita datos pendientes en el -wal');
    const solo = path.join(dir, 'solo-principal.db');
    fs.copyFileSync(ruta, solo);   // lo que haría un respaldo ingenuo
    assert.throws(() => verificarCopia(solo), /falta la tabla|dañada/, 'la copia ingenua queda inservible: sin el -wal ni siquiera existen las tablas');
    const r = respaldar({ origen: ruta, destino: path.join(dir, 'r') });
    assert.equal(r.clientas, 2);
    db.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('respaldar: con otro PROCESO escribiendo sin parar, cada copia es íntegra', conSqlite, async () => {
  const dir = carpeta();
  try {
    const { ruta, db } = baseConClientas(dir, generarLlaveHex(), 1);
    db.close();
    const escritor = spawn(process.execPath, ['--no-warnings', '-e', `
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(process.argv[1]); db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
      const hasta = Date.now() + 2500; let n = 0;
      while (Date.now() < hasta) { db.prepare("INSERT INTO accesos (fecha, actor, duena, accion) VALUES ('x','a','b','c')").run(); n++; }
      process.stdout.write(String(n)); `, ruta], { stdio: ['ignore', 'pipe', 'inherit'] });
    await new Promise(r => setTimeout(r, 300));
    const destino = path.join(dir, 'r');
    for (let i = 0; i < 6; i++) {
      respaldar({ origen: ruta, destino, conservar: 10, ahora: () => new Date(Date.UTC(2026, 10, 2, 8, 0, i)) });
      await new Promise(r => setTimeout(r, 200));
    }
    await new Promise(r => escritor.on('close', r));
    const copias = listarCopias(destino);
    assert.equal(copias.length, 6);
    for (const c of copias) assert.equal(verificarCopia(path.join(destino, c)).clientas, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('respaldar: la retención es por número, conserva las más recientes y no toca otros archivos', conSqlite, () => {
  const dir = carpeta();
  try {
    const { ruta, db } = baseConClientas(dir, generarLlaveHex(), 1);
    const destino = path.join(dir, 'r');
    fs.mkdirSync(destino);
    fs.writeFileSync(path.join(destino, 'otro.txt'), 'x');
    for (let i = 1; i <= 5; i++) respaldar({ origen: ruta, destino, conservar: 3, ahora: () => new Date(Date.UTC(2026, 10, i, 8, 0, 0)) });
    assert.deepEqual(listarCopias(destino), ['gestor-20261103-080000.db', 'gestor-20261104-080000.db', 'gestor-20261105-080000.db']);
    assert.ok(fs.existsSync(path.join(destino, 'otro.txt')));
    // dos copias en el mismo segundo no se pisan
    const a = respaldar({ origen: ruta, destino, conservar: 10, ahora: () => new Date(Date.UTC(2026, 10, 9, 8, 0, 0)) });
    const b = respaldar({ origen: ruta, destino, conservar: 10, ahora: () => new Date(Date.UTC(2026, 10, 9, 8, 0, 0)) });
    assert.notEqual(a.archivo, b.archivo);
    // --conservar demasiado bajo se rechaza
    assert.equal(script('respaldar-gestor.js', ['--origen', ruta, '--destino', destino, '--conservar', '1']).status, 1);
    db.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('respaldar: una base dañada falla, no deja temporales y NO borra las copias buenas', conSqlite, () => {
  const dir = carpeta();
  try {
    const { ruta, db } = baseConClientas(dir, generarLlaveHex(), 1);
    const destino = path.join(dir, 'r');
    for (let i = 1; i <= 3; i++) respaldar({ origen: ruta, destino, conservar: 3, ahora: () => new Date(Date.UTC(2026, 10, i, 8, 0, 0)) });
    db.close();
    const mala = path.join(dir, 'mala.db');
    fs.writeFileSync(mala, 'esto no es una base de datos SQLite '.repeat(200));
    const r = script('respaldar-gestor.js', ['--origen', mala, '--destino', destino, '--conservar', '3']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /ERROR/);
    assert.equal(fs.readdirSync(destino).length, 3, 'no debe haber temporales ni borrados');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('respaldar: si todavía no existe la base, termina bien y lo dice', conSqlite, () => {
  const dir = carpeta();
  try {
    const r = script('respaldar-gestor.js', ['--origen', path.join(dir, 'no-existe.db'), '--destino', path.join(dir, 'r')]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Aún no hay base/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('restaurar (ensayo): verifica la copia y la llave; con llave equivocada o sin llave aborta sin tocar nada', conSqlite, () => {
  const dir = carpeta();
  try {
    const llave = generarLlaveHex();
    const { ruta, db } = baseConClientas(dir, llave);
    const r = respaldar({ origen: ruta, destino: path.join(dir, 'r') });
    const copia = path.join(dir, 'r', r.archivo);
    assert.deepEqual(restaurar({ copia, destino: ruta, llaveHex: llave }), { estado: 'ensayo', clientas: 3, llave_probada: 3, existe_actual: true });
    assert.throws(() => restaurar({ copia, destino: ruta, llaveHex: generarLlaveHex(), aplicar: true, asistenteDetenido: true }), /NO descifra/);
    assert.throws(() => restaurar({ copia, destino: ruta, llaveHex: undefined }), /No hay GESTOR_LLAVE/);
    assert.throws(() => restaurar({ copia: path.join(dir, 'nada.db'), destino: ruta, llaveHex: llave }), /No existe la copia/);
    db.close();
    assert.deepEqual(fs.readdirSync(dir).sort(), ['gestor.db', 'gestor.db-shm', 'gestor.db-wal', 'r'].filter(n => fs.existsSync(path.join(dir, n))).sort());
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('restaurar: exige --asistente-detenido, guarda la base actual y descarta los -wal/-shm viejos', conSqlite, () => {
  const dir = carpeta();
  try {
    const llave = generarLlaveHex();
    const { ruta, db, g } = baseConClientas(dir, llave, 3);
    const rb = respaldar({ origen: ruta, destino: path.join(dir, 'r') });
    const copia = path.join(dir, 'r', rb.archivo);
    // después del respaldo se agregan 2 clientas más y se "daña" el estado actual
    g.crearClienta(ana, { nombre: 'Posterior 1', telefono: '3001111111', consentimiento: true });
    g.crearClienta(ana, { nombre: 'Posterior 2', telefono: '3002222222', consentimiento: true });
    assert.ok(fs.existsSync(ruta + '-wal'), 'hay un -wal vivo que no debe aplicarse sobre la base restaurada');
    assert.throws(() => restaurar({ copia, destino: ruta, llaveHex: llave, aplicar: true }), /--asistente-detenido/);

    const r = restaurar({ copia, destino: ruta, llaveHex: llave, aplicar: true, asistenteDetenido: true });
    db.close();
    assert.equal(r.estado, 'restaurada');
    assert.match(r.respaldo_actual, /^gestor\.db\.antes-restauracion-\d{8}-\d{6}$/);
    assert.equal(modo(ruta), '600');
    assert.equal(fs.existsSync(ruta + '-wal'), false);
    assert.equal(verificarCopia(ruta).clientas, 3, 'quedó el estado del respaldo');
    assert.equal(verificarCopia(path.join(dir, r.respaldo_actual)).clientas, 5, 'la base anterior se conservó íntegra');
    // y el Gestor la abre y descifra con la llave
    const g2 = crearGestor({ db: abrirBase(ruta), cifrado: crearCifrado(llave) });
    assert.equal(g2.listar(ana, {}).total, 3);
    assert.match(g2.listar(ana, {}).clientas.map(c => c.nombre).join('|'), new RegExp(NOMBRE_SECRETO));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('restaurar por línea de comandos: lee la llave del .env, no la imprime y exige los dos indicadores', conSqlite, () => {
  const dir = carpeta();
  try {
    const llave = generarLlaveHex();
    const { ruta, db } = baseConClientas(dir, llave, 2);
    const rb = respaldar({ origen: ruta, destino: path.join(dir, 'r') });
    db.close();
    const env = path.join(dir, '.env'); fs.writeFileSync(env, `GESTOR_LLAVE=${llave}\n`, { mode: 0o600 });
    const base = ['--copia', path.join(dir, 'r', rb.archivo), '--destino', ruta, '--env', env];
    const e = script('restaurar-gestor.js', base, { GESTOR_LLAVE: '' });
    assert.equal(e.status, 0, e.stderr);
    assert.match(e.stdout, /ENSAYO/);
    assert.ok(!e.stdout.includes(llave) && !e.stderr.includes(llave));
    assert.equal(script('restaurar-gestor.js', [...base, '--aplicar'], { GESTOR_LLAVE: '' }).status, 1);
    const ok = script('restaurar-gestor.js', [...base, '--aplicar', '--asistente-detenido'], { GESTOR_LLAVE: '' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /RESTAURADA/);
    assert.ok(!ok.stdout.includes(NOMBRE_SECRETO));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('respaldar: una carpeta de destino ya existente con permisos abiertos se cierra a 700', conSqlite, () => {
  const dir = carpeta();
  try {
    const { ruta, db } = baseConClientas(dir, generarLlaveHex(), 1);
    const destino = path.join(dir, 'abierta');
    fs.mkdirSync(destino, { mode: 0o755 }); fs.chmodSync(destino, 0o755);
    respaldar({ origen: ruta, destino });
    assert.equal(modo(destino), '700');
    db.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('verificarCopia: detecta una copia con páginas alteradas aunque se pueda abrir', conSqlite, () => {
  const dir = carpeta();
  try {
    const { DatabaseSync } = require('node:sqlite');
    const ruta = path.join(dir, 'c.db');
    const db = new DatabaseSync(ruta);
    db.exec('PRAGMA user_version = 1; CREATE TABLE clientas (id INTEGER PRIMARY KEY, a TEXT); CREATE INDEX ix ON clientas (a);');
    db.exec('CREATE TABLE historial_etapas (x); CREATE TABLE recordatorios (x); CREATE TABLE accesos (x);');
    const ins = db.prepare('INSERT INTO clientas (a) VALUES (?)');
    for (let i = 0; i < 3000; i++) ins.run(`valor-${i}-${'z'.repeat(40)}`);
    db.close();
    assert.equal(verificarCopia(ruta).clientas, 3000);
    // Se altera UNA de las dos copias del mismo valor (la de la tabla o la del índice): la base se sigue abriendo y contando,
    // pero deja de ser íntegra. Solo la comprobación de integridad lo detecta.
    const original = fs.readFileSync(ruta);
    const aguja = Buffer.from(`valor-1500-${'z'.repeat(40)}`);
    const posiciones = [];
    for (let desde = 0, p; (p = original.indexOf(aguja, desde)) >= 0; desde = p + 1) posiciones.push(p);
    assert.ok(posiciones.length >= 2, 'el valor debe estar en la tabla y en el índice');
    let detectada = 0;
    for (const p of posiciones) {
      const copia = Buffer.from(original);
      copia[p + 8] = copia[p + 8] === 0x41 ? 0x42 : 0x41;
      fs.writeFileSync(ruta, copia);
      try { verificarCopia(ruta); } catch (e) { if (/integridad/.test(e.message)) detectada++; }
    }
    assert.ok(detectada >= 1, 'la comprobación de integridad debe rechazar la copia alterada');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('restaurar: dos restauraciones en el mismo segundo guardan cada base anterior con un nombre distinto', conSqlite, () => {
  const dir = carpeta();
  try {
    const llave = generarLlaveHex();
    const { ruta, db } = baseConClientas(dir, llave, 2);
    const rb = respaldar({ origen: ruta, destino: path.join(dir, 'r') });
    db.close();
    const copia = path.join(dir, 'r', rb.archivo);
    const practica = path.join(dir, 'practica.db');
    const ahora = () => new Date(Date.UTC(2026, 10, 2, 5, 11, 6));
    const opciones = { copia, destino: practica, llaveHex: llave, aplicar: true, asistenteDetenido: true, ahora };
    restaurar(opciones);                       // crea la base de práctica
    const a = restaurar(opciones);             // guarda la anterior
    const b = restaurar(opciones);             // mismo segundo: no debe fallar ni pisar
    assert.notEqual(a.respaldo_actual, b.respaldo_actual);
    assert.match(b.respaldo_actual, /-2$/);
    assert.equal(fs.readdirSync(dir).filter(n => n.includes('antes-restauracion')).length, 2);
    assert.equal(verificarCopia(practica).clientas, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
