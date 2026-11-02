'use strict';
// Interfaz del Asistente comercial. Todo el contenido dinámico se escribe con textContent (nunca HTML).

const MAX_MENSAJE = 1500;
// El aviso fijo "Catálogo en revisión" ya cubre esta advertencia; no se repite bajo cada respuesta.
const ADVERTENCIAS_CUBIERTAS = new Set(['Dato pendiente de revisión.']);

const modules = {
  sales: {
    title: 'Asistente comercial',
    description: 'Consulta precios, ofertas y vigencias del catálogo.',
    live: true,
    bienvenida: 'Hola. Escribe el nombre o el código de un producto y te muestro su precio normal, su oferta y la vigencia. Si falta un dato, te lo diré.',
    prompts: [
      '¿Cuánto cuesta la crema corporal Biomilk?',
      '¿Qué labiales están en oferta?',
      'Busca el producto con código de referencia 670.'
    ]
  },
  beauty: {
    title: 'Asesor de belleza',
    description: 'Organiza tus consultas de belleza sin inventar características de productos.',
    prompts: [
      'Quiero organizar una consulta sobre perfumes.',
      'Necesito estructurar una recomendación de maquillaje.',
      'Quiero comparar productos con información verificada.'
    ]
  },
  content: {
    title: 'Estudio de contenido',
    description: 'Crea guiones, descripciones, hashtags y textos de WhatsApp con precios y vigencias del catálogo.',
    live: true,
    copiable: true,
    bienvenida: 'Hola. Dime qué producto quieres promocionar y en qué formato (Reel, historia, publicación o WhatsApp). Te entrego descripción, hashtags y, si aplica, precios con su vigencia. No uso milagros ni promesas de curas.',
    prompts: [
      'Crea un guion de Reel de 15 segundos para el producto 5104, con descripción y hashtags.',
      'Escribe un texto de WhatsApp para ofrecer el Zentro Eau de Parfum.',
      'Dame 3 variantes (cercano, elegante y divertido) para promocionar un labial.'
    ]
  },
  users: {
    title: 'Usuarios',
    description: 'Crea usuarios, restablece claves, cambia módulos y activa o inactiva el acceso.',
    live: true,
    usuarios: true,
    prompts: []
  },
  manager: {
    title: 'Gestor de ventas',
    description: 'Tus clientas, su etapa de seguimiento y tus recordatorios. Los datos personales se guardan cifrados.',
    live: true,
    gestor: true,
    prompts: []
  }
};

const $ = id => document.getElementById(id);
const homeSection = $('home-section');
const welcome = $('welcome');
const workspace = $('workspace');
const chatLog = $('chat-log');
const input = $('message-input');
const sendButton = $('send');

let moduloActual = 'home';
let usuarioActual = null;
let modulosPermitidos = [];
let adminActual = false;
let cambiarClaveActual = false;
let enviando = false;

// ---- Utilidades ----
function fechaCorta(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

function mostrar(elemento, visible) {
  elemento.classList.toggle('hidden', !visible);
}

// El módulo Usuarios no depende de la lista de módulos: lo pueden usar solo las administradoras.
function moduloPermitido(clave) {
  return clave === 'users' ? adminActual : modulosPermitidos.includes(clave);
}

// Guarda lo que informa /api/sesion y muestra u oculta el menú Usuarios.
function aplicarSesion(datos) {
  usuarioActual = datos.usuario || usuarioActual || 'usuaria';
  modulosPermitidos = Array.isArray(datos.modulos) ? datos.modulos : [];
  adminActual = datos.admin === true;
  cambiarClaveActual = datos.cambiar_clave === true;
  mostrar($('nav-users'), adminActual);
}

async function refrescarSesion() {
  const s = await api('/api/sesion').catch(() => null);
  if (s && s.estado === 200 && s.datos.autenticada) { aplicarSesion(s.datos); mostrarSegunPermiso(); } else alSesionVencida();
}

function alSesionVencida() {
  chatLog.replaceChildren();
  mostrarLogin('Tu sesión terminó. Inicia sesión de nuevo.');
}

async function api(ruta, { metodo = 'GET', cuerpo } = {}) {
  const opciones = { method: metodo, headers: {}, credentials: 'same-origin' };
  if (cuerpo !== undefined) {
    opciones.headers['Content-Type'] = 'application/json';
    opciones.body = JSON.stringify(cuerpo);
  }
  const respuesta = await fetch(ruta, opciones);
  let datos = null;
  try { datos = await respuesta.json(); } catch { /* sin cuerpo JSON */ }
  return { estado: respuesta.status, datos: datos || {}, reintento: Number(respuesta.headers.get('Retry-After')) || 0 };
}

function agregarMensaje(texto, tipo) {
  const item = document.createElement('div');
  item.className = `message ${tipo}`;
  item.textContent = texto;
  chatLog.appendChild(item);
  item.scrollIntoView({ block: 'nearest' });
  return item;
}

function agregarAdvertencias(lista) {
  const visibles = (lista || []).filter(a => typeof a === 'string' && !ADVERTENCIAS_CUBIERTAS.has(a));
  if (!visibles.length) return;
  const ul = document.createElement('ul');
  ul.className = 'message-warnings';
  for (const texto of visibles) {
    const li = document.createElement('li');
    li.textContent = `⚠ ${texto}`;
    ul.appendChild(li);
  }
  chatLog.appendChild(ul);
}

function agregarBotonCopiar(mensaje) {
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'copy-btn';
  boton.textContent = 'Copiar texto';
  boton.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(mensaje.textContent); boton.textContent = 'Copiado ✓'; } catch { boton.textContent = 'Selecciona el texto y cópialo'; }
    setTimeout(() => { boton.textContent = 'Copiar texto'; }, 2500);
  });
  mensaje.after(boton);
}

