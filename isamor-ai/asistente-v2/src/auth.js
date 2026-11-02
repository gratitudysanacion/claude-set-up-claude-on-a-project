'use strict';
// Autenticación del asistente: usuarios con clave en scrypt, sesiones con vencimiento en el servidor, límite de intentos
// por IP y administración de usuarios en caliente (crear, restablecer clave, cambiar módulos, inactivar).
// El reloj y el guardado son inyectables para poder probar sin tocar disco.
const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const PARAMETROS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const LARGO_HASH = 32;
const ALGORITMO = 'scrypt-N16384-r8-p1';
const SAL_FICTICIA = Buffer.alloc(16, 7);
const HASH_FICTICIO = Buffer.alloc(LARGO_HASH, 9);

const HORAS_8 = 8 * 60 * 60 * 1000;
const MODULOS_VALIDOS = ['sales', 'content', 'beauty', 'manager'];
const ROLES = ['admin', 'usuaria'];
const MIN_CLAVE = 12;
const MAX_CLAVE = 200;
const RE_USUARIO = /^[a-z0-9._-]{3,32}$/;

function error(codigo, mensaje) {
  const e = new Error(mensaje || codigo);
  e.codigo = codigo;
  return e;
}

async function calcularHash(clave, sal) {
  return scrypt(String(clave), sal, LARGO_HASH, PARAMETROS);
}

// Registro que se guarda en data/usuarios.json: nunca contiene la clave.
async function crearRegistroUsuario(clave) {
  const sal = crypto.randomBytes(16);
  const hash = await calcularHash(clave, sal);
  return { alg: ALGORITMO, sal: sal.toString('hex'), hash: hash.toString('hex') };
}

// Siempre calcula un hash, exista o no el usuario, para no revelar usuarios por tiempo de respuesta.
async function verificarClave(clave, registro) {
  const sal = registro ? Buffer.from(registro.sal, 'hex') : SAL_FICTICIA;
  const esperado = registro ? Buffer.from(registro.hash, 'hex') : HASH_FICTICIO;
  const calculado = await calcularHash(clave, sal);
  return calculado.length === esperado.length && crypto.timingSafeEqual(calculado, esperado) && !!registro;
}

// Pone una clave definitiva a un registro existente conservando el resto de sus campos (rol, módulos, estado...).
// La usa scripts/crear-usuario.js: antes reemplazaba el registro completo y borraba el rol.
function fusionarRegistro(existente, registroClave, modulos) {
  const salida = { ...(existente || {}), ...registroClave, modulos };
  delete salida.cambiar_clave;
  return salida;
}

// Política mínima de claves: largo, distinta del usuario y no un mismo carácter repetido.
function validarClave(clave, usuario) {
  if (typeof clave !== 'string' || clave.length < MIN_CLAVE) throw error('clave_debil', `La clave debe tener al menos ${MIN_CLAVE} caracteres.`);
  if (clave.length > MAX_CLAVE) throw error('clave_larga', `La clave no puede superar ${MAX_CLAVE} caracteres.`);
  if (usuario && clave.toLowerCase() === String(usuario).toLowerCase()) throw error('clave_debil', 'La clave no puede ser igual al usuario.');
  if (/^(.)\1+$/.test(clave)) throw error('clave_debil', 'La clave no puede ser un mismo carácter repetido.');
}

