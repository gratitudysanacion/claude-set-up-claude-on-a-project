'use strict';
// Pantallas del Gestor de ventas. Todo el contenido dinámico se escribe con textContent (nunca HTML).
// Reglas: los datos personales solo viven en el DOM mientras la sesión está abierta (cerrar() lo vacía), y en modo
// soporte (administradora viendo a otra usuaria) la pantalla es de solo lectura.
(() => {
  const POR_PAGINA = 25;
  const raiz = document.getElementById('manager-area');
  const S = {
    meta: null, usuario: null, admin: false, duena: null, vista: 'lista', etapa: '', q: '',
    total: 0, clientas: [], actual: null, alSesionVencida: () => {}
  };
  const rotulo = id => ((S.meta && S.meta.etapas.find(e => e.id === id)) || { rotulo: id }).rotulo;
  const soloLectura = () => !!S.duena;

  // ---------- Utilidades ----------
  async function llamar(ruta, { metodo = 'GET', cuerpo } = {}) {
    const opciones = { method: metodo, headers: {}, credentials: 'same-origin' };
    if (cuerpo !== undefined) { opciones.headers['Content-Type'] = 'application/json'; opciones.body = JSON.stringify(cuerpo); }
    const r = await fetch(ruta, opciones);
    let datos = null;
    try { datos = await r.json(); } catch { /* sin cuerpo JSON */ }
    return { estado: r.status, datos: datos || {} };
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

  // replaceChildren escribe "null" como texto si recibe un valor vacío: se descartan antes.
  function reemplazar(nodo, ...hijos) {
    nodo.replaceChildren(...hijos.flat().filter(h => h !== undefined && h !== null && h !== false));
  }

  const hoyColombia = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const fechaCorta = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
  const fechaHora = iso => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'short', timeStyle: 'short' }).format(d);
  };
  const consulta = obj => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
    const t = p.toString();
    return t ? `?${t}` : '';
  };
  const conDuena = (extra = {}) => ({ ...extra, duena: S.duena || undefined });

  function aviso(texto, tipo = '') {
    const caja = raiz.querySelector('#mg-mensaje');
    if (!caja) return;
    caja.textContent = texto || '';
    caja.className = `mg-mensaje ${tipo}`.trim();
    mostrarNodo(caja, !!texto);
  }
  function mostrarNodo(nodo, visible) { nodo.classList.toggle('hidden', !visible); }

  // Devuelve true si el error quedó atendido (el llamador no debe seguir).
  function falla(r, textoPorDefecto = 'No se pudo completar la acción. Inténtalo de nuevo.') {
    if (r.estado === 401) { S.alSesionVencida(); return true; }
    if (r.estado === 503) { aviso('El Gestor de ventas no está disponible en este momento.', 'error'); return true; }
    if (r.estado === 403) { aviso('No tienes permiso para esta acción.', 'error'); return true; }
    if (r.estado === 404) { aviso('No se encontró lo que buscas. Puede que ya se haya borrado.', 'error'); return true; }
    aviso((r.datos && r.datos.error) || textoPorDefecto, 'error');
    return true;
  }

  // ---------- Estructura base ----------
  function armarBase() {
    reemplazar(raiz,
      el('div', { clase: 'mg-pestanas', role: 'tablist', 'aria-label': 'Secciones del Gestor' },
        pestana('lista', 'Clientas'), pestana('recordatorios', 'Recordatorios'), S.admin ? pestana('soporte', 'Soporte') : null),
      el('div', { id: 'mg-modo', clase: 'mg-modo hidden', role: 'status' }),
      el('div', { id: 'mg-mensaje', clase: 'mg-mensaje hidden', role: 'status' }),
      el('div', { id: 'mg-indicadores', clase: 'mg-kpis' }),
      el('section', { id: 'mg-contenido', 'aria-live': 'polite' })
    );
  }
  function pestana(id, texto) {
    return el('button', { type: 'button', role: 'tab', 'data-vista': id, clase: 'mg-pestana', texto, alClick: () => irA(id) });
  }
  function marcarPestana() {
    const activa = S.vista === 'ficha' || S.vista === 'nueva' ? 'lista' : S.vista;
    raiz.querySelectorAll('.mg-pestana').forEach(b => {
      const on = b.dataset.vista === activa;
      b.classList.toggle('activa', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    const modo = raiz.querySelector('#mg-modo');
    if (soloLectura()) {
      modo.textContent = `Modo soporte (solo lectura): estás viendo las clientas de ${S.duena}. Cada consulta queda registrada.`;
      mostrarNodo(modo, true);
    } else mostrarNodo(modo, false);
  }
  async function irA(vista) {
    aviso('');
    S.vista = vista;
    marcarPestana();
    if (vista === 'lista') { await cargarIndicadores(); await cargarLista(); }
    else if (vista === 'recordatorios') await vistaRecordatorios();
    else if (vista === 'soporte') await vistaSoporte();
    else if (vista === 'nueva') vistaNueva();
  }
  const contenido = () => raiz.querySelector('#mg-contenido');

  // ---------- Indicadores ----------
  async function cargarIndicadores() {
    const r = await llamar(`/api/gestor/indicadores${consulta(conDuena())}`);
    const caja = raiz.querySelector('#mg-indicadores');
    if (r.estado !== 200) { caja.replaceChildren(); if (r.estado === 401) S.alSesionVencida(); return; }
    const d = r.datos;
    const tarjeta = (titulo, valor, clase = '', accion) => el(accion ? 'button' : 'div', { type: accion ? 'button' : undefined, clase: `mg-kpi ${clase}`.trim(), alClick: accion },
      el('span', { clase: 'mg-kpi-valor', texto: String(valor) }), el('span', { clase: 'mg-kpi-titulo', texto: titulo }));
    reemplazar(caja,
      tarjeta('Clientas', d.total),
      tarjeta('Recordatorios vencidos', d.recordatorios.vencidos, d.recordatorios.vencidos ? 'alerta' : '', () => irA('recordatorios')),
      tarjeta('Para hoy', d.recordatorios.hoy, '', () => irA('recordatorios')),
      tarjeta('Próximos 7 días', d.recordatorios.proximos, '', () => irA('recordatorios')),
      tarjeta('Sin movimiento (30 días)', d.sin_movimiento, d.sin_movimiento ? 'aviso' : '')
    );
    S.porEtapa = d.por_etapa;
  }

  // ---------- Lista ----------
  async function cargarLista({ mas = false } = {}) {
    const desplazamiento = mas ? S.clientas.length : 0;
    const r = await llamar(`/api/gestor/clientas${consulta(conDuena({ etapa: S.etapa, q: S.q, limite: POR_PAGINA, desplazamiento }))}`);
    if (r.estado !== 200) { falla(r); return; }
    S.total = r.datos.total;
    S.clientas = mas ? S.clientas.concat(r.datos.clientas) : r.datos.clientas;
    pintarLista();
  }

  function pintarLista() {
    const filtroEtapa = el('select', { id: 'mg-filtro-etapa', 'aria-label': 'Filtrar por etapa', alChange: e => { S.etapa = e.target.value; cargarLista(); } },
      el('option', { value: '', texto: 'Todas las etapas' }),
      ...S.meta.etapas.map(e => el('option', { value: e.id, texto: `${e.rotulo}${S.porEtapa ? ` (${S.porEtapa[e.id] || 0})` : ''}`, selected: S.etapa === e.id })));
    const buscador = el('input', { id: 'mg-buscar', type: 'search', maxlength: '60', 'aria-label': 'Buscar por nombre', placeholder: 'Buscar por nombre', value: S.q });
    let espera = null;
    buscador.addEventListener('input', () => { clearTimeout(espera); espera = setTimeout(() => { S.q = buscador.value.trim(); cargarLista(); }, 300); });

    const barra = el('div', { clase: 'mg-barra' }, buscador, filtroEtapa,
      soloLectura() ? null : el('button', { type: 'button', clase: 'primary', id: 'mg-nueva', texto: 'Nueva clienta', alClick: () => irA('nueva') }));

    let cuerpo;
    if (!S.clientas.length) {
      cuerpo = el('p', { clase: 'mg-vacio', texto: S.q || S.etapa ? 'No hay clientas que coincidan con tu búsqueda.' : (soloLectura() ? 'Esta usuaria aún no tiene clientas.' : 'Aún no tienes clientas guardadas. Crea la primera con "Nueva clienta".') });
    } else {
      cuerpo = el('ul', { clase: 'mg-lista', id: 'mg-lista' }, ...S.clientas.map(c =>
        el('li', {}, el('button', { type: 'button', clase: 'mg-fila', 'data-id': c.id, alClick: () => verFicha(c.id) },
          el('span', { clase: 'mg-fila-nombre', texto: c.nombre }),
          el('span', { clase: `mg-etapa mg-etapa-${c.etapa}`, texto: rotulo(c.etapa) }),
          el('span', { clase: 'mg-fila-tel', texto: c.telefono_ult4 ? `•••• ${c.telefono_ult4}` : '' }),
          el('span', { clase: 'mg-fila-fecha', texto: fechaCorta(c.actualizada) })))));
    }
    const mas = S.clientas.length < S.total
      ? el('button', { type: 'button', clase: 'secondary', id: 'mg-mas', texto: `Ver más (${S.clientas.length} de ${S.total})`, alClick: () => cargarLista({ mas: true }) }) : null;
    reemplazar(contenido(), barra, cuerpo, mas);
    if (document.activeElement === document.body) buscador.focus({ preventScroll: true });
  }

  // ---------- Formulario (nueva y ficha) ----------
  function campo(id, etiqueta, control, ayuda) {
    return el('label', { clase: 'mg-campo', for: id }, el('span', { texto: etiqueta }), control, ayuda ? el('small', { texto: ayuda }) : null);
  }
  function formulario({ clienta, nueva }) {
    const lectura = soloLectura();
    const v = clienta || {};
    const inputs = {
      nombre: el('input', { id: 'mg-nombre', type: 'text', maxlength: '120', required: !lectura, value: v.nombre || '', disabled: lectura }),
      telefono: el('input', { id: 'mg-telefono', type: 'tel', inputmode: 'tel', maxlength: '20', required: !lectura, value: v.telefono || '', disabled: lectura, autocomplete: 'off' }),
      cedula: el('input', { id: 'mg-cedula', type: 'text', inputmode: 'numeric', maxlength: '15', value: v.cedula || '', disabled: lectura, autocomplete: 'off' }),
      direccion: el('input', { id: 'mg-direccion', type: 'text', maxlength: '200', value: v.direccion || '', disabled: lectura, autocomplete: 'off' }),
      etapa: el('select', { id: 'mg-etapa', disabled: lectura }, ...S.meta.etapas.map(e => el('option', { value: e.id, texto: e.rotulo, selected: (v.etapa || 'nueva') === e.id }))),
      notas: el('textarea', { id: 'mg-notas', maxlength: '2000', rows: '5', disabled: lectura }, v.notas || '')
    };
    const contador = el('small', { id: 'mg-contador', clase: 'mg-contador', texto: `${(v.notas || '').length} / 2000` });
    inputs.notas.addEventListener('input', () => { contador.textContent = `${inputs.notas.value.length} / 2000`; });

    let consentimiento = null, consentimientoCaja = null;
    if (nueva) {
      consentimientoCaja = el('input', { id: 'mg-consentimiento', type: 'checkbox' });
      consentimiento = el('label', { clase: 'mg-consentimiento', for: 'mg-consentimiento' }, consentimientoCaja, el('span', { texto: S.meta.consentimiento.texto }));
    }
    const guardar = el('button', { type: 'submit', clase: 'primary', id: 'mg-guardar', texto: nueva ? 'Guardar clienta' : 'Guardar cambios', disabled: nueva });
    if (consentimientoCaja) consentimientoCaja.addEventListener('change', () => { guardar.disabled = !consentimientoCaja.checked; });

    const form = el('form', { clase: 'mg-form', id: 'mg-form', novalidate: true },
      el('div', { clase: 'mg-rejilla' },
        campo('mg-nombre', 'Nombre *', inputs.nombre),
        campo('mg-telefono', 'Teléfono *', inputs.telefono, 'Entre 7 y 15 dígitos.'),
        campo('mg-cedula', 'Cédula (opcional)', inputs.cedula),
        campo('mg-direccion', 'Dirección de envío (opcional)', inputs.direccion),
        campo('mg-etapa', 'Etapa', inputs.etapa)),
      campo('mg-notas', 'Notas', inputs.notas, 'Se guardan cifradas. No escribas claves ni datos que no necesites.'),
      contador,
      consentimiento,
      lectura ? null : el('div', { clase: 'mg-acciones' }, guardar,
        el('button', { type: 'button', clase: 'secondary', texto: nueva ? 'Cancelar' : 'Volver a la lista', alClick: () => irA('lista') })));

    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (lectura) return;
      aviso('');
      const datos = {
        nombre: inputs.nombre.value.trim(), telefono: inputs.telefono.value.trim(), cedula: inputs.cedula.value.trim(),
        direccion: inputs.direccion.value.trim(), etapa: inputs.etapa.value, notas: inputs.notas.value.trim()
      };
      if (!datos.nombre) { aviso('Escribe el nombre.', 'error'); inputs.nombre.focus(); return; }
      if (!datos.telefono) { aviso('Escribe el teléfono.', 'error'); inputs.telefono.focus(); return; }
      guardar.disabled = true;
      try {
        if (nueva) {
          if (!consentimientoCaja.checked) { aviso('Confirma el consentimiento de la clienta para guardar sus datos.', 'error'); return; }
          const r = await llamar('/api/gestor/clientas', { metodo: 'POST', cuerpo: { ...datos, consentimiento: true } });
          if (r.estado !== 201) { falla(r); guardar.disabled = false; return; }
          await cargarIndicadores();
          await verFicha(r.datos.id, 'Clienta guardada.');
        } else {
          const r = await llamar(`/api/gestor/clientas/${encodeURIComponent(S.actual.id)}`, { metodo: 'PUT', cuerpo: datos });
          if (r.estado !== 200) { falla(r); guardar.disabled = false; return; }
          S.actual = r.datos;
          await cargarIndicadores();
          pintarFicha('Cambios guardados.');
        }
      } catch { aviso('No pude conectar con el servidor.', 'error'); guardar.disabled = false; }
    });
    return form;
  }

  function vistaNueva() {
    S.vista = 'nueva';
    reemplazar(contenido(), el('h3', { clase: 'mg-titulo', id: 'mg-titulo', tabindex: '-1', texto: 'Nueva clienta' }), formulario({ nueva: true }));
    raiz.querySelector('#mg-nombre').focus();
  }

  // ---------- Ficha ----------
  async function verFicha(id, textoAviso = '') {
    const r = await llamar(`/api/gestor/clientas/${encodeURIComponent(id)}${consulta(conDuena())}`);
    if (r.estado !== 200) { falla(r); return; }
    S.actual = r.datos;
    S.vista = 'ficha';
    marcarPestana();
    pintarFicha(textoAviso);
  }

  function pintarFicha(textoAviso = '') {
    const c = S.actual;
    aviso(textoAviso, textoAviso ? 'ok' : '');
    const historial = el('ol', { clase: 'mg-historial', 'aria-label': 'Historial de etapas' }, ...c.historial.slice().reverse().map(h =>
      el('li', { texto: `${h.de ? `${rotulo(h.de)} → ` : 'Creada como '}${rotulo(h.a)} · ${fechaHora(h.fecha)}` })));
    const lectura = soloLectura();
    const hoy = hoyColombia();

    const lista = el('ul', { clase: 'mg-recs' }, ...(c.recordatorios.length ? c.recordatorios.map(r => el('li', { clase: r.hecho ? 'hecho' : (r.fecha < hoy ? 'vencido' : '') },
      el('input', { type: 'checkbox', checked: r.hecho, disabled: lectura, 'aria-label': `Marcar como hecho: ${r.texto}`, alChange: e => completar(r.id, e.target.checked) }),
      el('span', { clase: 'mg-rec-fecha', texto: fechaCorta(r.fecha) }), el('span', { texto: r.texto })))
      : [el('li', { clase: 'mg-vacio', texto: 'Sin recordatorios.' })]));

    let nuevoRec = null;
    if (!lectura) {
      const fecha = el('input', { type: 'date', id: 'mg-rec-fecha', min: hoy, value: hoy, 'aria-label': 'Fecha del recordatorio' });
      const texto = el('input', { type: 'text', id: 'mg-rec-texto', maxlength: '200', 'aria-label': 'Texto del recordatorio', placeholder: 'Ej.: llamar para confirmar el pedido' });
      nuevoRec = el('form', { clase: 'mg-rec-form', id: 'mg-rec-form', novalidate: true, alSubmit: async e => {
        e.preventDefault();
        if (!texto.value.trim()) { aviso('Escribe el recordatorio.', 'error'); texto.focus(); return; }
        const r = await llamar(`/api/gestor/clientas/${encodeURIComponent(c.id)}/recordatorios`, { metodo: 'POST', cuerpo: { fecha: fecha.value, texto: texto.value.trim() } });
        if (r.estado !== 201) { falla(r); return; }
        await recargarFicha('Recordatorio agregado.');
      } }, fecha, texto, el('button', { type: 'submit', clase: 'secondary', texto: 'Agregar' }));
    }

    const borrar = lectura ? null : el('div', { clase: 'mg-peligro' },
      el('button', { type: 'button', clase: 'mg-borrar', id: 'mg-borrar', texto: 'Borrar clienta', alClick: e => {
        const caja = raiz.querySelector('#mg-confirmar');
        mostrarNodo(caja, true); e.currentTarget.classList.add('hidden'); raiz.querySelector('#mg-confirmar-si').focus();
      } }),
      el('div', { id: 'mg-confirmar', clase: 'mg-confirmar hidden', role: 'alertdialog', 'aria-label': 'Confirmar borrado' },
        el('p', { texto: 'Se borrará la ficha con su historial y sus recordatorios. No se puede deshacer.' }),
        el('button', { type: 'button', clase: 'mg-borrar', id: 'mg-confirmar-si', texto: 'Sí, borrar definitivamente', alClick: eliminar }),
        el('button', { type: 'button', clase: 'secondary', texto: 'Cancelar', alClick: () => { mostrarNodo(raiz.querySelector('#mg-confirmar'), false); mostrarNodo(raiz.querySelector('#mg-borrar'), true); } })));

    reemplazar(contenido(), 
      el('div', { clase: 'mg-ficha-cabecera' },
        el('button', { type: 'button', clase: 'secondary', texto: '← Volver a la lista', alClick: () => irA('lista') }),
        el('h3', { clase: 'mg-titulo', id: 'mg-titulo', tabindex: '-1', texto: c.nombre }),
        el('span', { clase: `mg-etapa mg-etapa-${c.etapa}`, texto: rotulo(c.etapa) })),
      formulario({ clienta: c, nueva: false }),
      lectura ? null : bloqueRedaccion(c),
      el('div', { clase: 'mg-columnas' },
        el('div', {}, el('h4', { texto: 'Recordatorios' }), lista, nuevoRec),
        el('div', {}, el('h4', { texto: 'Historial de etapas' }), historial,
          el('p', { clase: 'mg-consent-info', texto: `Consentimiento registrado el ${fechaHora(c.consentimiento.fecha)} (texto versión ${c.consentimiento.version}).` }))),
      el('div', { clase: 'mg-acciones' },
        el('button', { type: 'button', clase: 'secondary', id: 'mg-exportar', texto: 'Descargar datos (JSON)', alClick: exportar }), borrar));
    raiz.querySelector('#mg-titulo').focus({ preventScroll: true });
  }

  // ---------- Redacción asistida (solo sobre las fichas propias; el borrador no se guarda en ningún lado) ----------
  function bloqueRedaccion(c) {
    const tipo = el('select', { id: 'mg-red-tipo', 'aria-label': 'Tipo de mensaje' },
      el('option', { value: 'seguimiento', texto: 'Seguimiento' }),
      el('option', { value: 'recordatorio', texto: 'Recordatorio' }),
      el('option', { value: 'respuesta', texto: 'Respuesta al mensaje de la clienta' }));
    const mensaje = el('textarea', { id: 'mg-red-mensaje', maxlength: '800', rows: '3', placeholder: 'Pega aquí el mensaje de la clienta' });
    const indic = el('input', { id: 'mg-red-indic', type: 'text', maxlength: '300', placeholder: 'Indicaciones (opcional). Ej.: dile que el pedido llega el viernes' });
    const cajaMensaje = el('label', { clase: 'mg-campo hidden', id: 'mg-red-caja-mensaje', for: 'mg-red-mensaje' }, el('span', { texto: 'Mensaje de la clienta' }), mensaje);
    tipo.addEventListener('change', () => mostrarNodo(cajaMensaje, tipo.value === 'respuesta'));
    const estado = el('div', { id: 'mg-red-estado', clase: 'mg-mensaje hidden', role: 'status' });
    const borrador = el('textarea', { id: 'mg-red-borrador', rows: '5', maxlength: '2000', 'aria-label': 'Borrador del mensaje (puedes editarlo)' });
    const resultado = el('div', { id: 'mg-red-resultado', clase: 'hidden' },
      el('label', { clase: 'mg-campo', for: 'mg-red-borrador' }, el('span', { texto: 'Borrador (puedes editarlo antes de copiarlo)' }), borrador),
      el('div', { clase: 'mg-acciones' },
        el('button', { type: 'button', clase: 'primary', id: 'mg-red-copiar', texto: 'Copiar', alClick: () => copiar(borrador, estado) }),
        el('button', { type: 'button', clase: 'secondary', id: 'mg-red-otra', texto: 'Redactar otra versión', alClick: () => ir.click() })));
    const ir = el('button', { type: 'button', clase: 'primary', id: 'mg-red-ir', texto: 'Redactar con IA', alClick: async () => {
      const cuerpo = { tipo: tipo.value, indicaciones: indic.value.trim() };
      if (tipo.value === 'respuesta') cuerpo.mensaje_clienta = mensaje.value.trim();
      if (tipo.value === 'respuesta' && !cuerpo.mensaje_clienta) { mostrarEstado(estado, 'Pega el mensaje de la clienta al que vas a responder.', 'error'); mensaje.focus(); return; }
      ir.disabled = true; mostrarEstado(estado, 'Redactando…', '');
      try {
        const r = await llamar(`/api/gestor/clientas/${encodeURIComponent(c.id)}/redactar`, { metodo: 'POST', cuerpo });
        if (r.estado === 401) { S.alSesionVencida(); return; }
        if (r.estado !== 200) {
          mostrarNodo(resultado, false);
          mostrarEstado(estado, (r.datos && r.datos.error) || 'No se pudo redactar el mensaje. Inténtalo de nuevo.', 'error');
          return;
        }
        borrador.value = r.datos.borrador || '';
        mostrarNodo(resultado, true);
        mostrarEstado(estado, r.datos.aviso || 'Revisa el borrador, ajústalo a tu estilo y cópialo. No se guarda.', r.datos.aviso ? 'aviso' : '');
        borrador.focus({ preventScroll: true });
      } catch { mostrarEstado(estado, 'No pude conectar con el servidor.', 'error'); }
      finally { ir.disabled = false; }
    } });
    return el('section', { clase: 'mg-redactar', id: 'mg-redactar', 'aria-label': 'Redactar mensaje con IA' },
      el('h4', { texto: 'Redactar un mensaje para esta clienta' }),
      el('p', { clase: 'mg-consent-info', texto: 'La IA recibe solo su primer nombre, su etapa y tus notas sin teléfonos, cédulas ni direcciones. No escribas en las notas datos de salud, claves ni cuentas. No inventa precios: si necesitas uno, escríbelo en las indicaciones.' }),
      el('div', { clase: 'mg-rejilla' },
        el('label', { clase: 'mg-campo', for: 'mg-red-tipo' }, el('span', { texto: 'Tipo de mensaje' }), tipo),
        el('label', { clase: 'mg-campo', for: 'mg-red-indic' }, el('span', { texto: 'Indicaciones' }), indic)),
      cajaMensaje, el('div', { clase: 'mg-acciones' }, ir), estado, resultado);
  }
  function mostrarEstado(caja, texto, tipo) {
    caja.textContent = texto;
    caja.className = `mg-mensaje ${tipo}`.trim();
    mostrarNodo(caja, !!texto);
  }
  async function copiar(area, estado) {
    try {
      await navigator.clipboard.writeText(area.value);
    } catch {
      area.focus(); area.select();
      try { if (!document.execCommand('copy')) throw new Error('no copiado'); } catch { mostrarEstado(estado, 'No pude copiar solo. Selecciona el texto y cópialo con Ctrl+C.', 'error'); return; }
    }
    mostrarEstado(estado, 'Copiado. Pégalo en WhatsApp.', 'ok');
  }

  async function recargarFicha(textoAviso) {
    const r = await llamar(`/api/gestor/clientas/${encodeURIComponent(S.actual.id)}${consulta(conDuena())}`);
    if (r.estado !== 200) { falla(r); return; }
    S.actual = r.datos;
    await cargarIndicadores();
    pintarFicha(textoAviso);
  }

  async function completar(id, hecho) {
    const r = await llamar(`/api/gestor/recordatorios/${encodeURIComponent(id)}/completar`, { metodo: 'POST', cuerpo: { hecho } });
    if (r.estado !== 200) { falla(r); return; }
    if (S.vista === 'recordatorios') await vistaRecordatorios(); else await recargarFicha('');
  }

  async function eliminar() {
    const r = await llamar(`/api/gestor/clientas/${encodeURIComponent(S.actual.id)}`, { metodo: 'DELETE' });
    if (r.estado !== 200) { falla(r); return; }
    S.actual = null;
    await irA('lista');
    aviso('Clienta borrada con su historial y sus recordatorios.', 'ok');
  }

  async function exportar() {
    const r = await llamar(`/api/gestor/clientas/${encodeURIComponent(S.actual.id)}/exportar${consulta(conDuena())}`);
    if (r.estado !== 200) { falla(r); return; }
    const url = URL.createObjectURL(new Blob([JSON.stringify(r.datos, null, 2)], { type: 'application/json' }));
    const enlace = el('a', { href: url, download: `clienta-${S.actual.id.slice(0, 8)}.json` });
    document.body.append(enlace);
    enlace.click();
    enlace.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    aviso('Descarga lista. El archivo contiene datos personales: guárdalo y compártelo con cuidado.', 'ok');
  }

  // ---------- Recordatorios ----------
  async function vistaRecordatorios() {
    S.vista = 'recordatorios';
    marcarPestana();
    const grupos = [['vencidos', 'Vencidos', 'vencido'], ['hoy', 'Para hoy', ''], ['proximos', 'Próximos 7 días', '']];
    const respuestas = await Promise.all(grupos.map(([estado]) => llamar(`/api/gestor/recordatorios${consulta(conDuena({ estado }))}`)));
    const mala = respuestas.find(r => r.estado !== 200);
    if (mala) { falla(mala); return; }
    const secciones = grupos.map(([, titulo, clase], i) => {
      const items = respuestas[i].datos.recordatorios;
      return el('div', { clase: 'mg-grupo' }, el('h4', { texto: `${titulo} (${items.length})` }),
        items.length ? el('ul', { clase: 'mg-recs' }, ...items.map(r => el('li', { clase: clase },
          el('input', { type: 'checkbox', disabled: soloLectura(), 'aria-label': `Marcar como hecho: ${r.texto}`, alChange: e => completar(r.id, e.target.checked) }),
          el('span', { clase: 'mg-rec-fecha', texto: fechaCorta(r.fecha) }),
          el('button', { type: 'button', clase: 'mg-enlace', texto: r.nombre, alClick: () => verFicha(r.clienta_id) }),
          el('span', { texto: r.texto }))))
          : el('p', { clase: 'mg-vacio', texto: 'Nada por aquí.' }));
    });
    reemplazar(contenido(), el('h3', { clase: 'mg-titulo', id: 'mg-titulo', tabindex: '-1', texto: 'Recordatorios' }), ...secciones);
  }

  // ---------- Soporte (solo administradora) ----------
  async function vistaSoporte() {
    S.vista = 'soporte';
    marcarPestana();
    const [u, a] = await Promise.all([llamar('/api/gestor/usuarias'), llamar('/api/gestor/accesos?limite=50')]);
    if (u.estado !== 200) { falla(u); return; }
    const lista = u.datos.usuarias;
    const selector = el('select', { id: 'mg-usuaria', 'aria-label': 'Usuaria a consultar' }, ...lista.map(n => el('option', { value: n, texto: n })));
    const ver = el('button', { type: 'button', clase: 'primary', id: 'mg-ver-usuaria', texto: 'Ver sus clientas (solo lectura)', disabled: !lista.length, alClick: async () => {
      S.duena = selector.value; S.etapa = ''; S.q = ''; await irA('lista');
    } });
    const salir = soloLectura() ? el('button', { type: 'button', clase: 'secondary', id: 'mg-salir-soporte', texto: 'Salir del modo soporte', alClick: async () => { S.duena = null; await irA('lista'); } }) : null;
    const filas = a.estado === 200 ? a.datos.accesos : [];
    reemplazar(contenido(), 
      el('h3', { clase: 'mg-titulo', id: 'mg-titulo', tabindex: '-1', texto: 'Soporte' }),
      el('p', { texto: 'Como administradora puedes leer los datos de otras usuarias para darles soporte. No puedes modificarlos y cada consulta queda registrada abajo.' }),
      lista.length ? el('div', { clase: 'mg-barra' }, selector, ver, salir) : el('p', { clase: 'mg-vacio', texto: 'Ninguna otra usuaria tiene el Gestor habilitado.' }),
      el('h4', { texto: 'Últimas consultas a datos de otras usuarias' }),
      filas.length ? el('table', { clase: 'mg-tabla' }, el('thead', {}, el('tr', {}, ...['Fecha', 'Quién', 'A quién', 'Acción'].map(t => el('th', { texto: t })))),
        el('tbody', {}, ...filas.map(f => el('tr', {}, el('td', { texto: fechaHora(f.fecha) }), el('td', { texto: f.actor }), el('td', { texto: f.duena }), el('td', { texto: f.accion })))))
        : el('p', { clase: 'mg-vacio', texto: 'Todavía no hay consultas registradas.' }));
  }

  // ---------- API pública para app.js ----------
  async function abrir({ usuario, admin, alSesionVencida }) {
    S.usuario = usuario; S.admin = !!admin; S.duena = null; S.etapa = ''; S.q = ''; S.vista = 'lista';
    S.alSesionVencida = alSesionVencida || (() => {});
    armarBase();
    if (!S.meta) {
      const m = await llamar('/api/gestor/meta');
      if (m.estado !== 200 || !m.datos.etapas) {
        if (m.estado === 401) { S.alSesionVencida(); return; }
        aviso(m.estado === 503 ? 'El Gestor de ventas no está disponible en este momento.' : 'No se pudo cargar el Gestor de ventas.', 'error');
        return;
      }
      S.meta = m.datos;
    }
    await irA('lista');
  }

  // Vacía la pantalla: los datos personales no deben quedar en el DOM al cerrar la sesión.
  function cerrar() {
    S.duena = null; S.actual = null; S.clientas = []; S.porEtapa = null; S.usuario = null; S.admin = false;
    raiz.replaceChildren();
  }

  window.Gestor = { abrir, cerrar };
})();