// ---- Campaña ----
function describirCampana(c) {
  if (!c) return { texto: 'No se pudo consultar la vigencia de la campaña. Confírmala antes de ofrecer.', nivel: 'warn' };
  const nombre = c.nombre ? `Campaña ${c.nombre}` : 'Campaña';
  switch (c.estado) {
    case 'vigente': {
      const base = `${nombre}: vigente del ${fechaCorta(c.desde)} al ${fechaCorta(c.hasta)}.`;
      return c.termina_pronto
        ? { texto: `${base} Termina en ${c.dias_restantes} día(s).`, nivel: 'warn' }
        : { texto: base, nivel: '' };
    }
    case 'vencida':
      return { texto: `${nombre} terminó el ${fechaCorta(c.hasta)}. Los precios mostrados son de referencia: no los ofrezcas como vigentes.`, nivel: 'alert' };
    case 'aun_no_rige':
      return { texto: `${nombre} aún no rige (desde el ${fechaCorta(c.desde)}).`, nivel: 'warn' };
    default:
      return { texto: 'No hay vigencia de campaña configurada. Confirma la vigencia antes de ofrecer.', nivel: 'warn' };
  }
}

function pintarCampana(c) {
  const { texto, nivel } = describirCampana(c);
  const caja = $('campaign');
  caja.textContent = texto;
  caja.className = `campaign ${nivel}`.trim();
}

// ---- Sesión ----
function mostrarLogin(mensaje = '') {
  usuarioActual = null;
  modulosPermitidos = [];
  adminActual = false;
  cambiarClaveActual = false;
  mostrar($('nav-users'), false);
  mostrar($('users-area'), false);
  mostrar($('manager-area'), false);
  mostrar($('cuenta-area'), false);
  if (window.Usuarios) window.Usuarios.cerrar();
  if (window.Gestor) window.Gestor.cerrar();
  mostrar($('session-bar'), false);
  mostrar($('sin-permiso'), false);
  mostrar($('login-form'), true);
  mostrar($('chat-area'), false);
  $('login-error').textContent = mensaje;
  $('login-user').focus();
}

function mostrarChat() {
  const esUsuarios = moduloActual === 'users';
  const esGestor = moduloActual === 'manager';
  mostrar($('login-form'), false);
  mostrar($('sin-permiso'), false);
  mostrar($('cuenta-area'), false);
  mostrar($('chat-area'), !esUsuarios && !esGestor);
  mostrar($('users-area'), esUsuarios);
  mostrar($('manager-area'), esGestor);
  mostrar($('session-bar'), true);
  mostrar($('change-pass'), true);
  $('session-user').textContent = `Sesión de ${usuarioActual}`;
  if (esUsuarios) { window.Usuarios.abrir({ usuario: usuarioActual, alSesionVencida }); return; }
  if (esGestor) { window.Gestor.abrir({ usuario: usuarioActual, admin: adminActual, alSesionVencida }); return; }
  const bienvenida = modules[moduloActual] && modules[moduloActual].bienvenida;
  if (!chatLog.children.length && bienvenida) agregarMensaje(bienvenida, 'assistant');
}

