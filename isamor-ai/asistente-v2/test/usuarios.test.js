'use strict';
// Administración de usuarios en caliente: crear, restablecer clave, cambiar la propia, módulos, inactivar.
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearAuth, crearRegistroUsuario, fusionarRegistro, validarClave } = require('../src/auth');

const CLAVE_JEFA = 'clave-de-la-jefa-123';
async function nuevo({ guardarFalla = false, guardarMs = 0, extra = {} } = {}) {
  const guardados = [];
  const usuarios = { jefa: { ...(await crearRegistroUsuario(CLAVE_JEFA)), modulos: ['sales', 'content'], rol: 'admin' }, ...extra };
  const reloj = { t: Date.UTC(2026, 10, 2, 15, 0, 0) };
  const auth = crearAuth({
    usuarios, ahora: () => reloj.t,
    guardar: async copia => { if (guardarMs) await new Promise(r => setTimeout(r, guardarMs)); if (guardarFalla) throw new Error('disco lleno'); guardados.push(JSON.parse(JSON.stringify(copia))); }
  });
  return { auth, usuarios, guardados, reloj };
}
const entrar = async (auth, u, c, ip = '1.1.1.1') => auth.iniciarSesion(u, c, ip);
const esperarGuardado = async (guardados, n) => { for (let i = 0; i < 50 && guardados.length < n; i++) await new Promise(r => setImmediate(r)); };

test('crear usuario: queda activo, con clave temporal que obliga a cambiarla, y la clave nunca se guarda', async () => {
  const { auth, guardados } = await nuevo();
  const v = await auth.crearUsuario({ usuario: ' Ana ', clave: 'temporal-12345', modulos: ['sales', 'content', 'sales'] });
  assert.deepEqual([v.usuario, v.modulos, v.rol, v.activo, v.cambiar_clave], ['ana', ['sales', 'content'], 'usuaria', true, true]);
  assert.ok(v.creado);
  assert.ok(!JSON.stringify(guardados).includes('temporal-12345'));
  assert.ok(!JSON.stringify(v).match(/"hash"|"sal"|"alg"/));
  const s = await entrar(auth, 'ana', 'temporal-12345');
  assert.equal(s.ok, true);
  assert.equal(auth.debeCambiarClave('ana'), true);
  assert.equal(auth.esAdmin('ana'), false);
  const admin = await auth.crearUsuario({ usuario: 'beto', clave: 'temporal-12345', modulos: ['sales'], rol: 'admin' });
  assert.equal(admin.rol, 'admin');
  assert.equal(auth.esAdmin('beto'), true);
});

test('crear usuario: valida nombre, duplicados, clave, módulos y rol', async () => {
  const { auth, usuarios } = await nuevo();
  const caso = (datos, codigo) => assert.rejects(() => auth.crearUsuario({ clave: 'temporal-12345', modulos: ['sales'], ...datos }), { codigo });
  await caso({ usuario: 'ab' }, 'usuario_invalido');
  await caso({ usuario: 'Con Espacio' }, 'usuario_invalido');
  await caso({ usuario: '../etc' }, 'usuario_invalido');
  await caso({ usuario: 'x'.repeat(33) }, 'usuario_invalido');
  await caso({ usuario: 'JEFA' }, 'usuario_existe');
  await caso({ usuario: 'nueva', clave: 'corta' }, 'clave_debil');
  await caso({ usuario: 'nueva', clave: 'a'.repeat(20) }, 'clave_debil');
  await caso({ usuario: 'nuevausuario', clave: 'NuevaUsuario' }, 'clave_debil'); // igual al usuario
  await caso({ usuario: 'nueva', clave: 'x'.repeat(201) }, 'clave_larga');
  await caso({ usuario: 'nueva', modulos: [] }, 'modulos_invalidos');
  await caso({ usuario: 'nueva', modulos: ['sales', 'inventado'] }, 'modulos_invalidos');
  await caso({ usuario: 'nueva', modulos: 'sales' }, 'modulos_invalidos');
  await caso({ usuario: 'nueva', rol: 'superadmin' }, 'rol_invalido');
  assert.deepEqual(Object.keys(usuarios), ['jefa']); // nada se creó a medias
  assert.doesNotThrow(() => validarClave('una-clave-larga-1', 'otro'));
});

test('crear usuario: si no se puede guardar en disco, no queda creado en memoria', async () => {
  const { auth, usuarios } = await nuevo({ guardarFalla: true });
  await assert.rejects(() => auth.crearUsuario({ usuario: 'ana', clave: 'temporal-12345', modulos: ['sales'] }), /disco lleno/);
  assert.equal(Object.prototype.hasOwnProperty.call(usuarios, 'ana'), false);
  assert.equal((await entrar(auth, 'ana', 'temporal-12345')).ok, false);
});

