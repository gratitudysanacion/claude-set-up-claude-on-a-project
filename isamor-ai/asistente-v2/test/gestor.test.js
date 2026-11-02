'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearCifrado, generarLlaveHex } = require('../src/cifrado');
const { enmascarar, primerNombre, resumenParaIA, contieneDatosSensibles } = require('../src/enmascarar');
const { crearGestor, abrirBase, sqliteDisponible, ETAPAS, LIMITES, TEXTO_CONSENTIMIENTO } = require('../src/gestor');

// SQLite integrado exige Node 22 o superior. En Node 18 estas pruebas se omiten (el Gestor tampoco arranca allí).
const conSqlite = { skip: sqliteDisponible() ? false : 'node:sqlite no disponible en esta versión de Node' };

// ---- Cifrado ----
test('cifrado: ida y vuelta, valor distinto cada vez, y vacío -> null', () => {
  const c = crearCifrado(generarLlaveHex());
  const a = c.cifrar('3001234567', 'ana|1|telefono');
  const b = c.cifrar('3001234567', 'ana|1|telefono');
  assert.notEqual(a, b);
  assert.ok(!a.includes('3001234567'));
  assert.equal(c.descifrar(a, 'ana|1|telefono'), '3001234567');
  assert.equal(c.cifrar('', 'x'), null);
  assert.equal(c.cifrar(null, 'x'), null);
  assert.equal(c.descifrar(null, 'x'), null);
});

test('cifrado: contexto distinto, llave distinta o dato alterado -> no se descifra', () => {
  const c = crearCifrado(generarLlaveHex());
  const dato = c.cifrar('1020304050', 'ana|1|cedula');
  assert.throws(() => c.descifrar(dato, 'ana|2|cedula'), { codigo: 'descifrado_fallido' });
  assert.throws(() => c.descifrar(dato, 'ana|1|telefono'), { codigo: 'descifrado_fallido' });
  assert.throws(() => crearCifrado(generarLlaveHex()).descifrar(dato, 'ana|1|cedula'), { codigo: 'descifrado_fallido' });
  const partes = dato.split(':');
  partes[3] = Buffer.from('otra cosa').toString('base64');
  assert.throws(() => c.descifrar(partes.join(':'), 'ana|1|cedula'), { codigo: 'descifrado_fallido' });
  assert.throws(() => c.descifrar('texto plano', 'x'), { codigo: 'dato_invalido' });
});

test('cifrado: llave inválida se rechaza sin revelarla', () => {
  for (const mala of [undefined, '', 'abc', 'z'.repeat(64), '0'.repeat(63)]) {
    assert.throws(() => crearCifrado(mala), e => e.codigo === 'llave_invalida' && !String(e.message).includes('zzz'));
  }
});

// ---- Enmascarado ----
test('enmascarar: teléfonos, cédulas, correos y direcciones; los importes y fechas se conservan', () => {
  const casos = [
    ['Llámala al 300 123 4567', '[TELÉFONO]'], ['Su número es +57 3101234567', '[TELÉFONO]'], ['(601) 234 5678', '[TELÉFONO]'],
    ['Cédula 1.234.567.890', '[NÚMERO]'], ['CC 52345678', '[NÚMERO]'], ['ana@correo.com', '[CORREO]'],
    ['Vive en Calle 45 #12-34 apto 301', '[DIRECCIÓN]'], ['Cra 7 No. 80-15', '[DIRECCIÓN]'], ['Carrera 15 # 100 - 20', '[DIRECCIÓN]']
  ];
  for (const [entrada, marca] of casos) {
    const salida = enmascarar(entrada);
    assert.ok(salida.includes(marca), `${entrada} -> ${salida}`);
    assert.ok(!/\d{4,}/.test(salida.replace(/[\s.-]/g, '')), `quedaron dígitos: ${salida}`);
  }
  const seguro = 'Le cotizé $254.000 y $139.500 hasta 06/11/2026, pedido #4521, ref 5104, paga el 15.';
  assert.equal(enmascarar(seguro), seguro);
});

