'use strict';
// Servidor del Asistente comercial v2. Node http nativo, sin dependencias.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { MODULOS_VALIDOS } = require('./auth');

const VERSION = '2.0.0-dev';
const MAX_LOGIN_BYTES = 4096;
const MAX_CHAT_BYTES = 8192;
const MAX_GESTOR_BYTES = 16384;
const MAX_USUARIOS_BYTES = 4096;
const MAX_MENSAJE = 1500;
const NOMBRE_COOKIE = 'isamor_sesion';

const CSP = [
  "default-src 'self'",
  "img-src 'self' data:",
  "style-src 'self'",
  "script-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'"
].join('; ');

// Lista blanca: solo estos archivos se sirven desde public/.
const ESTATICOS = {
  '/': { archivo: 'index.html', tipo: 'text/html; charset=utf-8', cache: 'no-cache' },
  '/index.html': { archivo: 'index.html', tipo: 'text/html; charset=utf-8', cache: 'no-cache' },
  '/app.js': { archivo: 'app.js', tipo: 'application/javascript; charset=utf-8', cache: 'no-cache' },
  '/usuarios.js': { archivo: 'usuarios.js', tipo: 'application/javascript; charset=utf-8', cache: 'no-cache' },
  '/gestor.js': { archivo: 'gestor.js', tipo: 'application/javascript; charset=utf-8', cache: 'no-cache' },
  '/styles.css': { archivo: 'styles.css', tipo: 'text/css; charset=utf-8', cache: 'no-cache' },
  '/yanbal-logo.jpg': { archivo: 'yanbal-logo.jpg', tipo: 'image/jpeg', cache: 'public, max-age=3600' }
};

// Códigos de error del Gestor -> estado HTTP. Los no listados son errores de validación (400).
// Códigos de error de la administración de usuarios -> estado HTTP (el resto son errores de validación: 400).
const ESTADO_USUARIOS = { no_encontrado: 404, usuario_existe: 409, ultima_administradora: 409, bloqueado: 429, sin_permiso: 403 };
const ESTADO_GESTOR = { no_encontrada: 404, sin_permiso: 403, limite_clientas: 409, consentimiento_requerido: 400 };

class ErrorHttp extends Error {
  constructor(estado, mensaje) { super(mensaje); this.estado = estado; }
}

function cabecerasBase(extra = {}) {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': CSP,
    ...extra
  };
}

function enviarJson(res, estado, datos, extra = {}) {
  res.writeHead(estado, cabecerasBase({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extra
  }));
  res.end(JSON.stringify(datos));
}

function leerCuerpo(req, maximo) {
  return new Promise((resolve, reject) => {
    const declarado = Number(req.headers['content-length']);
    if (Number.isFinite(declarado) && declarado > maximo) {
      reject(new ErrorHttp(413, 'Solicitud demasiado grande.'));
      return;
    }
    let total = 0;
    const partes = [];
    req.on('data', trozo => {
      total += trozo.length;
      if (total > maximo) { reject(new ErrorHttp(413, 'Solicitud demasiado grande.')); return; }
      partes.push(trozo);
    });
    req.on('end', () => resolve(Buffer.concat(partes).toString('utf8')));
    req.on('error', reject);
  });
}

async function leerJson(req, maximo) {
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) {
    throw new ErrorHttp(415, 'Se esperaba application/json.');
  }
  const texto = await leerCuerpo(req, maximo);
  try {
    const datos = JSON.parse(texto || '{}');
    if (datos === null || typeof datos !== 'object' || Array.isArray(datos)) throw new Error('forma');
    return datos;
  } catch {
    throw new ErrorHttp(400, 'Solicitud no válida.');
  }
}

function ipDelCliente(req) {
  const real = String(req.headers['x-real-ip'] || '').trim();
  return real && real.length <= 45 ? real : (req.socket.remoteAddress || 'desconocida');
}

function tokenDeCookie(req) {
  const m = new RegExp(`(?:^|; )${NOMBRE_COOKIE}=([0-9a-f]{64})(?:;|$)`).exec(req.headers.cookie || '');
  return m ? m[1] : null;
}