test('crear usuario: dos creaciones simultáneas del mismo nombre -> solo una gana (con guardado lento)', async () => {
  const { auth } = await nuevo({ guardarMs: 30 });
  const r = await Promise.allSettled([1, 2, 3].map(() => auth.crearUsuario({ usuario: 'ana', clave: 'temporal-12345', modulos: ['sales'] })));
  assert.equal(r.filter(x => x.status === 'fulfilled').length, 1);
  assert.ok(r.filter(x => x.status === 'rejected').every(x => x.reason.codigo === 'usuario_existe'));
  assert.equal(auth.listarUsuarios().filter(u => u.usuario === 'ana').length, 1);
});

test('cambiar mi clave: exige la actual, quita la marca de clave temporal y cierra las demás sesiones', async () => {
  const { auth } = await nuevo();
  await auth.crearUsuario({ usuario: 'ana', clave: 'temporal-12345', modulos: ['sales'] });
  const s1 = await entrar(auth, 'ana', 'temporal-12345');
  const s2 = await entrar(auth, 'ana', 'temporal-12345');
  await assert.rejects(() => auth.cambiarMiClave('ana', 'equivocada-1234', 'definitiva-67890', { tokenActual: s1.token }), { codigo: 'clave_actual_incorrecta' });
  await assert.rejects(() => auth.cambiarMiClave('ana', 'temporal-12345', 'corta', { tokenActual: s1.token }), { codigo: 'clave_debil' });
  await assert.rejects(() => auth.cambiarMiClave('ana', 'temporal-12345', 'temporal-12345', { tokenActual: s1.token }), { codigo: 'clave_igual' });
  assert.equal(auth.debeCambiarClave('ana'), true);
  const v = await auth.cambiarMiClave('ana', 'temporal-12345', 'definitiva-67890', { tokenActual: s1.token });
  assert.equal(v.cambiar_clave, false);
  assert.equal(auth.debeCambiarClave('ana'), false);
  assert.equal(auth.usuarioDeSesion(s1.token), 'ana'); // la sesión desde donde se cambió sigue
  assert.equal(auth.usuarioDeSesion(s2.token), null);   // las otras se cierran
  assert.equal((await entrar(auth, 'ana', 'temporal-12345')).ok, false);
  assert.equal((await entrar(auth, 'ana', 'definitiva-67890')).ok, true);
});

test('cambiar mi clave: los intentos con la clave actual equivocada cuentan para el bloqueo por IP', async () => {
  const { auth } = await nuevo();
  for (let i = 0; i < 5; i++) await assert.rejects(() => auth.cambiarMiClave('jefa', 'mala-clave-0000', 'definitiva-67890', { ip: '9.9.9.9' }), { codigo: 'clave_actual_incorrecta' });
  await assert.rejects(() => auth.cambiarMiClave('jefa', CLAVE_JEFA, 'definitiva-67890', { ip: '9.9.9.9' }), e => e.codigo === 'bloqueado' && e.retryAfterS > 0);
  await assert.rejects(() => auth.cambiarMiClave('jefa', CLAVE_JEFA, 'definitiva-67890', { ip: '8.8.8.8' }).then(() => { throw new Error('ok'); }), /ok/); // otra IP sí puede
});

test('restablecer clave: temporal obligatoria, cierra sesiones, y no sirve para la propia cuenta', async () => {
  const { auth } = await nuevo();
  await auth.crearUsuario({ usuario: 'ana', clave: 'temporal-12345', modulos: ['sales'] });
  const s = await entrar(auth, 'ana', 'temporal-12345');
  await auth.cambiarMiClave('ana', 'temporal-12345', 'definitiva-67890', { tokenActual: s.token });
  const s2 = await entrar(auth, 'ana', 'definitiva-67890');
  const v = await auth.restablecerClave('ana', 'otra-temporal-111', 'jefa');
  assert.equal(v.cambiar_clave, true);
  assert.equal(auth.usuarioDeSesion(s2.token), null);
  assert.equal((await entrar(auth, 'ana', 'definitiva-67890')).ok, false);
  assert.equal((await entrar(auth, 'ana', 'otra-temporal-111')).ok, true);
  await assert.rejects(() => auth.restablecerClave('jefa', 'otra-temporal-111', 'jefa'), { codigo: 'es_tu_cuenta' });
  await assert.rejects(() => auth.restablecerClave('nadie', 'otra-temporal-111', 'jefa'), { codigo: 'no_encontrado' });
  await assert.rejects(() => auth.restablecerClave('ana', 'corta', 'jefa'), { codigo: 'clave_debil' });
});

test('inactivar: no puede entrar (mismo resultado que una clave mala), sus sesiones se cierran y reactivar lo restaura', async () => {
  const { auth, usuarios } = await nuevo();
  await auth.crearUsuario({ usuario: 'ana', clave: 'temporal-12345', modulos: ['sales', 'content'] });
  const s = await entrar(auth, 'ana', 'temporal-12345');
  assert.equal(auth.usuarioDeSesion(s.token), 'ana');
  const v = await auth.actualizarUsuario('ana', { activo: false }, 'jefa');
  assert.equal(v.activo, false);
  assert.equal(auth.usuarioDeSesion(s.token), null);
  const intento = await entrar(auth, 'ana', 'temporal-12345', '2.2.2.2');
  const mala = await entrar(auth, 'ana', 'clave-mala-00000', '3.3.3.3');
  assert.deepEqual(intento, { ok: false, motivo: 'credenciales' });
  assert.deepEqual(mala, { ok: false, motivo: 'credenciales' });
  assert.equal(auth.usuariasConModulo('sales').includes('ana'), false);
  assert.equal(usuarios.ana.hash.length > 0, true); // no se borra: solo se inactiva
  await auth.actualizarUsuario('ana', { activo: true }, 'jefa');
  assert.equal((await entrar(auth, 'ana', 'temporal-12345')).ok, true);
});