test('enmascarar: la cédula completa no deja ningún dígito suelto', () => {
  assert.equal(enmascarar('Cédula 1.234.567.890 y 52.345.678'), 'Cédula [NÚMERO] y [NÚMERO]');
});

test('resumenParaIA: primer nombre, notas enmascaradas y nunca teléfono, cédula ni dirección', () => {
  const r = resumenParaIA({
    nombre: 'María Fernanda Gómez', etapa: 'interesada', telefono: '3001234567', cedula: '1020304050',
    direccion: 'Calle 1 # 2-3', notas: 'Le interesa el Zentro. Llamar al 300 123 4567. Calle 45 #12-34.'
  });
  assert.deepEqual(Object.keys(r).sort(), ['etapa', 'nombre', 'notas']);
  assert.equal(r.nombre, 'María');
  assert.ok(!JSON.stringify(r).match(/3001234567|300 123|1020304050|Calle 45/));
  assert.equal(primerNombre('  Ana   Lucía '), 'Ana');
});

test('contieneDatosSensibles: detecta teléfono, cédula o dirección en lo que redacta el modelo', () => {
  const c = { telefono: '3001234567', cedula: '1020304050', direccion: 'Calle 45 #12-34 apto 301' };
  assert.ok(contieneDatosSensibles('Te escribo al 300 123 4567', c));
  assert.ok(contieneDatosSensibles('Tu cédula 1.020.304.050', c));
  assert.ok(contieneDatosSensibles('Envío a calle 45 #12-34 apto 301', c));
  assert.equal(contieneDatosSensibles('Hola María, ¿cómo vas con tu pedido?', c), false);
});

// ---- Gestor ----
const AHORA = Date.parse('2026-11-02T15:00:00Z'); // 2026-11-02 en Colombia

function nuevo(extra = {}) {
  const db = abrirBase(':memory:');
  const reloj = { t: AHORA };
  const gestor = crearGestor({ db, cifrado: crearCifrado(generarLlaveHex()), ahora: () => reloj.t, ...extra });
  return { db, gestor, reloj };
}
const ana = { usuario: 'ana', esAdmin: false };
const bea = { usuario: 'bea', esAdmin: false };
const admin = { usuario: 'admin', esAdmin: true };
const datos = (extra = {}) => ({
  nombre: 'María Gómez', telefono: '300 123 4567', cedula: '1.020.304.050', direccion: 'Calle 45 #12-34 apto 301, Cali',
  notas: 'Le gusta el Zentro', consentimiento: true, ...extra
});

test('gestor: crear exige consentimiento, nombre y teléfono válidos', conSqlite, () => {
  const { gestor } = nuevo();
  assert.throws(() => gestor.crearClienta(ana, datos({ consentimiento: false })), { codigo: 'consentimiento_requerido' });
  assert.throws(() => gestor.crearClienta(ana, datos({ consentimiento: 'true' })), { codigo: 'consentimiento_requerido' });
  assert.throws(() => gestor.crearClienta(ana, datos({ nombre: '  ' })), { codigo: 'nombre_requerido' });
  assert.throws(() => gestor.crearClienta(ana, datos({ telefono: '123' })), { codigo: 'telefono_invalido' });
  assert.throws(() => gestor.crearClienta(ana, datos({ telefono: 'abc 3001234567' })), { codigo: 'telefono_invalido' });
  assert.throws(() => gestor.crearClienta(ana, datos({ cedula: '12' })), { codigo: 'cedula_invalida' });
  assert.throws(() => gestor.crearClienta(ana, datos({ etapa: 'otra' })), { codigo: 'etapa_invalida' });
  assert.throws(() => gestor.crearClienta(ana, datos({ notas: 'x'.repeat(2001) })), { codigo: 'notas_larga' });
  const ok = gestor.crearClienta(ana, datos({ cedula: undefined, direccion: undefined }));
  assert.equal(ok.cedula, null);
  assert.equal(ok.etapa, 'nueva');
  assert.equal(ok.consentimiento.version, '1');
  assert.match(TEXTO_CONSENTIMIENTO, /exterior/);
  assert.match(TEXTO_CONSENTIMIENTO, /administrador/);
});

