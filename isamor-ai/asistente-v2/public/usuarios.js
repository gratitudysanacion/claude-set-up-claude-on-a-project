'use strict';
// Administración de usuarios (solo administradora) y cambio de la propia clave. Todo el contenido dinámico se escribe
// con textContent (nunca HTML). Las claves se escriben en campos de tipo password y no se guardan en ninguna variable
// más allá del envío; tras enviarlas, los campos se vacían.
(() => {
  const MODULOS = [
    { id: 'sales', rotulo: 'Asistente comercial' }, { id: 'beauty', rotulo: 'Asesor de belleza' },
    { id: 'content', rotulo: 'Estudio de contenido' }, { id: 'manager', rotulo: 'Gestor de ventas' }
  ];
  const rotuloModulo = id => (MODULOS.find(m => m.id === id) || { rotulo: id }).rotulo;
  const MIN_CLAVE = 12;
  const S = { usuario: null, lista: [], alSesionVencida: () => {}, abierto: null };
  const areaUsuarios = document.getElementById('users-area');
  const areaCuenta = document.getElementById('cuenta-area');

  async function llamar(ruta, { metodo = 'GET', cuerpo } = {}) {
    const opciones = { method: metodo, headers: {}, credentials: 'same-origin' };
    if (cuerpo !== undefined) { opciones.headers['Content-Type'] = 'application/json'; opciones.body = JSON.stringify(cuerpo); }
    const r = await fetch(ruta, opciones);
    let datos = null;
    try { datos = await r.json(); } catch { /* sin cuerpo JSON */ }
    return { estado: r.status, datos: datos || {}, reintento: Number(r.headers.get('Retry-After')) || 0 };
  }

  function el(etiqueta, atributos = {}, ...hijos) {
    const nodo = document.createElement(etiqueta);
    for (const [k, v] of Object.entries(atributos)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'clase') nodo.className = v;
      else if (k === 'texto') nodo.textContent = v;
      else if (k.startsWith('al')) nodo.addEventListener(k.slice(2).toLowerCase(), v);
      else nodo.setAttribute(k, v === true ? '' : v);
    }
    for (const h of hijos.flat()) if (h !== undefined && h !== null && h !== false) nodo.append(h);
    return nodo;
  }

  const fechaHora = iso => {
    if (!iso) return 'Nunca';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'short', timeStyle: 'short' }).format(d);
  };
  const mostrarNodo = (nodo, visible) => nodo.classList.toggle('hidden', !visible);

  function aviso(contenedor, texto, tipo = '') {
    const caja = contenedor.querySelector('.us-mensaje');
    if (!caja) return;
    caja.textContent = texto || '';
    caja.className = `us-mensaje ${tipo}`.trim();
    mostrarNodo(caja, !!texto);
  }

  // true = el error ya se atendió.
  function falla(contenedor, r, textoPorDefecto = 'No se pudo completar la acción. Inténtalo de nuevo.') {
    if (r.estado === 401) { S.alSesionVencida(); return true; }
    if (r.estado === 429) {
      const min = Math.max(1, Math.ceil((r.reintento || 60) / 60));
      aviso(contenedor, `Demasiados intentos. Espera ${min} minuto(s) e inténtalo de nuevo.`, 'error');
      return true;
    }
    aviso(contenedor, (r.datos && r.datos.error) || textoPorDefecto, 'error');
    return true;
  }

  function campoClave(id, etiqueta, ayuda) {
    return el('label', { clase: 'us-campo', for: id }, el('span', { texto: etiqueta }),
      el('input', { id, type: 'password', autocomplete: 'new-password', maxlength: '200', required: true }), ayuda ? el('small', { texto: ayuda }) : null);
  }

  function checksModulos(prefijo, seleccionados) {
    return el('fieldset', { clase: 'us-modulos' }, el('legend', { texto: 'Módulos permitidos' }),
      ...MODULOS.map(m => el('label', { clase: 'us-check' },
        el('input', { type: 'checkbox', value: m.id, id: `${prefijo}-${m.id}`, checked: seleccionados.includes(m.id) }), el('span', { texto: m.rotulo }))));
  }
  const modulosMarcados = contenedor => [...contenedor.querySelectorAll('.us-modulos input:checked')].map(i => i.value);

  // ---------- Lista de usuarios ----------
  async function cargar() {
    const r = await llamar('/api/admin/usuarios');
    if (r.estado !== 200) { if (r.estado === 401) { S.alSesionVencida(); return; } aviso(areaUsuarios, (r.datos && r.datos.error) || 'No se pudo cargar la lista de usuarios.', 'error'); return; }
    S.lista = r.datos.usuarios;
    pintar();
  }

  function pintar() {
    const filas = S.lista.map(u => {
      const esYo = u.usuario === S.usuario;
      return el('tr', { 'data-usuario': u.usuario, clase: u.activo ? '' : 'inactivo' },
        el('td', {}, el('strong', { texto: u.usuario }), esYo ? el('small', { clase: 'us-tu', texto: ' (tú)' }) : null,
          u.cambiar_clave ? el('small', { clase: 'us-pendiente', texto: 'Clave temporal pendiente de cambio' }) : null),
        el('td', { texto: u.rol === 'admin' ? 'Administradora' : 'Usuaria' }),
        el('td', { texto: u.modulos.map(rotuloModulo).join(', ') }),
        el('td', {}, el('span', { clase: `us-estado ${u.activo ? 'activo' : 'inactivo'}`, texto: u.activo ? 'Activo' : 'Inactivo' })),
        el('td', { texto: fechaHora(u.ultimo_acceso) }),
        el('td', {}, el('div', { clase: 'us-acciones' },
          el('button', { type: 'button', clase: 'secondary', 'data-accion': 'editar', texto: 'Módulos y rol', alClick: () => abrirEdicion(u) }),
          esYo ? null : el('button', { type: 'button', clase: 'secondary', 'data-accion': 'clave', texto: 'Restablecer clave', alClick: () => abrirReinicio(u) }),
          esYo ? null : el('button', { type: 'button', clase: u.activo ? 'us-peligro' : 'secondary', 'data-accion': 'estado', texto: u.activo ? 'Inactivar' : 'Reactivar', alClick: () => cambiarEstado(u) }))));
    });
    areaUsuarios.querySelector('#us-lista').replaceChildren(
      el('table', { clase: 'us-tabla' },
        el('thead', {}, el('tr', {}, ...['Usuario', 'Rol', 'Módulos', 'Estado', 'Último acceso', 'Acciones'].map(t => el('th', { texto: t })))),
        el('tbody', {}, ...filas)));
  }

  // ---------- Panel auxiliar (editar, restablecer) ----------
  function panel(titulo, ...contenido) {
    const caja = areaUsuarios.querySelector('#us-panel');
    caja.replaceChildren(el('h4', { texto: titulo, tabindex: '-1', id: 'us-panel-titulo' }), ...contenido);
    mostrarNodo(caja, true);
    areaUsuarios.querySelector('#us-panel-titulo').focus({ preventScroll: false });
    return caja;
  }
  function cerrarPanel() { const caja = areaUsuarios.querySelector('#us-panel'); caja.replaceChildren(); mostrarNodo(caja, false); }

  function abrirEdicion(u) {
    const esYo = u.usuario === S.usuario;
    const rol = el('input', { type: 'checkbox', id: 'us-ed-rol', checked: u.rol === 'admin', disabled: esYo });
    const form = el('form', { clase: 'us-form', id: 'us-form-edicion', novalidate: true },
      checksModulos('us-ed', u.modulos),
      el('label', { clase: 'us-check' }, rol, el('span', { texto: esYo ? 'Administradora (no puedes quitarte este rol)' : 'Administradora (puede crear usuarios y cambiar claves)' })),
      el('div', { clase: 'us-botones' }, el('button', { type: 'submit', clase: 'primary', texto: 'Guardar cambios' }),
        el('button', { type: 'button', clase: 'secondary', texto: 'Cancelar', alClick: cerrarPanel })));
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const modulos = modulosMarcados(form);
      if (!modulos.length) { aviso(areaUsuarios, 'Elige al menos un módulo.', 'error'); return; }
      const cuerpo = { modulos };
      if (!esYo) cuerpo.rol = rol.checked ? 'admin' : 'usuaria';
      const r = await llamar(`/api/admin/usuarios/${encodeURIComponent(u.usuario)}`, { metodo: 'PUT', cuerpo });
      if (r.estado !== 200) { falla(areaUsuarios, r); return; }
      cerrarPanel(); await cargar(); aviso(areaUsuarios, `Cambios guardados para ${u.usuario}.`, 'ok');
    });
    panel(`Módulos y rol de ${u.usuario}`, form);
  }

  function abrirReinicio(u) {
    const form = el('form', { clase: 'us-form', id: 'us-form-reinicio', novalidate: true },
      el('p', { texto: `Pon una clave temporal para ${u.usuario}. Al entrar, tendrá que cambiarla por una suya, y sus sesiones abiertas se cerrarán ahora. Compártesela por un canal seguro; no se vuelve a mostrar.` }),
      campoClave('us-rein-clave', `Clave temporal (mínimo ${MIN_CLAVE} caracteres)`),
      el('div', { clase: 'us-botones' }, el('button', { type: 'submit', clase: 'primary', texto: 'Restablecer clave' }),
        el('button', { type: 'button', clase: 'secondary', texto: 'Cancelar', alClick: cerrarPanel })));
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const campo = form.querySelector('#us-rein-clave');
      if (campo.value.length < MIN_CLAVE) { aviso(areaUsuarios, `La clave debe tener al menos ${MIN_CLAVE} caracteres.`, 'error'); return; }
      const r = await llamar(`/api/admin/usuarios/${encodeURIComponent(u.usuario)}/clave`, { metodo: 'POST', cuerpo: { clave: campo.value } });
      campo.value = '';
      if (r.estado !== 200) { falla(areaUsuarios, r); return; }
      cerrarPanel(); await cargar(); aviso(areaUsuarios, `Clave temporal puesta a ${u.usuario}. Deberá cambiarla al entrar.`, 'ok');
    });
    panel(`Restablecer la clave de ${u.usuario}`, form);
  }

  function cambiarEstado(u) {
    const activar = !u.activo;
    const texto = activar
      ? `${u.usuario} podrá volver a entrar con su clave actual.`
      : `${u.usuario} no podrá entrar y sus sesiones abiertas se cerrarán ahora. No se borra nada; puedes reactivarla cuando quieras.`;
    panel(`${activar ? 'Reactivar' : 'Inactivar'} a ${u.usuario}`, el('p', { texto }),
      el('div', { clase: 'us-botones' },
        el('button', { type: 'button', id: 'us-confirmar-estado', clase: activar ? 'primary' : 'us-peligro', texto: activar ? 'Sí, reactivar' : 'Sí, inactivar', alClick: async () => {
          const r = await llamar(`/api/admin/usuarios/${encodeURIComponent(u.usuario)}`, { metodo: 'PUT', cuerpo: { activo: activar } });
          if (r.estado !== 200) { falla(areaUsuarios, r); return; }
          cerrarPanel(); await cargar(); aviso(areaUsuarios, `${u.usuario} quedó ${activar ? 'activo' : 'inactivo'}.`, 'ok');
        } }),
        el('button', { type: 'button', clase: 'secondary', texto: 'Cancelar', alClick: cerrarPanel })));
  }

  // ---------- Nuevo usuario ----------
  function formularioNuevo() {
    const usuario = el('input', { id: 'us-nuevo-usuario', type: 'text', maxlength: '32', autocomplete: 'off', required: true, autocapitalize: 'none', spellcheck: 'false' });
    const rol = el('input', { type: 'checkbox', id: 'us-nuevo-rol' });
    const form = el('form', { clase: 'us-form', id: 'us-form-nuevo', novalidate: true },
      el('div', { clase: 'us-rejilla' },
        el('label', { clase: 'us-campo', for: 'us-nuevo-usuario' }, el('span', { texto: 'Usuario' }), usuario, el('small', { texto: 'De 3 a 32 caracteres: minúsculas, números, punto, guion o guion bajo.' })),
        campoClave('us-nuevo-clave', `Clave temporal (mínimo ${MIN_CLAVE} caracteres)`, 'La persona deberá cambiarla al entrar por primera vez.')),
      checksModulos('us-nuevo', ['sales']),
      el('label', { clase: 'us-check' }, rol, el('span', { texto: 'Administradora (puede crear usuarios y cambiar claves)' })),
      el('div', { clase: 'us-botones' }, el('button', { type: 'submit', clase: 'primary', id: 'us-crear', texto: 'Crear usuario' })));
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const clave = form.querySelector('#us-nuevo-clave');
      const nombre = usuario.value.trim().toLowerCase();
      const modulos = modulosMarcados(form);
      if (!nombre) { aviso(areaUsuarios, 'Escribe el usuario.', 'error'); usuario.focus(); return; }
      if (clave.value.length < MIN_CLAVE) { aviso(areaUsuarios, `La clave temporal debe tener al menos ${MIN_CLAVE} caracteres.`, 'error'); clave.focus(); return; }
      if (!modulos.length) { aviso(areaUsuarios, 'Elige al menos un módulo.', 'error'); return; }
      const r = await llamar('/api/admin/usuarios', { metodo: 'POST', cuerpo: { usuario: nombre, clave: clave.value, modulos, rol: rol.checked ? 'admin' : 'usuaria' } });
      clave.value = '';
      if (r.estado !== 201) { falla(areaUsuarios, r); return; }
      usuario.value = ''; rol.checked = false;
      await cargar();
      aviso(areaUsuarios, `Usuario ${nombre} creado. Dale su clave temporal por un canal seguro: deberá cambiarla al entrar.`, 'ok');
    });
    return form;
  }

  function armarUsuarios() {
    areaUsuarios.replaceChildren(
      el('div', { id: 'us-mensaje', clase: 'us-mensaje hidden', role: 'status' }),
      el('section', { clase: 'us-seccion' }, el('h3', { texto: 'Usuarios' }), el('div', { id: 'us-lista', 'aria-live': 'polite' })),
      el('section', { id: 'us-panel', clase: 'us-seccion us-panel hidden', 'aria-live': 'polite' }),
      el('section', { clase: 'us-seccion' }, el('h3', { texto: 'Nuevo usuario' }), formularioNuevo()));
  }

  async function abrir({ usuario, alSesionVencida }) {
    S.usuario = usuario; S.alSesionVencida = alSesionVencida || (() => {}); S.abierto = 'usuarios';
    armarUsuarios();
    await cargar();
  }

  // ---------- Cambio de la propia clave ----------
  // obligatorio: la clave actual es temporal y no se puede usar nada más hasta cambiarla.
  function abrirCuenta({ usuario, obligatorio = false, alTerminar, alCancelar, alSesionVencida }) {
    S.usuario = usuario; S.alSesionVencida = alSesionVencida || (() => {}); S.abierto = 'cuenta';
    const form = el('form', { clase: 'us-form', id: 'cuenta-form', novalidate: true },
      obligatorio ? el('p', { clase: 'us-aviso-fuerte', texto: 'Tu clave actual es temporal. Cámbiala por una tuya para poder continuar.' }) : null,
      campoClave('cuenta-actual', 'Clave actual'),
      campoClave('cuenta-nueva', `Clave nueva (mínimo ${MIN_CLAVE} caracteres)`, 'No uses tu usuario ni un mismo carácter repetido.'),
      campoClave('cuenta-repetir', 'Repite la clave nueva'),
      el('div', { clase: 'us-botones' }, el('button', { type: 'submit', clase: 'primary', id: 'cuenta-guardar', texto: 'Cambiar mi clave' }),
        obligatorio ? null : el('button', { type: 'button', clase: 'secondary', id: 'cuenta-cancelar', texto: 'Cancelar', alClick: () => alCancelar && alCancelar() })));
    areaCuenta.replaceChildren(el('div', { id: 'cuenta-mensaje', clase: 'us-mensaje hidden', role: 'status' }), el('h3', { texto: obligatorio ? 'Cambia tu clave temporal' : 'Cambiar mi clave' }), form);
    const msg = (t, tipo) => { const c = areaCuenta.querySelector('#cuenta-mensaje'); c.textContent = t; c.className = `us-mensaje ${tipo}`.trim(); mostrarNodo(c, !!t); };
    const campos = ['#cuenta-actual', '#cuenta-nueva', '#cuenta-repetir'].map(s => form.querySelector(s));
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const [actual, nueva, repetir] = campos;
      if (nueva.value.length < MIN_CLAVE) { msg(`La clave nueva debe tener al menos ${MIN_CLAVE} caracteres.`, 'error'); nueva.focus(); return; }
      if (nueva.value !== repetir.value) { msg('Las claves nuevas no coinciden.', 'error'); repetir.focus(); return; }
      const guardar = form.querySelector('#cuenta-guardar');
      guardar.disabled = true;
      try {
        const r = await llamar('/api/cuenta/clave', { metodo: 'POST', cuerpo: { actual: actual.value, nueva: nueva.value } });
        campos.forEach(c => { c.value = ''; });
        if (r.estado === 200) { msg('Clave cambiada.', 'ok'); if (alTerminar) await alTerminar(); return; }
        if (r.estado === 401) { S.alSesionVencida(); return; }
        if (r.estado === 429) { msg(`Demasiados intentos. Espera ${Math.max(1, Math.ceil((r.reintento || 60) / 60))} minuto(s).`, 'error'); return; }
        msg((r.datos && r.datos.error) || 'No se pudo cambiar la clave.', 'error');
      } catch { msg('No pude conectar con el servidor.', 'error'); } finally { guardar.disabled = false; }
    });
    campos[0].focus();
  }

  // Vacía las pantallas: no deben quedar nombres de usuarios ni campos de clave al cerrar la sesión.
  function cerrar() {
    S.lista = []; S.usuario = null; S.abierto = null;
    areaUsuarios.replaceChildren();
    areaCuenta.replaceChildren();
  }

  window.Usuarios = { abrir, abrirCuenta, cerrar };
})();