// Defensa CSRF adicional a SameSite=Strict: si llega Origin, debe ser el mismo sitio.
function origenPermitido(req) {
  const origen = req.headers.origin;
  if (!origen) return true;
  try {
    return new URL(origen).host === (req.headers['x-forwarded-host'] || req.headers.host);
  } catch {
    return false;
  }
}

// `responder` atiende el módulo comercial (compatibilidad); `responderes` es un mapa módulo -> responder.
function crearServidor({
  auth, limites, catalogo, responder = null, responderes = {}, gestor = null, gestorMeta = null, publicDir,
  log = datos => console.log(JSON.stringify(datos)), ahora = () => Date.now()
}) {
  const limpieza = setInterval(() => auth.limpiar(), 10 * 60 * 1000);
  limpieza.unref();

  const responderDe = modulo => (Object.prototype.hasOwnProperty.call(responderes, modulo) && responderes[modulo])
    || (modulo === 'sales' ? responder : null) || null;
  const hayIA = () => !!responder || Object.values(responderes).some(Boolean);

  function enviarEstatico(res, ruta) {
    const e = ESTATICOS[ruta];
    fs.readFile(path.join(publicDir, e.archivo), (err, contenido) => {
      if (err) { enviarJson(res, 404, { error: 'Archivo no encontrado.' }); return; }
      res.writeHead(200, cabecerasBase({ 'Content-Type': e.tipo, 'Cache-Control': e.cache }));
      res.end(contenido);
    });
  }

  // ---- Administración de usuarios y cambio de la propia clave ----
  // Mientras la clave sea temporal, solo se puede cambiarla (o cerrar sesión): todo lo demás responde 403.
  function exigirClaveVigente(res, usuario) {
    if (!auth.debeCambiarClave(usuario)) return false;
    enviarJson(res, 403, { error: 'Debes cambiar tu clave temporal antes de continuar.', codigo: 'cambiar_clave' });
    return true;
  }

  // Registro de auditoría de la administración: quién, qué y a quién. Nunca claves.
  const auditar = (accion, actor, objetivo, detalle) => log({ t: new Date(ahora()).toISOString(), evento: 'admin_usuarios', accion, actor, objetivo: objetivo || null, ...(detalle ? { detalle } : {}) });

  function errorUsuarios(res, e) {
    const codigo = e && e.codigo;
    if (!codigo) throw e;
    const extra = codigo === 'bloqueado' && e.retryAfterS ? { 'Retry-After': String(e.retryAfterS) } : {};
    return enviarJson(res, ESTADO_USUARIOS[codigo] || 400, { error: e.message, codigo }, extra);
  }

  async function manejarCuenta(req, res, usuario, ip) {
    const cuerpo = await leerJson(req, MAX_USUARIOS_BYTES);
    try {
      await auth.cambiarMiClave(usuario, cuerpo.actual, cuerpo.nueva, { ip, tokenActual: tokenDeCookie(req) });
    } catch (e) { return errorUsuarios(res, e); }
    auditar('cambiar_clave_propia', usuario, usuario);
    return enviarJson(res, 200, { ok: true });
  }

  async function manejarAdmin(req, res, url, usuario) {
    if (!auth.esAdmin(usuario)) return enviarJson(res, 403, { error: 'No tienes permiso para esta operación.', codigo: 'sin_permiso' });
    const partes = url.pathname.split('/').slice(3).map(x => { try { return decodeURIComponent(x); } catch { return ''; } }); // después de /api/admin/
    const metodo = req.method;
    try {
      if (partes[0] === 'usuarios' && partes.length === 1 && metodo === 'GET') return enviarJson(res, 200, { usuarios: auth.listarUsuarios() });
      if (partes[0] === 'usuarios' && partes.length === 1 && metodo === 'POST') {
        const c = await leerJson(req, MAX_USUARIOS_BYTES);
        const creado = await auth.crearUsuario({ usuario: c.usuario, clave: c.clave, modulos: c.modulos, rol: c.rol === undefined ? 'usuaria' : c.rol });
        auditar('crear', usuario, creado.usuario, { modulos: creado.modulos, rol: creado.rol });
        return enviarJson(res, 201, creado);
      }
      if (partes[0] === 'usuarios' && partes.length === 2 && metodo === 'PUT') {
        const c = await leerJson(req, MAX_USUARIOS_BYTES);
        const cambios = {};
        for (const k of ['modulos', 'rol', 'activo']) if (k in c) cambios[k] = c[k];
        const actualizado = await auth.actualizarUsuario(partes[1], cambios, usuario);
        auditar('actualizar', usuario, actualizado.usuario, cambios);
        return enviarJson(res, 200, actualizado);
      }
      if (partes[0] === 'usuarios' && partes.length === 3 && partes[2] === 'clave' && metodo === 'POST') {
        const c = await leerJson(req, MAX_USUARIOS_BYTES);
        const v = await auth.restablecerClave(partes[1], c.clave, usuario);
        auditar('restablecer_clave', usuario, v.usuario);
        return enviarJson(res, 200, v);
      }
    } catch (e) {
      if (e instanceof ErrorHttp) throw e;
      return errorUsuarios(res, e);
    }
    return enviarJson(res, 404, { error: 'Ruta no encontrada' });
  }

  // ---- Gestor de ventas ----
  async function manejarGestor(req, res, url, usuario) {
    if (!auth.modulosDe(usuario).includes('manager')) {
      return enviarJson(res, 403, { error: 'Este módulo no está habilitado para tu usuario.', codigo: 'modulo_no_permitido' });
    }
    if (!gestor) return enviarJson(res, 503, { error: 'El Gestor de ventas no está disponible en este momento.', codigo: 'gestor_no_disponible' });
    const ctx = { usuario, esAdmin: auth.esAdmin(usuario) };
    const partes = url.pathname.split('/').slice(3); // despues de /api/gestor/
    const metodo = req.method;
    const duena = url.searchParams.get('duena') || undefined;
    const q = url.searchParams;
    try {
      if (metodo === 'GET' && partes[0] === 'meta' && partes.length === 1) return enviarJson(res, 200, gestorMeta || {});
      if (metodo === 'GET' && partes[0] === 'indicadores' && partes.length === 1) return enviarJson(res, 200, gestor.indicadores(ctx, { duena }));
      if (metodo === 'GET' && partes[0] === 'usuarias' && partes.length === 1) {
        if (!ctx.esAdmin) return enviarJson(res, 403, { error: 'No tienes permiso para esta operación.', codigo: 'sin_permiso' });
        return enviarJson(res, 200, { usuarias: auth.usuariasConModulo('manager').filter(u => u !== usuario) });
      }
      if (metodo === 'GET' && partes[0] === 'accesos' && partes.length === 1) return enviarJson(res, 200, { accesos: gestor.consultarAccesos(ctx, { limite: q.get('limite') }) });
      if (metodo === 'GET' && partes[0] === 'recordatorios' && partes.length === 1) {
        return enviarJson(res, 200, { recordatorios: gestor.listarRecordatorios(ctx, { estado: q.get('estado') || 'pendientes', duena }) });
      }
      if (partes[0] === 'recordatorios' && partes[2] === 'completar' && partes.length === 3 && metodo === 'POST') {
        const cuerpo = await leerJson(req, MAX_GESTOR_BYTES);
        return enviarJson(res, 200, gestor.completarRecordatorio(ctx, partes[1], cuerpo.hecho !== false));
      }
      if (partes[0] === 'clientas') {
        if (partes.length === 1 && metodo === 'GET') {
          return enviarJson(res, 200, gestor.listar(ctx, { etapa: q.get('etapa') || undefined, q: q.get('q') || undefined, limite: q.get('limite'), desplazamiento: q.get('desplazamiento'), duena }));
        }
        if (partes.length === 1 && metodo === 'POST') return enviarJson(res, 201, gestor.crearClienta(ctx, await leerJson(req, MAX_GESTOR_BYTES)));
        const id = partes[1];
        if (partes.length === 2 && metodo === 'GET') return enviarJson(res, 200, gestor.obtener(ctx, id, { duena }));
        if (partes.length === 2 && metodo === 'PUT') return enviarJson(res, 200, gestor.actualizar(ctx, id, await leerJson(req, MAX_GESTOR_BYTES)));
        if (partes.length === 2 && metodo === 'DELETE') return enviarJson(res, 200, gestor.borrar(ctx, id));
        if (partes.length === 3 && partes[2] === 'exportar' && metodo === 'GET') return enviarJson(res, 200, gestor.exportar(ctx, id, { duena }));
        if (partes.length === 3 && partes[2] === 'recordatorios' && metodo === 'POST') {
          return enviarJson(res, 201, gestor.crearRecordatorio(ctx, id, await leerJson(req, MAX_GESTOR_BYTES)));
        }
      }
    } catch (e) {
      if (e instanceof ErrorHttp) throw e;
      if (e && e.codigo === 'descifrado_fallido') {
        log({ t: new Date(ahora()).toISOString(), evento: 'gestor_descifrado_fallido' });
        return enviarJson(res, 500, { error: 'No se pudo leer un dato guardado.', codigo: 'dato_ilegible' });
      }
      if (e && e.codigo) return enviarJson(res, ESTADO_GESTOR[e.codigo] || 400, { error: e.message, codigo: e.codigo });
      throw e;
    }
    return enviarJson(res, 404, { error: 'Ruta no encontrada' });
  }

  async function manejar(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    const ruta = url.pathname;
    const metodo = req.method;

    if (metodo === 'GET' && Object.prototype.hasOwnProperty.call(ESTATICOS, ruta)) return enviarEstatico(res, ruta);

    if (metodo === 'GET' && ruta === '/health') {
      return enviarJson(res, 200, {
        status: 'ok', application: 'Yanbal AI Assistant', version: VERSION,
        interface: 'available', ai: hayIA() ? 'connected' : 'not_connected', productos: catalogo.total
      });
    }

    if (metodo === 'GET' && ruta === '/api') {
      return enviarJson(res, 200, {
        message: 'Bienvenida a Yanbal AI Assistant',
        modules: ['Yanbal Content Studio', 'Yanbal Beauty Advisor', 'Yanbal Sales Manager']
      });
    }

    if (metodo === 'GET' && ruta === '/api/estado') {
      const e = catalogo.estado();
      return enviarJson(res, 200, { fecha: e.fecha, campana: e.campana, aviso_campana: e.aviso_campana, productos: catalogo.total });
    }

    if (metodo === 'GET' && ruta === '/api/sesion') {
      const usuario = auth.usuarioDeSesion(tokenDeCookie(req));
      return enviarJson(res, 200, { autenticada: !!usuario, usuario: usuario || null, modulos: usuario ? auth.modulosDe(usuario) : [], admin: usuario ? auth.esAdmin(usuario) : false, cambiar_clave: usuario ? auth.debeCambiarClave(usuario) : false });
    }

    if (ruta.startsWith('/api/admin/') || ruta === '/api/cuenta/clave') {
      if (metodo !== 'GET' && !origenPermitido(req)) return enviarJson(res, 403, { error: 'Origen no permitido.' });
      const usuarioA = auth.usuarioDeSesion(tokenDeCookie(req));
      if (!usuarioA) return enviarJson(res, 401, { error: 'Inicia sesión para continuar.' });
      if (ruta === '/api/cuenta/clave') {
        if (metodo !== 'POST') return enviarJson(res, 404, { error: 'Ruta no encontrada' });
        return manejarCuenta(req, res, usuarioA, ipDelCliente(req));
      }
      if (exigirClaveVigente(res, usuarioA)) return;
      return manejarAdmin(req, res, url, usuarioA);
    }

    if (ruta.startsWith('/api/gestor/')) {
      if (metodo !== 'GET' && !origenPermitido(req)) return enviarJson(res, 403, { error: 'Origen no permitido.' });
      const usuarioG = auth.usuarioDeSesion(tokenDeCookie(req));
      if (!usuarioG) return enviarJson(res, 401, { error: 'Inicia sesión para continuar.' });
      if (exigirClaveVigente(res, usuarioG)) return;
      return manejarGestor(req, res, url, usuarioG);
    }

    if (metodo === 'POST') {
      if (!origenPermitido(req)) return enviarJson(res, 403, { error: 'Origen no permitido.' });

      if (ruta === '/api/login') {
        const ip = ipDelCliente(req);
        const espera = auth.segundosBloqueo(ip);
        if (espera) return enviarJson(res, 429, { error: 'Demasiados intentos. Intenta de nuevo más tarde.' }, { 'Retry-After': String(espera) });
        let cuerpo;
        try { cuerpo = await leerJson(req, MAX_LOGIN_BYTES); } catch (e) {
          if (e instanceof ErrorHttp && e.estado === 413) return enviarJson(res, 413, { error: e.message });
          if (e instanceof ErrorHttp && e.estado === 415) return enviarJson(res, 415, { error: e.message });
          await auth.iniciarSesion('', '', ip); // un cuerpo inválido también cuenta como intento fallido
          return enviarJson(res, 400, { error: 'Solicitud no válida.' });
        }
        const r = await auth.iniciarSesion(cuerpo.usuario, cuerpo.clave, ip);
        if (r.ok) {
          return enviarJson(res, 200, { ok: true, usuario: r.usuario }, {
            'Set-Cookie': `${NOMBRE_COOKIE}=${r.token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${r.maxAgeS}`
          });
        }
        if (r.motivo === 'bloqueado') {
          return enviarJson(res, 429, { error: 'Demasiados intentos. Intenta de nuevo más tarde.' }, { 'Retry-After': String(r.retryAfterS) });
        }
        return enviarJson(res, 401, { error: 'Usuario o contraseña incorrectos.' });
      }

      if (ruta === '/api/logout') {
        const token = tokenDeCookie(req);
        if (token) auth.cerrarSesion(token);
        return enviarJson(res, 200, { ok: true }, {
          'Set-Cookie': `${NOMBRE_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`
        });
      }

      if (ruta === '/api/chat') {
        const usuario = auth.usuarioDeSesion(tokenDeCookie(req));
        if (!usuario) return enviarJson(res, 401, { error: 'Inicia sesión para continuar.' });
        if (exigirClaveVigente(res, usuario)) return;
        const cuerpo = await leerJson(req, MAX_CHAT_BYTES);
        const mensaje = typeof cuerpo.mensaje === 'string' ? cuerpo.mensaje.trim() : '';
        if (!mensaje) return enviarJson(res, 400, { error: 'Escribe un mensaje.' });
        if (mensaje.length > MAX_MENSAJE) return enviarJson(res, 413, { error: `El mensaje supera ${MAX_MENSAJE} caracteres.` });
        const modulo = cuerpo.modulo === undefined ? 'sales' : cuerpo.modulo;
        if (typeof modulo !== 'string' || !MODULOS_VALIDOS.includes(modulo)) return enviarJson(res, 400, { error: 'Módulo no válido.' });
        if (!auth.modulosDe(usuario).includes(modulo)) {
          return enviarJson(res, 403, { error: 'Este módulo no está habilitado para tu usuario.', codigo: 'modulo_no_permitido' });
        }
        const uso = limites.consumir(usuario);
        if (!uso.ok) {
          return enviarJson(res, 429, {
            error: uso.motivo === 'dia' ? 'Alcanzaste el límite diario de consultas.' : 'Demasiadas consultas seguidas. Espera un momento.'
          }, { 'Retry-After': String(uso.retryAfterS) });
        }
        const atender = responderDe(modulo);
        if (!atender) return enviarJson(res, 503, { error: 'El asistente no está disponible en este momento.', codigo: 'ia_no_disponible' });
        try {
          const r = await atender({ mensaje, usuario, catalogo, modulo });
          // Solo metadatos de consumo: nunca el texto del mensaje ni de la respuesta.
          if (r.uso) log({ t: new Date(ahora()).toISOString(), evento: 'chat', usuario, modulo, ...r.uso, caracteres: String(r.respuesta).length, respaldo: !!r.respaldo, motivo: r.motivo || null });
          return enviarJson(res, 200, {
            respuesta: String(r.respuesta),
            advertencias: Array.isArray(r.advertencias) ? r.advertencias : [],
            campana: catalogo.estado().campana
          });
        } catch (e) {
          const codigo = e && e.codigo ? String(e.codigo) : 'error';
          log({ t: new Date(ahora()).toISOString(), evento: 'responder_fallo', codigo });
          if (codigo === 'saldo_agotado') {
            return enviarJson(res, 503, { error: 'El asistente no está disponible: el saldo del proveedor de IA se agotó.', codigo });
          }
          if (codigo === 'ia_no_disponible' || codigo === 'tiempo_agotado') {
            return enviarJson(res, 503, { error: 'El asistente no está disponible en este momento.', codigo });
          }
          return enviarJson(res, 500, { error: 'Error interno.' });
        }
      }
    }

    return enviarJson(res, 404, { error: 'Ruta no encontrada' });
  }

  const servidor = http.createServer((req, res) => {
    const inicio = ahora();
    res.on('finish', () => {
      log({ t: new Date(inicio).toISOString(), metodo: req.method, ruta: (req.url || '').split('?')[0], estado: res.statusCode, ms: ahora() - inicio });
    });
    manejar(req, res).catch(e => {
      if (res.headersSent) { res.end(); return; }
      if (e instanceof ErrorHttp) { enviarJson(res, e.estado, { error: e.message }, e.estado === 413 ? { Connection: 'close' } : {}); return; }
      log({ t: new Date(inicio).toISOString(), evento: 'error_interno', tipo: e && e.name });
      enviarJson(res, 500, { error: 'Error interno.' });
    });
  });
  servidor.requestTimeout = 60000;
  servidor.headersTimeout = 15000;
  servidor.on('close', () => clearInterval(limpieza));
  return servidor;
}