test('gestor: teléfono, cédula, dirección y notas NO están en claro en la base', conSqlite, () => {
  const { gestor, db } = nuevo();
  gestor.crearClienta(ana, datos());
  const crudo = JSON.stringify(db.prepare('SELECT * FROM clientas').all());
  for (const secreto of ['3001234567', '1020304050', '1.020.304.050', 'Calle 45', 'Zentro']) assert.ok(!crudo.includes(secreto), secreto);
  assert.ok(crudo.includes('María Gómez')); // el nombre se guarda en claro para poder buscar
  const c = gestor.obtener(ana, gestor.listar(ana).clientas[0].id);
  assert.equal(c.telefono, '3001234567');
  assert.equal(c.cedula, '1020304050');
  assert.equal(c.direccion, 'Calle 45 #12-34 apto 301, Cali');
  assert.equal(c.notas, 'Le gusta el Zentro');
});

test('gestor: un dato cifrado copiado a otra fila no se puede descifrar', conSqlite, () => {
  const { gestor, db } = nuevo();
  const a = gestor.crearClienta(ana, datos({ nombre: 'Ana A' }));
  const b = gestor.crearClienta(ana, datos({ nombre: 'Beto B', telefono: '3119998888' }));
  const tel = db.prepare('SELECT telefono_cif FROM clientas WHERE id = ?').get(a.id).telefono_cif;
  db.prepare('UPDATE clientas SET telefono_cif = ? WHERE id = ?').run(tel, b.id);
  assert.throws(() => gestor.obtener(ana, b.id), { codigo: 'descifrado_fallido' });
});

test('gestor: la lista muestra solo los últimos 4 dígitos del teléfono', conSqlite, () => {
  const { gestor } = nuevo();
  gestor.crearClienta(ana, datos());
  const l = gestor.listar(ana);
  assert.equal(l.total, 1);
  assert.deepEqual(Object.keys(l.clientas[0]).sort(), ['actualizada', 'etapa', 'id', 'nombre', 'telefono_ult4']);
  assert.equal(l.clientas[0].telefono_ult4, '4567');
  assert.ok(!JSON.stringify(l).includes('3001234567'));
});

test('aislamiento: otra usuaria no ve, edita, exporta ni borra clientas ajenas', conSqlite, () => {
  const { gestor } = nuevo();
  const c = gestor.crearClienta(ana, datos());
  gestor.crearClienta(bea, datos({ nombre: 'Otra Persona' }));
  assert.equal(gestor.listar(bea).total, 1);
  assert.equal(gestor.listar(bea).clientas[0].nombre, 'Otra Persona');
  assert.equal(gestor.listar(bea, { q: 'maría' }).total, 0);
  for (const op of [
    () => gestor.obtener(bea, c.id), () => gestor.actualizar(bea, c.id, { nombre: 'X' }), () => gestor.exportar(bea, c.id),
    () => gestor.borrar(bea, c.id), () => gestor.crearRecordatorio(bea, c.id, { fecha: '2026-11-05', texto: 'x' })
  ]) assert.throws(op, { codigo: 'no_encontrada' });
  assert.equal(gestor.obtener(ana, c.id).nombre, 'María Gómez');
  // pedir explícitamente los datos de otra sin ser administradora
  assert.throws(() => gestor.listar(bea, { duena: 'ana' }), { codigo: 'sin_permiso' });
  assert.throws(() => gestor.obtener(bea, c.id, { duena: 'ana' }), { codigo: 'sin_permiso' });
  assert.throws(() => gestor.indicadores(bea, { duena: 'ana' }), { codigo: 'sin_permiso' });
  assert.throws(() => gestor.consultarAccesos(bea), { codigo: 'sin_permiso' });
  assert.throws(() => gestor.listar({}, {}), { codigo: 'sin_permiso' });
});

