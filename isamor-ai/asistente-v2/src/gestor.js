'use strict';
// Gestor de ventas: clientas, etapas, recordatorios y notas en SQLite (node:sqlite, sin dependencias).
// Teléfono, cédula, dirección y notas se guardan cifrados (AES-256-GCM, ver cifrado.js).
//
// Control de acceso: cada operación recibe un contexto { usuario, esAdmin }.
//  - Una usuaria solo ve y modifica sus clientas.
//  - El administrador puede LEER las de otras usuarias (soporte) y cada lectura queda registrada en `accesos`.
//  - Nadie, tampoco el administrador, modifica clientas de otra usuaria.
const crypto = require('node:crypto');
const fs = require('node:fs');
const { fechaColombia } = require('./reglas');
const { enmascarar } = require('./enmascarar');

const ETAPAS = ['nueva', 'contactada', 'interesada', 'pedido_en_curso', 'cliente', 'recompra', 'inactiva'];
const ETAPAS_ROTULO = {
  nueva: 'Nueva', contactada: 'Contactada', interesada: 'Interesada', pedido_en_curso: 'Pedido en curso',
  cliente: 'Cliente', recompra: 'Recompra', inactiva: 'Inactiva'
};
const CONSENTIMIENTO_VERSION = '1';
const TEXTO_CONSENTIMIENTO = 'Confirmo que la persona autorizó guardar sus datos (nombre, teléfono y, si los dio, cédula y dirección) '
  + 'para atención comercial; que sus notas pueden procesarse con inteligencia artificial de un proveedor ubicado en el exterior, '
  + 'sin su teléfono, cédula ni dirección; y que el administrador de la plataforma puede acceder a ellos para dar soporte.';

const LIMITES_ESTILO = { ejemplos: 3, caracteres: 500, total: 1200 };
const LIMITES = { nombre: 120, direccion: 200, notas: 2000, recordatorio: 200, clientasPorUsuaria: 5000, pagina: 100, diasSinMovimiento: 30 };

function error(codigo, mensaje) {
  const e = new Error(mensaje || codigo);
  e.codigo = codigo;
  return e;
}

function sinTildes(t) { return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }

function sqliteDisponible() {
  try { require('node:sqlite'); return true; } catch { return false; }
}

// Abre (o crea) la base y aplica el esquema. ruta ':memory:' para pruebas.
function abrirBase(ruta) {
  const { DatabaseSync } = require('node:sqlite');
  // La base contiene nombres y datos personales (cifrados): solo la propietaria puede leerla (600). SQLite copia ese permiso
  // a los archivos -wal y -shm que crea junto a ella.
  if (ruta !== ':memory:') {
    if (!fs.existsSync(ruta)) fs.writeFileSync(ruta, '', { mode: 0o600 });
    fs.chmodSync(ruta, 0o600);
  }
  const db = new DatabaseSync(ruta);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA secure_delete = ON;');
  // Los archivos auxiliares que ya existieran (p. ej. tras un apagado brusco) conservan su permiso anterior: se corrige.
  if (ruta !== ':memory:') for (const sufijo of ['-wal', '-shm']) if (fs.existsSync(ruta + sufijo)) fs.chmodSync(ruta + sufijo, 0o600);
  let version = db.prepare('PRAGMA user_version').get().user_version;
  if (version < 1) {
    db.exec(`
      BEGIN;
      CREATE TABLE clientas (
        id TEXT PRIMARY KEY,
        usuaria TEXT NOT NULL,
        nombre TEXT NOT NULL,
        nombre_norm TEXT NOT NULL,
        telefono_cif TEXT NOT NULL,
        cedula_cif TEXT,
        direccion_cif TEXT,
        notas_cif TEXT,
        etapa TEXT NOT NULL,
        consent_fecha TEXT NOT NULL,
        consent_version TEXT NOT NULL,
        creada TEXT NOT NULL,
        actualizada TEXT NOT NULL
      );
      CREATE INDEX idx_clientas_etapa ON clientas (usuaria, etapa);
      CREATE INDEX idx_clientas_nombre ON clientas (usuaria, nombre_norm);
      CREATE TABLE historial_etapas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        clienta_id TEXT NOT NULL REFERENCES clientas(id) ON DELETE CASCADE,
        de TEXT, a TEXT NOT NULL, fecha TEXT NOT NULL
      );
      CREATE TABLE recordatorios (
        id TEXT PRIMARY KEY,
        clienta_id TEXT NOT NULL REFERENCES clientas(id) ON DELETE CASCADE,
        usuaria TEXT NOT NULL,
        fecha TEXT NOT NULL,
        texto TEXT NOT NULL,
        hecho INTEGER NOT NULL DEFAULT 0,
        creado TEXT NOT NULL
      );
      CREATE INDEX idx_recordatorios ON recordatorios (usuaria, hecho, fecha);
      CREATE TABLE accesos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fecha TEXT NOT NULL, actor TEXT NOT NULL, duena TEXT NOT NULL, accion TEXT NOT NULL, clienta_id TEXT
      );
      PRAGMA user_version = 1;
      COMMIT;`);
    version = 1;
  }
  if (version < 2) {
    // «Mi estilo» (4 nov 2026): hasta 3 mensajes de ejemplo de la usuaria para que la redacción asistida imite su voz. Cifrados.
    db.exec(`
      BEGIN;
      CREATE TABLE IF NOT EXISTS estilos (
        usuaria TEXT PRIMARY KEY,
        ejemplos_cif TEXT NOT NULL,
        actualizado TEXT NOT NULL
      );
      PRAGMA user_version = 2;
      COMMIT;`);
  }
  return db;
}