test('una sesión abierta deja de valer si el usuario se inactiva o desaparece del archivo a mano', async () => {
  const { auth, usuarios } = await nuevo();
  await auth.crearUsuario({ usuario: 'ana', clave: 'temporal-12345', modulos: ['sales'] });
  const s = await entrar(auth, 'ana', 'temporal-12345');
  usuarios.ana.activo = false;
  assert.equal(auth.usuarioDeSesion(s.token), null);
});

test('cambiar módulos y rol; salvaguardas: no inactivarte, no quitarte el rol y siempre una administradora activa', async () => {
  const { auth } = await nuevo();
  await auth.crearUsuario({ usuario: 'ana', clave: 'temporal-12345', modulos: ['sales'] });
  let v = await auth.actualizarUsuario('ana', { modulos: ['content', 'manager'] }, 'jefa');
  assert.deepEqual(v.modulos, ['content', 'manager']);
  assert.deepEqual(auth.modulosDe('ana'), ['content', 'manager']);
  v = await auth.actualizarUsuario('ana', { rol: 'admin' }, 'jefa');
  assert.equal(auth.esAdmin('ana'), true);
  v = await auth.actualizarUsuario('ana', { rol: 'usuaria' }, 'jefa');
  assert.equal(auth.esAdmin('ana'), false);
  await assert.rejects(() => auth.actualizarUsuario('jefa', { activo: false }, 'jefa'), { codigo: 'no_puedes_inactivarte' });
  await assert.rejects(() => auth.actualizarUsuario('jefa', { rol: 'usuaria' }, 'jefa'), { codigo: 'no_cambies_tu_rol' });
  await assert.rejects(() => auth.actualizarUsuario('jefa', { activo: false }, 'otro'), { codigo: 'ultima_administradora' });
  await assert.rejects(() => auth.actualizarUsuario('jefa', { rol: 'usuaria' }, 'otro'), { codigo: 'ultima_administradora' });
  assert.equal(auth.esAdmin('jefa'), true);
  await assert.rejects(() => auth.actualizarUsuario('ana', { modulos: [] }, 'jefa'), { codigo: 'modulos_invalidos' });
  await assert.rejects(() => auth.actualizarUsuario('ana', { activo: 'no' }, 'jefa'), { codigo: 'activo_invalido' });
  await assert.rejects(() => auth.actualizarUsuario('ana', {}, 'jefa'), { codigo: 'sin_cambios' });
  await assert.rejects(() => auth.actualizarUsuario('nadie', { activo: false }, 'jefa'), { codigo: 'no_encontrado' });
  // con una segunda administradora sí se puede inactivar a la primera
  await auth.actualizarUsuario('ana', { rol: 'admin' }, 'jefa');
  assert.equal((await auth.actualizarUsuario('jefa', { activo: false }, 'ana')).activo, false);
});

test('la lista no expone claves ni hashes y refleja estado, rol, módulos y último acceso', async () => {
  const { auth, guardados } = await nuevo();
  await auth.crearUsuario({ usuario: 'ana', clave: 'temporal-12345', modulos: ['sales'] });
  await entrar(auth, 'ana', 'temporal-12345');
  await esperarGuardado(guardados, 2);
  const lista = auth.listarUsuarios();
  assert.deepEqual(lista.map(u => u.usuario), ['ana', 'jefa']);
  assert.ok(!JSON.stringify(lista).match(/"hash"|"sal"|"alg"|scrypt/));
  assert.ok(lista.find(u => u.usuario === 'ana').ultimo_acceso);
  assert.equal(lista.find(u => u.usuario === 'jefa').rol, 'admin');
});

test('fusionarRegistro conserva rol y estado al poner una clave definitiva desde el script', async () => {
  const claves = await crearRegistroUsuario('una-clave-nueva-123');
  const antes = { alg: 'x', sal: 'a', hash: 'b', modulos: ['sales'], rol: 'admin', activo: false, cambiar_clave: true, creado: 'ayer' };
  const despues = fusionarRegistro(antes, claves, ['sales', 'content']);
  assert.equal(despues.rol, 'admin');
  assert.equal(despues.activo, false);
  assert.equal(despues.creado, 'ayer');
  assert.deepEqual(despues.modulos, ['sales', 'content']);
  assert.equal(despues.hash, claves.hash);
  assert.equal('cambiar_clave' in despues, false);
  assert.deepEqual(Object.keys(fusionarRegistro(null, claves, ['sales'])).sort(), ['alg', 'hash', 'modulos', 'sal']);
});