test('administrador: puede leer las de otra usuaria (queda registrado) pero no modificarlas', conSqlite, () => {
  const { gestor } = nuevo();
  const c = gestor.crearClienta(ana, datos());
  assert.equal(gestor.listar(admin, { duena: 'ana' }).total, 1);
  assert.equal(gestor.obtener(admin, c.id, { duena: 'ana' }).telefono, '3001234567');
  gestor.exportar(admin, c.id, { duena: 'ana' });
  gestor.indicadores(admin, { duena: 'ana' });
  const accesos = gestor.consultarAccesos(admin);
  assert.ok(accesos.length >= 4);
  assert.ok(accesos.every(a => a.actor === 'admin' && a.duena === 'ana'));
  assert.deepEqual([...new Set(accesos.map(a => a.accion))].sort(), ['exportar', 'indicadores', 'listar', 'obtener']);
  // sus propias lecturas no se registran
  const antes = gestor.consultarAccesos(admin).length;
  gestor.listar(admin);
  assert.equal(gestor.consultarAccesos(admin).length, antes);
  // no puede escribir sobre las de otra (sin duena explícita, opera solo sobre las suyas y no las encuentra)
  assert.throws(() => gestor.actualizar(admin, c.id, { nombre: 'X' }), { codigo: 'no_encontrada' });
  assert.throws(() => gestor.borrar(admin, c.id), { codigo: 'no_encontrada' });
  assert.equal(gestor.obtener(ana, c.id).nombre, 'María Gómez');
});

test('búsqueda: solo por nombre, sin tildes ni mayúsculas, y sin inyección', conSqlite, () => {
  const { gestor } = nuevo();
  gestor.crearClienta(ana, datos({ nombre: 'María José Pérez' }));
  gestor.crearClienta(ana, datos({ nombre: 'Luisa Ríos', telefono: '3119998888' }));
  assert.equal(gestor.listar(ana, { q: 'maria jose' }).total, 1);
  assert.equal(gestor.listar(ana, { q: 'RIOS' }).total, 1);
  assert.equal(gestor.listar(ana, { q: '3001234567' }).total, 0); // el teléfono no es buscable
  assert.equal(gestor.listar(ana, { q: '%' }).total, 0);
  assert.equal(gestor.listar(ana, { q: "x' OR '1'='1" }).total, 0);
  assert.equal(gestor.listar(ana).total, 2);
  gestor.crearClienta(ana, datos({ nombre: "O'Brien; DROP TABLE clientas;--" }));
  assert.equal(gestor.listar(ana).total, 3);
});

test('etapas: el historial registra cada cambio y rechaza etapas inválidas', conSqlite, () => {
  const { gestor, reloj } = nuevo();
  const c = gestor.crearClienta(ana, datos());
  reloj.t += 3600e3;
  gestor.actualizar(ana, c.id, { etapa: 'contactada' });
  gestor.actualizar(ana, c.id, { etapa: 'contactada' }); // sin cambio: no duplica
  gestor.actualizar(ana, c.id, { etapa: 'cliente', notas: 'Compró' });
  const r = gestor.obtener(ana, c.id);
  assert.equal(r.etapa, 'cliente');
  assert.equal(r.notas, 'Compró');
  assert.deepEqual(r.historial.map(h => `${h.de}>${h.a}`), ['null>nueva', 'nueva>contactada', 'contactada>cliente']);
  assert.throws(() => gestor.actualizar(ana, c.id, { etapa: 'vip' }), { codigo: 'etapa_invalida' });
  assert.equal(gestor.listar(ana, { etapa: 'cliente' }).total, 1);
  assert.equal(gestor.listar(ana, { etapa: 'nueva' }).total, 0);
  assert.equal(ETAPAS.length, 7);
});