// Sesión válida: muestra el chat si el módulo está habilitado para el usuario; si no, lo explica sin mostrar el chat.
function mostrarSegunPermiso() {
  if (cambiarClaveActual) { mostrarCuenta(true); return; }   // la clave temporal se cambia antes de usar cualquier módulo
  if (moduloPermitido(moduloActual)) { mostrarChat(); return; }
  mostrar($('login-form'), false);
  mostrar($('chat-area'), false);
  mostrar($('users-area'), false);
  mostrar($('manager-area'), false);
  mostrar($('cuenta-area'), false);
  mostrar($('session-bar'), true);
  mostrar($('sin-permiso'), true);
  $('session-user').textContent = `Sesión de ${usuarioActual}`;
}

// Pantalla de cambio de clave. obligatorio = la clave actual es temporal y no se puede hacer nada más.
function mostrarCuenta(obligatorio) {
  mostrar($('login-form'), false);
  mostrar($('sin-permiso'), false);
  mostrar($('chat-area'), false);
  mostrar($('users-area'), false);
  mostrar($('manager-area'), false);
  mostrar($('cuenta-area'), true);
  mostrar($('session-bar'), true);
  mostrar($('change-pass'), !obligatorio);   // con clave temporal no hay otra opción que cambiarla
  $('session-user').textContent = `Sesión de ${usuarioActual}`;
  window.Usuarios.abrirCuenta({
    usuario: usuarioActual, obligatorio, alSesionVencida,
    alCancelar: () => mostrarSegunPermiso(),
    alTerminar: refrescarSesion
  });
}

async function prepararModuloVivo() {
  const [estado, sesion] = await Promise.all([
    api('/api/estado').catch(() => null),
    api('/api/sesion').catch(() => null)
  ]);
  pintarCampana(estado && estado.estado === 200 ? estado.datos.campana : null);
  if (sesion && sesion.estado === 200 && sesion.datos.autenticada) {
    aplicarSesion(sesion.datos);
    mostrarSegunPermiso();
  } else {
    mostrarLogin();
  }
}

$('login-form').addEventListener('submit', async evento => {
  evento.preventDefault();
  const boton = $('login-submit');
  const usuario = $('login-user').value.trim();
  const clave = $('login-pass').value;
  if (!usuario || !clave) return;
  boton.disabled = true;
  $('login-error').textContent = '';
  try {
    const r = await api('/api/login', { metodo: 'POST', cuerpo: { usuario, clave } });
    if (r.estado === 200) {
      $('login-pass').value = '';
      usuarioActual = r.datos.usuario || usuario;
      const s = await api('/api/sesion').catch(() => null);
      aplicarSesion(s && s.estado === 200 ? s.datos : { usuario: usuarioActual });
      mostrarSegunPermiso();
      if (!cambiarClaveActual && moduloPermitido(moduloActual) && moduloActual !== 'users' && moduloActual !== 'manager') input.focus();
    } else if (r.estado === 429) {
      const minutos = Math.max(1, Math.ceil(r.reintento / 60));
      $('login-error').textContent = `Demasiados intentos. Espera ${minutos} minuto(s) e inténtalo de nuevo.`;
    } else if (r.estado === 401) {
      $('login-error').textContent = 'Usuario o clave incorrectos.';
    } else {
      $('login-error').textContent = 'No se pudo iniciar sesión. Inténtalo de nuevo.';
    }
  } catch {
    $('login-error').textContent = 'No pude conectar con el servidor.';
  } finally {
    boton.disabled = false;
  }
});

$('logout').addEventListener('click', async () => {
  try { await api('/api/logout', { metodo: 'POST', cuerpo: {} }); } catch { /* aunque falle, se cierra la vista */ }
  chatLog.replaceChildren();
  mostrar($('session-bar'), false);
  mostrarLogin();
});

