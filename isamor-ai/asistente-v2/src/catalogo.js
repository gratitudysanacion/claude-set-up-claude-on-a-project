'use strict';
// Catálogo de solo lectura: carga la copia de lectura, busca productos y devuelve los datos ya procesados.
const fs = require('node:fs');
const { fechaColombia, estadoCampana, prepararProducto } = require('./reglas');

const LIMITE_MAXIMO = 10;
const PALABRAS_VACIAS = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'y', 'en', 'para', 'un', 'una', 'por', 'con',
  'cuanto', 'cuesta', 'vale', 'precio', 'tiene', 'tienen', 'me', 'quiero', 'saber'
]);

function normalizar(texto) {
  return String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function leerJson(ruta) {
  return JSON.parse(fs.readFileSync(ruta, 'utf8'));
}

// campaña: { campana, vigencia_desde, vigencia_hasta }. Ausente o ilegible -> null (el asistente no se cae).
function cargarCampana(ruta) {
  try { return leerJson(ruta); } catch { return null; }
}

function cargarProductos(ruta) {
  const datos = leerJson(ruta);
  const lista = Array.isArray(datos) ? datos : datos.productos;
  if (!Array.isArray(lista)) throw new Error('La copia de lectura no contiene una lista de productos.');
  return lista;
}

function crearCatalogo({ productos, campana = null, hoy = () => fechaColombia() }) {
  const indice = productos.map(p => ({
    producto: p,
    nombre: normalizar(p.nombre),
    texto: normalizar([p.nombre, p.categoria, p.presentacion, p.referencia].join(' ')),
    referencia: normalizar(p.referencia)
  }));

  function contexto() {
    const fecha = hoy();
    const c = estadoCampana(campana, fecha);
    const aviso = c.estado === 'vencida'
      ? `El catálogo cargado es de la campaña ${c.nombre || ''} y terminó el ${c.hasta}; no confirmes precios vigentes.`
      : c.estado === 'aun_no_rige' ? `La campaña ${c.nombre || ''} aún no rige (desde ${c.desde}).`
      : c.estado === 'sin_configurar' ? 'No hay vigencia de campaña configurada: pide confirmar la vigencia.'
      : null;
    return { fecha, campana: c, aviso_campana: aviso };
  }

  function buscar(consulta, { categoria = null, limite = LIMITE_MAXIMO } = {}) {
    const ctx = contexto();
    const q = normalizar(consulta);
    if (!q) return { error: 'consulta_vacia', ...ctx, productos: [] };

    const tope = Math.min(Math.max(1, Number.parseInt(limite, 10) || LIMITE_MAXIMO), LIMITE_MAXIMO);
    const cat = categoria ? normalizar(categoria) : null;
    let candidatos = indice.filter(i => !cat || normalizar(i.producto.categoria).includes(cat));

    // Referencia exacta: es única entre las no vacías.
    const porReferencia = candidatos.filter(i => i.referencia && i.referencia === q);
    let encontrados;
    if (porReferencia.length) {
      encontrados = porReferencia.map(i => ({ i, puntaje: 100 }));
    } else {
      const tokens = q.split(' ').filter(t => !PALABRAS_VACIAS.has(t));
      if (!tokens.length) return { error: 'consulta_sin_terminos', ...ctx, productos: [] };
      encontrados = candidatos
        .filter(i => tokens.every(t => i.texto.includes(t)))
        .map(i => ({ i, puntaje: tokens.every(t => i.nombre.includes(t)) ? 3 : 1 }));
    }

    encontrados.sort((a, b) => b.puntaje - a.puntaje || a.i.nombre.localeCompare(b.i.nombre, 'es'));
    const devueltos = encontrados.slice(0, tope).map(x => prepararProducto(x.i.producto, campana, ctx.fecha));
    return {
      consulta,
      total_coincidencias: encontrados.length,
      devueltos: devueltos.length,
      truncado: encontrados.length > devueltos.length,
      ambiguo: devueltos.length > 1,
      ...ctx,
      productos: devueltos
    };
  }

  function detalle({ id = null, referencia = null } = {}) {
    const ctx = contexto();
    let hallado = null;
    if (id !== null && id !== undefined) hallado = indice.find(i => String(i.producto.id) === String(id));
    else if (referencia) hallado = indice.find(i => i.referencia && i.referencia === normalizar(referencia));
    if (!hallado) return { encontrado: false, ...ctx, productos: [] };
    return { encontrado: true, ...ctx, productos: [prepararProducto(hallado.producto, campana, ctx.fecha)] };
  }

  return { buscar, detalle, estado: contexto, total: productos.length };
}

const RE_FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

// Campaña programada: el catálogo `siguiente` entra en vigor solo, a las 00:00 (hora de Colombia) de su `vigencia_desde`.
// Antes de esa fecha responde la campaña actual; desde esa fecha, la siguiente. Sin `siguiente` se comporta como crearCatalogo.
function crearCatalogoProgramado({ actual, siguiente = null, hoy = () => fechaColombia() }) {
  const a = crearCatalogo({ productos: actual.productos, campana: actual.campana, hoy });
  const desde = siguiente && siguiente.campana && siguiente.campana.vigencia_desde;
  const s = siguiente && RE_FECHA_ISO.test(desde || '')
    ? crearCatalogo({ productos: siguiente.productos, campana: siguiente.campana, hoy })
    : null;
  const activo = () => (s && hoy() >= desde ? s : a);
  return {
    buscar: (...args) => activo().buscar(...args),
    detalle: (...args) => activo().detalle(...args),
    estado: () => activo().estado(),
    get total() { return activo().total; },
    programacion: () => ({
      activa: activo() === s ? 'siguiente' : 'actual',
      siguiente: s ? { nombre: siguiente.campana.campana || null, desde, productos: s.total } : null
    })
  };
}

module.exports = { crearCatalogo, crearCatalogoProgramado, cargarProductos, cargarCampana, normalizar, LIMITE_MAXIMO };