function crearGestor({ db, cifrado, ahora = () => Date.now(), nuevoId = () => crypto.randomUUID() }) {
  const iso = () => new Date(ahora()).toISOString();
  const hoy = () => fechaColombia(new Date(ahora()));
  const ctxDato = (duena, id, campo) => `${duena}|${id}|${campo}`;

  function validarContexto(ctx) {
    if (!ctx || typeof ctx.usuario !== 'string' || !ctx.usuario) throw error('sin_permiso', 'Falta la usuaria.');
  }

  // Devuelve la dueña de los datos a consultar. Otra distinta de quien consulta solo se permite al administrador, solo lectura.
  function resolverDuena(ctx, opciones = {}, { escritura = false } = {}) {
    validarContexto(ctx);
    const duena = opciones.duena || ctx.usuario;
    if (duena === ctx.usuario) return duena;
    if (!ctx.esAdmin || escritura) throw error('sin_permiso', 'No tienes permiso para esta operación.');
    return duena;
  }

  function registrarAcceso(ctx, duena, accion, clientaId = null) {
    if (duena === ctx.usuario) return;
    db.prepare('INSERT INTO accesos (fecha, actor, duena, accion, clienta_id) VALUES (?, ?, ?, ?, ?)')
      .run(iso(), ctx.usuario, duena, accion, clientaId);
  }

  function limpiarTelefono(valor) {
    const t = String(valor || '').trim();
    const digitos = t.replace(/\D/g, '');
    if (!/^[+\d\s().-]+$/.test(t) || digitos.length < 7 || digitos.length > 15) throw error('telefono_invalido', 'El teléfono debe tener entre 7 y 15 dígitos.');
    return (t.startsWith('+') ? '+' : '') + digitos;
  }

  function limpiarCedula(valor) {
    if (valor === undefined || valor === null || String(valor).trim() === '') return null;
    const digitos = String(valor).replace(/[\s.]/g, '');
    if (!/^\d{5,12}$/.test(digitos)) throw error('cedula_invalida', 'La cédula debe tener entre 5 y 12 dígitos.');
    return digitos;
  }

  function limpiarTextoOpcional(valor, maximo, campo) {
    if (valor === undefined || valor === null) return null;
    const t = String(valor).trim();
    if (!t) return null;
    if (t.length > maximo) throw error(`${campo}_larga`, `El campo ${campo} supera ${maximo} caracteres.`);
    return t;
  }

  function limpiarNombre(valor) {
    const t = String(valor || '').trim().replace(/\s+/g, ' ');
    if (!t) throw error('nombre_requerido', 'El nombre es obligatorio.');
    if (t.length > LIMITES.nombre) throw error('nombre_largo', `El nombre supera ${LIMITES.nombre} caracteres.`);
    return t;
  }

  function limpiarEtapa(valor) {
    if (!ETAPAS.includes(valor)) throw error('etapa_invalida', 'Etapa no válida.');
    return valor;
  }

  function filaAClienta(fila) {
    const d = campo => cifrado.descifrar(fila[`${campo}_cif`], ctxDato(fila.usuaria, fila.id, campo));
    return {
      id: fila.id, nombre: fila.nombre, etapa: fila.etapa,
      telefono: d('telefono'), cedula: d('cedula'), direccion: d('direccion'), notas: d('notas'),
      consentimiento: { fecha: fila.consent_fecha, version: fila.consent_version },
      creada: fila.creada, actualizada: fila.actualizada
    };
  }

  function buscarFila(duena, id) {
    const fila = db.prepare('SELECT * FROM clientas WHERE id = ? AND usuaria = ?').get(String(id), duena);
    if (!fila) throw error('no_encontrada', 'Clienta no encontrada.');
    return fila;
  }

  function enTransaccion(fn) {
    db.exec('BEGIN');
    try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
  }

  // ---- Clientas ----
  function crearClienta(ctx, datos = {}) {
    const duena = resolverDuena(ctx, {}, { escritura: true });
    if (datos.consentimiento !== true) throw error('consentimiento_requerido', 'Debes confirmar el consentimiento de la clienta para guardar sus datos.');
    const nombre = limpiarNombre(datos.nombre);
    const telefono = limpiarTelefono(datos.telefono);
    const cedula = limpiarCedula(datos.cedula);
    const direccion = limpiarTextoOpcional(datos.direccion, LIMITES.direccion, 'direccion');
    const notas = limpiarTextoOpcional(datos.notas, LIMITES.notas, 'notas');
    const etapa = limpiarEtapa(datos.etapa === undefined ? 'nueva' : datos.etapa);
    const total = db.prepare('SELECT COUNT(*) AS n FROM clientas WHERE usuaria = ?').get(duena).n;
    if (total >= LIMITES.clientasPorUsuaria) throw error('limite_clientas', 'Alcanzaste el máximo de clientas guardadas.');

    const id = nuevoId();
    const t = iso();
    enTransaccion(() => {
      db.prepare(`INSERT INTO clientas (id, usuaria, nombre, nombre_norm, telefono_cif, cedula_cif, direccion_cif, notas_cif, etapa,
        consent_fecha, consent_version, creada, actualizada) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, duena, nombre, sinTildes(nombre),
        cifrado.cifrar(telefono, ctxDato(duena, id, 'telefono')), cifrado.cifrar(cedula, ctxDato(duena, id, 'cedula')),
        cifrado.cifrar(direccion, ctxDato(duena, id, 'direccion')), cifrado.cifrar(notas, ctxDato(duena, id, 'notas')),
        etapa, t, CONSENTIMIENTO_VERSION, t, t);
      db.prepare('INSERT INTO historial_etapas (clienta_id, de, a, fecha) VALUES (?, NULL, ?, ?)').run(id, etapa, t);
    });
    return filaAClienta(buscarFila(duena, id));
  }

  // Lista resumida: el teléfono solo muestra sus últimos 4 dígitos.
  function listar(ctx, { etapa, q, limite = 50, desplazamiento = 0, duena: otra } = {}) {
    const duena = resolverDuena(ctx, { duena: otra });
    const condiciones = ['usuaria = ?'];
    const params = [duena];
    if (etapa !== undefined && etapa !== '') { condiciones.push('etapa = ?'); params.push(limpiarEtapa(etapa)); }
    if (q) { condiciones.push("nombre_norm LIKE ? ESCAPE '\\'"); params.push(`%${sinTildes(q).replace(/[\\%_]/g, c => '\\' + c)}%`); }
    const donde = condiciones.join(' AND ');
    const tope = Math.min(Math.max(Number(limite) || 50, 1), LIMITES.pagina);
    const desde = Math.max(Number(desplazamiento) || 0, 0);
    const total = db.prepare(`SELECT COUNT(*) AS n FROM clientas WHERE ${donde}`).get(...params).n;
    const filas = db.prepare(`SELECT * FROM clientas WHERE ${donde} ORDER BY actualizada DESC, nombre_norm LIMIT ? OFFSET ?`).all(...params, tope, desde);
    registrarAcceso(ctx, duena, 'listar');
    return {
      total,
      clientas: filas.map(f => {
        const tel = cifrado.descifrar(f.telefono_cif, ctxDato(f.usuaria, f.id, 'telefono')) || '';
        return { id: f.id, nombre: f.nombre, etapa: f.etapa, telefono_ult4: tel.replace(/\D/g, '').slice(-4), actualizada: f.actualizada };
      })
    };
  }

  function obtener(ctx, id, { duena: otra } = {}) {
    const duena = resolverDuena(ctx, { duena: otra });
    const clienta = filaAClienta(buscarFila(duena, id));
    registrarAcceso(ctx, duena, 'obtener', clienta.id);
    return {
      ...clienta,
      historial: db.prepare('SELECT de, a, fecha FROM historial_etapas WHERE clienta_id = ? ORDER BY id').all(clienta.id).map(h => ({ ...h })),
      recordatorios: db.prepare('SELECT id, fecha, texto, hecho FROM recordatorios WHERE clienta_id = ? ORDER BY fecha, creado').all(clienta.id)
        .map(r => ({ id: r.id, fecha: r.fecha, texto: r.texto, hecho: !!r.hecho }))
    };
  }

  function actualizar(ctx, id, cambios = {}) {
    const duena = resolverDuena(ctx, {}, { escritura: true });
    const fila = buscarFila(duena, id);
    const sets = [];
    const params = [];
    const poner = (columna, valor) => { sets.push(`${columna} = ?`); params.push(valor); };
    if ('nombre' in cambios) { const n = limpiarNombre(cambios.nombre); poner('nombre', n); poner('nombre_norm', sinTildes(n)); }
    if ('telefono' in cambios) poner('telefono_cif', cifrado.cifrar(limpiarTelefono(cambios.telefono), ctxDato(duena, fila.id, 'telefono')));
    if ('cedula' in cambios) poner('cedula_cif', cifrado.cifrar(limpiarCedula(cambios.cedula), ctxDato(duena, fila.id, 'cedula')));
    if ('direccion' in cambios) poner('direccion_cif', cifrado.cifrar(limpiarTextoOpcional(cambios.direccion, LIMITES.direccion, 'direccion'), ctxDato(duena, fila.id, 'direccion')));
    if ('notas' in cambios) poner('notas_cif', cifrado.cifrar(limpiarTextoOpcional(cambios.notas, LIMITES.notas, 'notas'), ctxDato(duena, fila.id, 'notas')));
    const etapaNueva = 'etapa' in cambios ? limpiarEtapa(cambios.etapa) : null;
    if (!sets.length && !etapaNueva) return obtener(ctx, id);
    enTransaccion(() => {
      if (etapaNueva && etapaNueva !== fila.etapa) {
        poner('etapa', etapaNueva);
        db.prepare('INSERT INTO historial_etapas (clienta_id, de, a, fecha) VALUES (?, ?, ?, ?)').run(fila.id, fila.etapa, etapaNueva, iso());
      }
      if (sets.length) {
        poner('actualizada', iso());
        db.prepare(`UPDATE clientas SET ${sets.join(', ')} WHERE id = ? AND usuaria = ?`).run(...params, fila.id, duena);
      }
    });
    return obtener(ctx, id);
  }

  function borrar(ctx, id) {
    const duena = resolverDuena(ctx, {}, { escritura: true });
    const fila = buscarFila(duena, id);
    db.prepare('DELETE FROM clientas WHERE id = ? AND usuaria = ?').run(fila.id, duena);
    return { ok: true };
  }

  // ---- Mi estilo (solo la propia usuaria; nadie más lo lee ni lo modifica por la API) ----
  const ctxEstilo = duena => ctxDato(duena, 'estilo', 'ejemplos');

  function obtenerEstilo(ctx) {
    const duena = resolverDuena(ctx, {});
    const fila = db.prepare('SELECT ejemplos_cif, actualizado FROM estilos WHERE usuaria = ?').get(duena);
    if (!fila) return { ejemplos: [], actualizado: null };
    return { ejemplos: JSON.parse(cifrado.descifrar(fila.ejemplos_cif, ctxEstilo(duena))), actualizado: fila.actualizado };
  }

  // ejemplos: 1 a 3 textos de hasta 500 caracteres (1.200 en total). Se enmascaran antes de guardar: si traían teléfonos, cédulas,
  // correos o direcciones, quedan como marcas y se informa con `enmascarados: true`.
  function guardarEstilo(ctx, ejemplos) {
    const duena = resolverDuena(ctx, {}, { escritura: true });
    if (!Array.isArray(ejemplos) || ejemplos.some(e => typeof e !== 'string')) throw error('ejemplos_invalidos', 'Los ejemplos deben ser una lista de textos.');
    const limpios = ejemplos.map(e => e.trim()).filter(Boolean);
    if (!limpios.length) throw error('ejemplos_invalidos', 'Escribe al menos un mensaje de ejemplo.');
    if (limpios.length > LIMITES_ESTILO.ejemplos) throw error('ejemplos_invalidos', `Máximo ${LIMITES_ESTILO.ejemplos} mensajes de ejemplo.`);
    if (limpios.some(e => e.length > LIMITES_ESTILO.caracteres)) throw error('ejemplos_invalidos', `Cada ejemplo puede tener hasta ${LIMITES_ESTILO.caracteres} caracteres.`);
    if (limpios.reduce((n, e) => n + e.length, 0) > LIMITES_ESTILO.total) throw error('ejemplos_invalidos', `Entre todos los ejemplos, máximo ${LIMITES_ESTILO.total} caracteres.`);
    const guardados = limpios.map(e => enmascarar(e));
    const enmascarados = guardados.some((g, i) => g !== limpios[i]);
    const t = iso();
    db.prepare(`INSERT INTO estilos (usuaria, ejemplos_cif, actualizado) VALUES (?, ?, ?)
      ON CONFLICT(usuaria) DO UPDATE SET ejemplos_cif = excluded.ejemplos_cif, actualizado = excluded.actualizado`)
      .run(duena, cifrado.cifrar(JSON.stringify(guardados), ctxEstilo(duena)), t);
    return { ejemplos: guardados, actualizado: t, enmascarados };
  }

  function borrarEstilo(ctx) {
    const duena = resolverDuena(ctx, {}, { escritura: true });
    db.prepare('DELETE FROM estilos WHERE usuaria = ?').run(duena);
    return { ok: true };
  }

  // Todo lo guardado de una clienta, descifrado, para entregárselo a su titular si lo pide.
  function exportar(ctx, id, { duena: otra } = {}) {
    const duena = resolverDuena(ctx, { duena: otra });
    const r = obtener(ctx, id, { duena });
    registrarAcceso(ctx, duena, 'exportar', r.id);
    return { exportado: iso(), ...r };
  }

  // ---- Recordatorios ----
  function crearRecordatorio(ctx, id, { fecha, texto } = {}) {
    const duena = resolverDuena(ctx, {}, { escritura: true });
    const fila = buscarFila(duena, id);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha || '')) || Number.isNaN(Date.parse(`${fecha}T00:00:00Z`))) throw error('fecha_invalida', 'La fecha debe ser AAAA-MM-DD.');
    const t = String(texto || '').trim();
    if (!t) throw error('texto_requerido', 'Escribe el recordatorio.');
    if (t.length > LIMITES.recordatorio) throw error('texto_largo', `El recordatorio supera ${LIMITES.recordatorio} caracteres.`);
    const rid = nuevoId();
    db.prepare('INSERT INTO recordatorios (id, clienta_id, usuaria, fecha, texto, hecho, creado) VALUES (?, ?, ?, ?, ?, 0, ?)').run(rid, fila.id, duena, fecha, t, iso());
    return { id: rid, fecha, texto: t, hecho: false };
  }

  function completarRecordatorio(ctx, recordatorioId, hecho = true) {
    const duena = resolverDuena(ctx, {}, { escritura: true });
    const r = db.prepare('UPDATE recordatorios SET hecho = ? WHERE id = ? AND usuaria = ?').run(hecho ? 1 : 0, String(recordatorioId), duena);
    if (!r.changes) throw error('no_encontrada', 'Recordatorio no encontrado.');
    return { ok: true };
  }

  // estado: 'vencidos' | 'hoy' | 'proximos' (próximos 7 días) | 'pendientes' (todos los no hechos)
  function listarRecordatorios(ctx, { estado = 'pendientes', duena: otra } = {}) {
    const duena = resolverDuena(ctx, { duena: otra });
    const h = hoy();
    const en7 = new Date(Date.parse(`${h}T00:00:00Z`) + 7 * 86400000).toISOString().slice(0, 10);
    const filtros = {
      vencidos: ['fecha < ?', [h]], hoy: ['fecha = ?', [h]], proximos: ['fecha > ? AND fecha <= ?', [h, en7]], pendientes: ['1 = 1', []]
    };
    if (!Object.prototype.hasOwnProperty.call(filtros, estado)) throw error('estado_invalido', 'Estado no válido.');
    const [cond, extra] = filtros[estado];
    const filas = db.prepare(`SELECT r.id, r.fecha, r.texto, c.id AS clienta_id, c.nombre FROM recordatorios r JOIN clientas c ON c.id = r.clienta_id
      WHERE r.usuaria = ? AND r.hecho = 0 AND ${cond.replace(/\bfecha\b/g, 'r.fecha')} ORDER BY r.fecha, r.creado`).all(duena, ...extra);
    registrarAcceso(ctx, duena, 'recordatorios');
    return filas.map(f => ({ id: f.id, fecha: f.fecha, texto: f.texto, clienta_id: f.clienta_id, nombre: f.nombre }));
  }

  // ---- Indicadores ----
  function indicadores(ctx, { duena: otra } = {}) {
    const duena = resolverDuena(ctx, { duena: otra });
    const porEtapa = Object.fromEntries(ETAPAS.map(e => [e, 0]));
    for (const f of db.prepare('SELECT etapa, COUNT(*) AS n FROM clientas WHERE usuaria = ? GROUP BY etapa').all(duena)) porEtapa[f.etapa] = f.n;
    const h = hoy();
    const en7 = new Date(Date.parse(`${h}T00:00:00Z`) + 7 * 86400000).toISOString().slice(0, 10);
    const cuenta = (cond, ...p) => db.prepare(`SELECT COUNT(*) AS n FROM recordatorios WHERE usuaria = ? AND hecho = 0 AND ${cond}`).get(duena, ...p).n;
    const limiteMov = new Date(ahora() - LIMITES.diasSinMovimiento * 86400000).toISOString();
    const sinMovimiento = db.prepare("SELECT COUNT(*) AS n FROM clientas WHERE usuaria = ? AND etapa != 'inactiva' AND actualizada < ?").get(duena, limiteMov).n;
    registrarAcceso(ctx, duena, 'indicadores');
    return {
      total: Object.values(porEtapa).reduce((a, b) => a + b, 0), por_etapa: porEtapa,
      recordatorios: { vencidos: cuenta('fecha < ?', h), hoy: cuenta('fecha = ?', h), proximos: cuenta('fecha > ? AND fecha <= ?', h, en7) },
      sin_movimiento: sinMovimiento
    };
  }

  // Registro de accesos de administración (solo el administrador lo consulta).
  function consultarAccesos(ctx, { limite = 100 } = {}) {
    validarContexto(ctx);
    if (!ctx.esAdmin) throw error('sin_permiso', 'No tienes permiso para esta operación.');
    return db.prepare('SELECT fecha, actor, duena, accion, clienta_id FROM accesos ORDER BY id DESC LIMIT ?').all(Math.min(Math.max(Number(limite) || 100, 1), 500))
      .map(f => ({ ...f }));
  }

  return {
    crearClienta, listar, obtener, actualizar, borrar, exportar, obtenerEstilo, guardarEstilo, borrarEstilo,
    crearRecordatorio, completarRecordatorio, listarRecordatorios, indicadores, consultarAccesos
  };
}

module.exports = {
  crearGestor, abrirBase, sqliteDisponible, ETAPAS, ETAPAS_ROTULO, TEXTO_CONSENTIMIENTO, CONSENTIMIENTO_VERSION, LIMITES, LIMITES_ESTILO
};