// ---- Chat ----
async function enviarConsulta(texto) {
  enviando = true;
  sendButton.disabled = true;
  agregarMensaje(texto, 'user');
  const pendiente = agregarMensaje('Consultando el catálogo…', 'assistant pending');
  try {
    const r = await api('/api/chat', { metodo: 'POST', cuerpo: { mensaje: texto, modulo: moduloActual } });
    if (r.estado === 200) {
      pendiente.className = 'message assistant';
      pendiente.textContent = String(r.datos.respuesta || '');
      agregarAdvertencias(r.datos.advertencias);
      if (modules[moduloActual] && modules[moduloActual].copiable) agregarBotonCopiar(pendiente);
      if (r.datos.campana) pintarCampana(r.datos.campana);
    } else if (r.estado === 401) {
      pendiente.remove();
      mostrarLogin('Tu sesión terminó. Inicia sesión de nuevo.');
    } else if (r.estado === 403 && r.datos.codigo === 'cambiar_clave') {
      pendiente.remove();
      cambiarClaveActual = true;
      mostrarCuenta(true);
    } else if (r.estado === 429) {
      const espera = r.reintento ? ` Inténtalo en ${r.reintento >= 60 ? Math.ceil(r.reintento / 60) + ' minuto(s)' : r.reintento + ' segundo(s)'}.` : '';
      pendiente.className = 'message assistant';
      pendiente.textContent = `${r.datos.error || 'Demasiadas consultas.'}${espera}`;
    } else {
      pendiente.className = 'message assistant';
      pendiente.textContent = r.datos.error || 'No pude responder en este momento. Inténtalo de nuevo en unos minutos.';
    }
  } catch {
    pendiente.className = 'message assistant';
    pendiente.textContent = 'No pude conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.';
  } finally {
    enviando = false;
    sendButton.disabled = false;
    input.focus();
  }
}

$('composer').addEventListener('submit', evento => {
  evento.preventDefault();
  const texto = input.value.trim();
  if (!texto) { input.focus(); return; }
  if (texto.length > MAX_MENSAJE) { agregarMensaje(`El mensaje supera ${MAX_MENSAJE} caracteres.`, 'assistant'); return; }
  input.value = '';
  if (modules[moduloActual] && modules[moduloActual].live) {
    if (!enviando) enviarConsulta(texto);
    return;
  }
  // Módulos aún no conectados: la solicitud no sale del navegador.
  agregarMensaje(texto, 'user');
  agregarMensaje('Este módulo todavía no está conectado. Tu solicitud solo quedó visible en esta pantalla y no se envió ni se guardó.', 'assistant');
});

input.addEventListener('keydown', evento => {
  if (evento.key === 'Enter' && !evento.shiftKey && !evento.isComposing) {
    evento.preventDefault();
    $('composer').requestSubmit();
  }
});

// ---- Navegación ----
function openModule(key) {
  if (window.Gestor) window.Gestor.cerrar();   // al salir del Gestor no quedan datos personales en la pantalla
  moduloActual = key;
  document.querySelectorAll('[data-module]').forEach(boton => {
    boton.classList.toggle('active', boton.dataset.module === key);
  });

  if (key === 'home') {
    mostrar(homeSection, true);
    mostrar(welcome, true);
    workspace.classList.remove('visible');
    return;
  }

  const seleccionado = modules[key];
  if (!seleccionado) return;

  mostrar(homeSection, false);
  mostrar(welcome, false);
  workspace.classList.add('visible');
  $('workspace-title').textContent = seleccionado.title;
  $('workspace-description').textContent = seleccionado.description;
  $('suggestions').replaceChildren();
  chatLog.replaceChildren();

  for (const prompt of seleccionado.prompts) {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.textContent = prompt;
    boton.addEventListener('click', () => { input.value = prompt; input.focus(); });
    $('suggestions').appendChild(boton);
  }

  mostrar($('demo-notice'), !seleccionado.live);
  mostrar($('sales-extras'), !!seleccionado.live && !seleccionado.usuarios && !seleccionado.gestor);
  mostrar($('login-form'), false);
  mostrar($('session-bar'), false);
  mostrar($('users-area'), false);
  mostrar($('manager-area'), false);
  mostrar($('cuenta-area'), false);
  mostrar($('chat-area'), !seleccionado.usuarios && !seleccionado.gestor);

  if (seleccionado.live) {
    prepararModuloVivo();
  } else {
    agregarMensaje('Bienvenida. Este módulo está preparado para organizar tu solicitud, pero todavía no está conectado a la IA.', 'assistant');
  }
}

document.querySelectorAll('[data-module]').forEach(boton => {
  boton.addEventListener('click', () => openModule(boton.dataset.module));
});
$('back-home').addEventListener('click', () => openModule('home'));

$('change-pass').addEventListener('click', () => mostrarCuenta(false));

// Si ya hay una sesión abierta (por ejemplo al recargar la página), el menú Usuarios aparece para las administradoras.
api('/api/sesion').then(s => { if (s.estado === 200 && s.datos.autenticada) { usuarioActual = s.datos.usuario; adminActual = s.datos.admin === true; mostrar($('nav-users'), adminActual); } }).catch(() => {});
