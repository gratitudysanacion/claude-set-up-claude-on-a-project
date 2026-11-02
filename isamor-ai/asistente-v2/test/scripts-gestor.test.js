'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const raiz = path.join(__dirname, '..');
const ejecutar = (script, args, env) => spawnSync(process.execPath, [path.join(raiz, 'scripts', script), ...args], { env: { ...process.env, ...env }, encoding: 'utf8' });
const carpeta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'scripts-gestor-'));

test('crear-llave-gestor: crea una llave de 64 hex con permisos 600, conserva el resto del .env y no sobrescribe', () => {
  const dir = carpeta();
  const env = path.join(dir, '.env');
  try {
    fs.writeFileSync(env, 'ANTHROPIC_API_KEY=sk-ant-prueba\n', { mode: 0o644 });
    const r = ejecutar('crear-llave-gestor.js', [], { ARCHIVO_ENV: env });
    assert.equal(r.status, 0);
    const contenido = fs.readFileSync(env, 'utf8');
    const llave = /^GESTOR_LLAVE=([0-9a-f]{64})$/m.exec(contenido);
    assert.ok(llave);
    assert.match(contenido, /ANTHROPIC_API_KEY=sk-ant-prueba/);
    assert.equal(fs.statSync(env).mode & 0o777, 0o600);
    assert.ok(r.stdout.includes(llave[1])); // se muestra una sola vez, para copiarla al gestor de contraseñas
    // segunda vez: se niega y no cambia nada
    const r2 = ejecutar('crear-llave-gestor.js', [], { ARCHIVO_ENV: env });
    assert.equal(r2.status, 3);
    assert.equal(fs.readFileSync(env, 'utf8'), contenido);
    assert.ok(!r2.stdout.includes(llave[1]) && !r2.stderr.includes(llave[1]));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('asignar-rol: marca y quita el rol admin sin tocar la clave ni los módulos', () => {
  const dir = carpeta();
  const archivo = path.join(dir, 'usuarios.json');
  try {
    const base = { usuarios: { ana: { alg: 'a', sal: 's', hash: 'h', modulos: ['sales', 'manager'] } } };
    fs.writeFileSync(archivo, JSON.stringify(base), { mode: 0o644 });
    assert.equal(ejecutar('asignar-rol.js', ['ANA', 'admin'], { USUARIOS: archivo }).status, 0);
    let u = JSON.parse(fs.readFileSync(archivo, 'utf8')).usuarios.ana;
    assert.deepEqual([u.rol, u.hash, u.modulos], ['admin', 'h', ['sales', 'manager']]);
    assert.equal(fs.statSync(archivo).mode & 0o777, 0o600);
    assert.equal(ejecutar('asignar-rol.js', ['ana', 'usuaria'], { USUARIOS: archivo }).status, 0);
    u = JSON.parse(fs.readFileSync(archivo, 'utf8')).usuarios.ana;
    assert.equal(u.rol, undefined);
    assert.equal(ejecutar('asignar-rol.js', ['nadie', 'admin'], { USUARIOS: archivo }).status, 1);
    assert.equal(ejecutar('asignar-rol.js', ['ana', 'superadmin'], { USUARIOS: archivo }).status, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