function crearAuth({
  usuarios = {},
  ahora = () => Date.now(),
  ttlMs = HORAS_8,
  maxFallos = 5,
  ventanaMs = 10 * 60 * 1000,
  bloqueoMs = 15 * 60 * 1000,
  guardar = async () => {}
} = {}) {
  const sesiones = new Map();
  const intentos = new Map();
  const iso = () => new Date(ahora()).toISOString();

  const registroDe = nombre => (Object.prototype.hasOwnProperty.call(usuarios, nombre) ? usuarios[nombre] : null);
  const vigente = registro => !!registro && registro.activo !== false;

  // Las escrituras a disco y los cambios de usuarios se hacen de a uno (cola) para que dos administradoras no se pisen.
  let cola = Promise.resolve();
  const enCola = fn => { const p = cola.then(fn); cola = p.catch(() => {}); return p; };
  const copia = () => JSON.parse(JSON.stringify(usuarios));
  function reemplazar(nuevo) {
    for (const k of Object.keys(usuarios)) delete usuarios[k];
    Object.assign(usuarios, nuevo);
  }
  // Aplica el cambio sobre una copia, la guarda y solo entonces la adopta: si guardar falla, no queda nada a medias.
  const aplicar = mutar => enCola(async () => {
    const c = copia();
    const resultado = mutar(c);
    await guardar(c);
    reemplazar(c);
    return resultado;
  });

  function segundosBloqueo(ip) {
    const a = intentos.get(ip);
    if (!a || a.bloqueadoHasta <= ahora()) return 0;
    return Math.ceil((a.bloqueadoHasta - ahora()) / 1000);
  }

  function registrarFallo(ip) {
    const t = ahora();
    const a = intentos.get(ip) || { fallos: [], bloqueadoHasta: 0 };
    a.fallos = a.fallos.filter(x => t - x < ventanaMs);
    a.fallos.push(t);
    if (a.fallos.length >= maxFallos) {
      a.bloqueadoHasta = t + bloqueoMs;
      a.fallos = [];
    }
    intentos.set(ip, a);
  }

  async function iniciarSesion(usuario, clave, ip) {
    const espera = segundosBloqueo(ip);
    if (espera) return { ok: false, motivo: 'bloqueado', retryAfterS: espera };
    const nombre = typeof usuario === 'string' ? usuario.trim().toLowerCase() : '';
    const registro = registroDe(nombre);
    // Un usuario inactivo se trata igual que uno inexistente: mismo mensaje y mismo tiempo de respuesta.
    const valida = await verificarClave(typeof clave === 'string' ? clave : '', vigente(registro) ? registro : null);
    if (!valida) {
      registrarFallo(ip);
      return { ok: false, motivo: 'credenciales' };
    }
    intentos.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    sesiones.set(token, { usuario: nombre, creada: ahora() });
    // Último acceso: mejor esfuerzo, nunca impide entrar.
    aplicar(c => { if (c[nombre]) c[nombre].ultimo_acceso = iso(); }).catch(() => {});
    return { ok: true, token, usuario: nombre, maxAgeS: Math.floor(ttlMs / 1000) };
  }

  function usuarioDeSesion(token) {
    if (!token) return null;
    const s = sesiones.get(token);
    if (!s) return null;
    if (ahora() - s.creada > ttlMs) { sesiones.delete(token); return null; }
    if (!vigente(registroDe(s.usuario))) { sesiones.delete(token); return null; } // inactivado o eliminado a mano
    return s.usuario;
  }

  function cerrarSesion(token) { sesiones.delete(token); }

  function cerrarSesionesDe(usuario, excepto = null) {
    for (const [token, s] of sesiones) if (s.usuario === usuario && token !== excepto) sesiones.delete(token);
  }

  // Módulos que puede usar la usuaria. Sin lista (o con lista vacía o inválida) solo el módulo comercial.
  function modulosDe(usuario) {
    const registro = registroDe(usuario);
    const lista = registro && Array.isArray(registro.modulos) ? registro.modulos.filter(m => MODULOS_VALIDOS.includes(m)) : [];
    return lista.length ? [...new Set(lista)] : ['sales'];
  }

  // Nombres de las usuarias activas que tienen un módulo habilitado (sin claves ni otros datos). Para el soporte del Gestor.
  function usuariasConModulo(modulo) {
    return Object.keys(usuarios).filter(u => vigente(usuarios[u]) && modulosDe(u).includes(modulo)).sort();
  }

  // Administradora: usuaria activa con "rol": "admin" en usuarios.json.
  function esAdmin(usuario) {
    const registro = registroDe(usuario);
    return vigente(registro) && registro.rol === 'admin';
  }

  // La clave temporal puesta por la administradora obliga a cambiarla antes de usar cualquier módulo.
  function debeCambiarClave(usuario) {
    const registro = registroDe(usuario);
    return !!registro && registro.cambiar_clave === true;
  }

  // ---- Administración de usuarios ----
  const vista = nombre => {
    const r = usuarios[nombre];
    return {
      usuario: nombre, modulos: modulosDe(nombre), rol: r.rol === 'admin' ? 'admin' : 'usuaria', activo: vigente(r),
      cambiar_clave: r.cambiar_clave === true, creado: r.creado || null, ultimo_acceso: r.ultimo_acceso || null
    };
  };

  function listarUsuarios() {
    return Object.keys(usuarios).sort().map(vista);
  }

  function validarModulos(modulos) {
    if (!Array.isArray(modulos) || !modulos.length) throw error('modulos_invalidos', 'Elige al menos un módulo.');
    const limpios = [...new Set(modulos.map(m => String(m).trim()))];
    if (limpios.some(m => !MODULOS_VALIDOS.includes(m))) throw error('modulos_invalidos', 'Hay módulos que no existen.');
    return limpios;
  }

  function validarRol(rol) {
    if (!ROLES.includes(rol)) throw error('rol_invalido', 'Rol no válido.');
    return rol;
  }

  async function crearUsuario({ usuario, clave, modulos, rol = 'usuaria' } = {}) {
    const nombre = typeof usuario === 'string' ? usuario.trim().toLowerCase() : '';
    if (!RE_USUARIO.test(nombre)) throw error('usuario_invalido', 'El usuario debe tener de 3 a 32 caracteres: letras minúsculas, números, punto, guion o guion bajo.');
    if (registroDe(nombre)) throw error('usuario_existe', 'Ese usuario ya existe.');
    validarClave(clave, nombre);
    const modulosOk = validarModulos(modulos);
    validarRol(rol);
    const registroClave = await crearRegistroUsuario(clave);
    await aplicar(c => {
      if (c[nombre]) throw error('usuario_existe', 'Ese usuario ya existe.');
      c[nombre] = { ...registroClave, modulos: modulosOk, ...(rol === 'admin' ? { rol: 'admin' } : {}), activo: true, cambiar_clave: true, creado: iso() };
    });
    return vista(nombre);
  }

  // La administradora pone una clave temporal; la persona debe cambiarla al entrar. Cierra sus sesiones abiertas.
  async function restablecerClave(usuario, claveTemporal, actor) {
    const nombre = String(usuario || '').toLowerCase();
    if (!registroDe(nombre)) throw error('no_encontrado', 'Usuario no encontrado.');
    if (nombre === actor) throw error('es_tu_cuenta', 'Para tu propia clave usa "Cambiar mi clave".');
    validarClave(claveTemporal, nombre);
    const registroClave = await crearRegistroUsuario(claveTemporal);
    await aplicar(c => {
      if (!c[nombre]) throw error('no_encontrado', 'Usuario no encontrado.');
      Object.assign(c[nombre], registroClave, { cambiar_clave: true });
    });
    cerrarSesionesDe(nombre);
    return vista(nombre);
  }

  // Cada persona cambia su propia clave, con la actual. Comparte el límite de intentos por IP del inicio de sesión.
  async function cambiarMiClave(usuario, claveActual, claveNueva, { ip = 'desconocida', tokenActual = null } = {}) {
    const espera = segundosBloqueo(ip);
    if (espera) { const e = error('bloqueado', 'Demasiados intentos. Intenta de nuevo más tarde.'); e.retryAfterS = espera; throw e; }
    const registro = registroDe(usuario);
    if (!vigente(registro)) throw error('no_encontrado', 'Usuario no encontrado.');
    if (!(await verificarClave(typeof claveActual === 'string' ? claveActual : '', registro))) {
      registrarFallo(ip);
      throw error('clave_actual_incorrecta', 'La clave actual no es correcta.');
    }
    validarClave(claveNueva, usuario);
    if (claveNueva === claveActual) throw error('clave_igual', 'La clave nueva debe ser distinta de la actual.');
    const registroClave = await crearRegistroUsuario(claveNueva);
    await aplicar(c => {
      if (!c[usuario]) throw error('no_encontrado', 'Usuario no encontrado.');
      Object.assign(c[usuario], registroClave, { clave_cambiada: iso() });
      delete c[usuario].cambiar_clave;
    });
    cerrarSesionesDe(usuario, tokenActual); // las demás sesiones de esta persona se cierran
    return vista(usuario);
  }

  // cambios: { modulos?, rol?, activo? }
  async function actualizarUsuario(usuario, cambios = {}, actor) {
    const nombre = String(usuario || '').toLowerCase();
    if (!registroDe(nombre)) throw error('no_encontrado', 'Usuario no encontrado.');
    const aplicables = {};
    if ('modulos' in cambios) aplicables.modulos = validarModulos(cambios.modulos);
    if ('rol' in cambios) aplicables.rol = validarRol(cambios.rol);
    if ('activo' in cambios) {
      if (typeof cambios.activo !== 'boolean') throw error('activo_invalido', 'El estado debe ser activo o inactivo.');
      aplicables.activo = cambios.activo;
    }
    if (!Object.keys(aplicables).length) throw error('sin_cambios', 'No hay nada que cambiar.');
    if (nombre === actor && aplicables.activo === false) throw error('no_puedes_inactivarte', 'No puedes inactivar tu propia cuenta.');
    if (nombre === actor && 'rol' in aplicables && aplicables.rol !== 'admin') throw error('no_cambies_tu_rol', 'No puedes quitarte el rol de administradora.');
    await aplicar(c => {
      const r = c[nombre];
      if (!r) throw error('no_encontrado', 'Usuario no encontrado.');
      if ('modulos' in aplicables) r.modulos = aplicables.modulos;
      if ('rol' in aplicables) { if (aplicables.rol === 'admin') r.rol = 'admin'; else delete r.rol; }
      if ('activo' in aplicables) r.activo = aplicables.activo;
      // Siempre debe quedar al menos una administradora activa.
      if (!Object.values(c).some(x => x.rol === 'admin' && x.activo !== false)) throw error('ultima_administradora', 'Debe quedar al menos una administradora activa.');
    });
    if (aplicables.activo === false) cerrarSesionesDe(nombre);
    return vista(nombre);
  }

  function limpiar() {
    const t = ahora();
    for (const [token, s] of sesiones) if (t - s.creada > ttlMs) sesiones.delete(token);
    for (const [ip, a] of intentos) {
      if (a.bloqueadoHasta <= t && !a.fallos.some(x => t - x < ventanaMs)) intentos.delete(ip);
    }
  }

  return {
    iniciarSesion, usuarioDeSesion, cerrarSesion, cerrarSesionesDe, modulosDe, esAdmin, debeCambiarClave, usuariasConModulo,
    listarUsuarios, crearUsuario, restablecerClave, cambiarMiClave, actualizarUsuario,
    segundosBloqueo, limpiar, _sesiones: sesiones
  };
}

module.exports = { crearAuth, crearRegistroUsuario, verificarClave, fusionarRegistro, validarClave, ALGORITMO, MODULOS_VALIDOS, ROLES, MIN_CLAVE };