// ---- Arranque ----
function arrancar() {
  const { cargarEnv, permisosInseguros } = require('./env');
  const { cargarProductos, cargarCampana, crearCatalogoProgramado } = require('./catalogo');
  const { crearAuth } = require('./auth');
  const { crearLimites } = require('./limites');

  const raiz = path.join(__dirname, '..');
  const rutaEnv = path.join(raiz, '.env');
  const cargadas = cargarEnv(rutaEnv);
  if (cargadas.length && permisosInseguros(rutaEnv)) {
    console.warn('AVISO: el archivo .env es legible por otros usuarios; usa chmod 600.');
  }

  const rutaLectura = process.env.CATALOGO_LECTURA || path.join(raiz, 'data', 'catalogo_lectura.json');
  const rutaCampana = process.env.CAMPANA || path.join(raiz, 'data', 'campana.json');
  const rutaUsuarios = process.env.USUARIOS || path.join(raiz, 'data', 'usuarios.json');

  let usuarios = {};
  let restoUsuarios = {};
  try {
    ({ usuarios, resto: restoUsuarios } = require('./usuarios-archivo').leerUsuarios(rutaUsuarios));
  } catch {
    console.warn('AVISO: no hay usuarios configurados; nadie podrá iniciar sesión.');
  }
  // Los cambios de usuarios (crear, claves, inactivar) se guardan con permisos 600, de forma atómica y con copia anterior.
  const guardarUsuarios = require('./usuarios-archivo').crearGuardado(rutaUsuarios, restoUsuarios);

  // Campaña siguiente (opcional): si sus dos archivos existen y son válidos, entra sola en su fecha de inicio.
  const rutaLecturaSiguiente = process.env.CATALOGO_LECTURA_SIGUIENTE || path.join(raiz, 'data', 'catalogo_lectura_siguiente.json');
  const rutaCampanaSiguiente = process.env.CAMPANA_SIGUIENTE || path.join(raiz, 'data', 'campana_siguiente.json');
  let siguiente = null;
  if (fs.existsSync(rutaLecturaSiguiente) && fs.existsSync(rutaCampanaSiguiente)) {
    try {
      siguiente = { productos: cargarProductos(rutaLecturaSiguiente), campana: cargarCampana(rutaCampanaSiguiente) };
      if (!siguiente.campana || !siguiente.campana.vigencia_desde) throw new Error('campana_siguiente.json sin vigencia_desde');
    } catch (e) {
      siguiente = null;
      console.warn(`AVISO: la campaña siguiente no es válida y se ignora (${e.message}).`);
    }
  }
  const catalogo = crearCatalogoProgramado({
    actual: { productos: cargarProductos(rutaLectura), campana: cargarCampana(rutaCampana) }, siguiente
  });
  if (siguiente) {
    const p = catalogo.programacion().siguiente;
    console.log(`Campaña siguiente programada: ${p.nombre} (${p.productos} productos), entra en vigor el ${p.desde}.`);
  }

  // Un agente por módulo. Sin llave de IA todos valen null y el servicio responde "IA no conectada".
  const responderes = {
    sales: require('./ia').crearResponder({ catalogo }),
    content: require('./contenido').crearResponderContenido({ catalogo })
  };
  const responder = null;

  // Gestor de ventas: requiere SQLite integrado (Node 22+) y la llave de cifrado GESTOR_LLAVE. Sin alguno de los dos, el
  // servidor arranca igual y el módulo responde "no disponible".
  let gestor = null;
  let gestorMeta = null;
  const { sqliteDisponible, abrirBase, crearGestor, ETAPAS, ETAPAS_ROTULO, TEXTO_CONSENTIMIENTO, CONSENTIMIENTO_VERSION } = require('./gestor');
  if (!sqliteDisponible()) {
    console.warn(`AVISO: el Gestor de ventas está desactivado: Node ${process.versions.node} no trae SQLite integrado (requiere Node 22 o superior).`);
  } else if (!process.env.GESTOR_LLAVE) {
    console.warn('AVISO: el Gestor de ventas está desactivado: falta GESTOR_LLAVE en .env (créala con scripts/crear-llave-gestor.js).');
  } else {
    try {
      const { crearCifrado } = require('./cifrado');
      const rutaDb = process.env.GESTOR_DB || path.join(raiz, 'data', 'gestor.db');
      gestor = crearGestor({ db: abrirBase(rutaDb), cifrado: crearCifrado(process.env.GESTOR_LLAVE) });
      gestorMeta = { etapas: ETAPAS.map(e => ({ id: e, rotulo: ETAPAS_ROTULO[e] })), consentimiento: { version: CONSENTIMIENTO_VERSION, texto: TEXTO_CONSENTIMIENTO } };
    } catch (e) {
      console.warn(`AVISO: el Gestor de ventas está desactivado (${e.codigo || e.name}).`);
    }
  }

  const servidor = crearServidor({
    auth: crearAuth({ usuarios, guardar: guardarUsuarios }),
    limites: crearLimites({
      porMinuto: Number(process.env.LIMITE_MINUTO) || 12,
      porDia: Number(process.env.LIMITE_DIA) || 200
    }),
    catalogo, responder, responderes, gestor, gestorMeta, publicDir: path.join(raiz, 'public')
  });

  const puerto = Number(process.env.PORT) || 3080;
  servidor.listen(puerto, '127.0.0.1', () => {
    const activos = Object.keys(responderes).filter(m => responderes[m]);
    console.log(`Yanbal AI Assistant ${VERSION} ejecutándose en el puerto ${puerto} (IA: ${activos.length ? 'conectada, módulos: ' + activos.join(', ') : 'no conectada'}; Gestor: ${gestor ? 'activo' : 'desactivado'})`);
  });
}

if (require.main === module) arrancar();

module.exports = { crearServidor, NOMBRE_COOKIE, MAX_MENSAJE, CSP };