test('actualizar: cambia datos, valida y puede vaciar campos opcionales', conSqlite, () => {
  const { gestor } = nuevo();
  const c = gestor.crearClienta(ana, datos());
  const r = gestor.actualizar(ana, c.id, { telefono: '+57 311 999 8888', cedula: '', direccion: null, nombre: 'María G.' });
  assert.equal(r.telefono, '+573119998888');
  assert.equal(r.cedula, null);
  assert.equal(r.direccion, null);
  assert.equal(r.nombre, 'María G.');
  assert.equal(r.notas, 'Le gusta el Zentro'); // no tocado
  assert.throws(() => gestor.actualizar(ana, c.id, { telefono: '1' }), { codigo: 'telefono_invalido' });
  assert.equal(gestor.obtener(ana, c.id).telefono, '+573119998888'); // nada quedó a medias
});

test('borrar: elimina la ficha con su historial y recordatorios', conSqlite, () => {
  const { gestor, db } = nuevo();
  const c = gestor.crearClienta(ana, datos());
  gestor.crearRecordatorio(ana, c.id, { fecha: '2026-11-05', texto: 'Llamar' });
  assert.deepEqual(gestor.borrar(ana, c.id), { ok: true });
  assert.equal(gestor.listar(ana).total, 0);
  for (const t of ['clientas', 'historial_etapas', 'recordatorios']) assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n, 0, t);
  assert.throws(() => gestor.borrar(ana, c.id), { codigo: 'no_encontrada' });
});

test('exportar: entrega todo lo guardado, descifrado, con consentimiento e historial', conSqlite, () => {
  const { gestor } = nuevo();
  const c = gestor.crearClienta(ana, datos());
  gestor.crearRecordatorio(ana, c.id, { fecha: '2026-11-05', texto: 'Llamar' });
  const e = gestor.exportar(ana, c.id);
  assert.equal(e.telefono, '3001234567');
  assert.equal(e.consentimiento.version, '1');
  assert.equal(e.recordatorios.length, 1);
  assert.equal(e.historial.length, 1);
  assert.ok(e.exportado);
});

test('recordatorios: vencidos, hoy y próximos 7 días; completar y validar', conSqlite, () => {
  const { gestor } = nuevo();
  const c = gestor.crearClienta(ana, datos());
  const r1 = gestor.crearRecordatorio(ana, c.id, { fecha: '2026-11-01', texto: 'vencido' });
  gestor.crearRecordatorio(ana, c.id, { fecha: '2026-11-02', texto: 'hoy' });
  gestor.crearRecordatorio(ana, c.id, { fecha: '2026-11-09', texto: 'en 7 días' });
  gestor.crearRecordatorio(ana, c.id, { fecha: '2026-11-10', texto: 'lejano' });
  assert.deepEqual(gestor.listarRecordatorios(ana, { estado: 'vencidos' }).map(r => r.texto), ['vencido']);
  assert.deepEqual(gestor.listarRecordatorios(ana, { estado: 'hoy' }).map(r => r.texto), ['hoy']);
  assert.deepEqual(gestor.listarRecordatorios(ana, { estado: 'proximos' }).map(r => r.texto), ['en 7 días']);
  assert.equal(gestor.listarRecordatorios(ana).length, 4);
  assert.equal(gestor.listarRecordatorios(ana, { estado: 'hoy' })[0].nombre, 'María Gómez');
  gestor.completarRecordatorio(ana, r1.id);
  assert.equal(gestor.listarRecordatorios(ana, { estado: 'vencidos' }).length, 0);
  assert.throws(() => gestor.completarRecordatorio(bea, r1.id), { codigo: 'no_encontrada' });
  assert.throws(() => gestor.crearRecordatorio(ana, c.id, { fecha: '05/11/2026', texto: 'x' }), { codigo: 'fecha_invalida' });
  assert.throws(() => gestor.crearRecordatorio(ana, c.id, { fecha: '2026-13-45', texto: 'x' }), { codigo: 'fecha_invalida' });
  assert.throws(() => gestor.crearRecordatorio(ana, c.id, { fecha: '2026-11-05', texto: ' ' }), { codigo: 'texto_requerido' });
  assert.throws(() => gestor.listarRecordatorios(ana, { estado: 'x' }), { codigo: 'estado_invalido' });
  assert.equal(gestor.listarRecordatorios(bea).length, 0);
});

test('indicadores: por etapa, recordatorios y clientas sin movimiento (30 días)', conSqlite, () => {
  const { gestor, reloj } = nuevo();
  const a = gestor.crearClienta(ana, datos({ nombre: 'Antigua' }));
  reloj.t += 40 * 86400e3;
  const b = gestor.crearClienta(ana, datos({ nombre: 'Reciente', etapa: 'interesada' }));
  gestor.crearClienta(ana, datos({ nombre: 'Dormida', etapa: 'inactiva' }));
  gestor.crearRecordatorio(ana, b.id, { fecha: '2026-12-01', texto: 'vencido' });
  const i = gestor.indicadores(ana);
  assert.equal(i.total, 3);
  assert.equal(i.por_etapa.nueva, 1);
  assert.equal(i.por_etapa.interesada, 1);
  assert.equal(i.por_etapa.inactiva, 1);
  assert.equal(i.sin_movimiento, 1); // solo "Antigua": la inactiva no cuenta
  assert.equal(i.recordatorios.vencidos, 1);
  assert.equal(gestor.indicadores(bea).total, 0);
  assert.ok(a.id);
});

test('límite de clientas por usuaria', conSqlite, () => {
  const { gestor } = nuevo();
  const original = LIMITES.clientasPorUsuaria;
  LIMITES.clientasPorUsuaria = 2;
  try {
    gestor.crearClienta(ana, datos({ nombre: 'Uno' }));
    gestor.crearClienta(ana, datos({ nombre: 'Dos' }));
    assert.throws(() => gestor.crearClienta(ana, datos({ nombre: 'Tres' })), { codigo: 'limite_clientas' });
    gestor.crearClienta(bea, datos({ nombre: 'De Bea' })); // el límite es por usuaria
  } finally { LIMITES.clientasPorUsuaria = original; }
});

test('base en disco: se crea con permisos 600 (también los archivos auxiliares) y corrige una existente más abierta', conSqlite, () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gestor-perm-'));
  const ruta = path.join(dir, 'gestor.db');
  try {
    const db = abrirBase(ruta);
    crearGestor({ db, cifrado: crearCifrado(generarLlaveHex()) }).crearClienta(ana, datos());
    for (const f of fs.readdirSync(dir)) assert.equal(fs.statSync(path.join(dir, f)).mode & 0o777, 0o600, f);
    db.close();
    fs.chmodSync(ruta, 0o644); // como quedó en las pruebas del servidor
    abrirBase(ruta).close();
    assert.equal(fs.statSync(ruta).mode & 0o777, 0o600);
    // archivos auxiliares preexistentes y abiertos (apagado brusco): también se corrigen
    const abierta = abrirBase(ruta);
    for (const f of fs.readdirSync(dir)) fs.chmodSync(path.join(dir, f), 0o644);
    assert.ok(fs.readdirSync(dir).some(f => f.endsWith('-wal')));
    const otra = abrirBase(ruta);
    for (const f of fs.readdirSync(dir)) assert.equal(fs.statSync(path.join(dir, f)).mode & 0o777, 0o600, f);
    otra.close(); abierta.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('base en disco: sobrevive al cierre y no se abre con otra llave', conSqlite, () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gestor-'));
  const ruta = path.join(dir, 'gestor.db');
  const llave = generarLlaveHex();
  try {
    const db1 = abrirBase(ruta);
    const g1 = crearGestor({ db: db1, cifrado: crearCifrado(llave) });
    const c = g1.crearClienta(ana, datos());
    db1.close();
    const db2 = abrirBase(ruta);
    assert.equal(crearGestor({ db: db2, cifrado: crearCifrado(llave) }).obtener(ana, c.id).telefono, '3001234567');
    assert.throws(() => crearGestor({ db: db2, cifrado: crearCifrado(generarLlaveHex()) }).obtener(ana, c.id), { codigo: 'descifrado_fallido' });
    db2.close();
    const bytes = fs.readFileSync(ruta);
    assert.ok(!bytes.includes('3001234567') && !bytes.includes('1020304050'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
