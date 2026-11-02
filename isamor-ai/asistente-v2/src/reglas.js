'use strict';
// Reglas de negocio del Asistente comercial. El modelo de IA redacta; estas funciones deciden.
// Sin dependencias externas. Compatible con Node 18.

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const RE_IMPORTE = /\$\s?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?/g;
const RE_UNIDAD = /\b(?:ml|g|gr|kg|l|oz|cm)\s*a\s*$/i;
const RE_MARCADOR_SET = /componentes en oferta\s*:/i;
// Formato del catálogo C12: "Set al 55% dscto.; Ccori Parfum oferta $108.500; Loción oferta $27.000" (sin la marca anterior).
const RE_SET_SIN_MARCADOR = /^\s*set\b/i;
const RE_NOTA_IMPORTACION = /\s*\|\s*Se informa precio[\s\S]*$/i;
const RE_DOS_POR_UNO = /\b2\s*x\s*1\s+por\s+(\$\s?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?)/i;
const RE_OBSEQUIO = /^\s*obsequio\b/i;
const RE_COMPRA_ESPECIAL = /^\s*compra\s+especial\b/i;
const AVISO_COMPRA_ESPECIAL = 'Compra especial: su precio solo aplica con la compra indicada en el catálogo; no se vende suelto.';
const DIAS_AVISO_CIERRE = 3;

function esNumero(v) {
  return v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
}

function precioValido(v) {
  return esNumero(v) && Number(v) > 0;
}

// "$48.500" -> 48500 ; "$64,67" -> 64.67 ; "$100.500" -> 100500
function parseImporte(texto) {
  const m = /^\$?\s*(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?$/.exec(String(texto).trim());
  if (!m) return null;
  const entero = m[1].replace(/\./g, '');
  return Number(m[2] ? `${entero}.${m[2]}` : entero);
}

// Fecha de hoy en Colombia (AAAA-MM-DD), independiente de la zona horaria del servidor.
function fechaColombia(fecha = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(fecha);
}

function diasEntre(desde, hasta) {
  const [a, b, c] = desde.split('-').map(Number);
  const [d, e, f] = hasta.split('-').map(Number);
  return Math.round((Date.UTC(d, e - 1, f) - Date.UTC(a, b - 1, c)) / 86400000);
}

// Importes de un texto de promoción, clasificados por tipo:
//  unidad      -> precio por ml, g, kg... ("ml a $64,67")
//  encabezado  -> importe antes de "componentes en oferta:" ("SET $49.500 c/u")
//  componente  -> importes después de "componentes en oferta:"
//  oferta      -> cualquier otro importe
// Un texto que empieza por "Set" y no trae la marca "componentes en oferta:" lista solo componentes: sus importes de oferta
// se tratan como componentes (su suma debe dar el precio de oferta del set).
function extraerImportes(texto) {
  const t = String(texto || '');
  const marcador = RE_MARCADOR_SET.exec(t);
  const setSinMarcador = !marcador && RE_SET_SIN_MARCADOR.test(t);
  const finMarcador = marcador ? marcador.index + marcador[0].length : -1;
  const salida = [];
  for (const m of t.matchAll(RE_IMPORTE)) {
    const valor = parseImporte(m[0]);
    if (valor === null) continue;
    const antes = t.slice(Math.max(0, m.index - 14), m.index);
    let tipo = 'oferta';
    if (RE_UNIDAD.test(antes)) tipo = 'unidad';
    else if (marcador && m.index >= finMarcador) tipo = 'componente';
    else if (marcador && m.index < marcador.index) tipo = 'encabezado';
    else if (setSinMarcador) tipo = 'componente';
    salida.push({ valor, tipo, texto: m[0] });
  }
  return salida;
}

// Coherencia entre el texto de la promoción y precio_oferta.
//  ok            -> coincide
//  inconsistente -> hay importe de oferta (o suma de componentes) y no coincide
//  no_aplica     -> sin oferta registrada o el texto no trae importe de oferta
function analizarPromocion(promocion, precioOferta) {
  if (!precioValido(precioOferta)) return { estado: 'no_aplica', motivo: 'sin_oferta' };
  const oferta = Number(precioOferta);
  const importes = extraerImportes(promocion);

  const componentes = importes.filter(i => i.tipo === 'componente');
  if (componentes.length) {
    const suma = componentes.reduce((a, i) => a + i.valor, 0);
    const encabezados = importes.filter(i => i.tipo === 'encabezado');
    const ok = suma === oferta && encabezados.every(i => i.valor === oferta);
    return { estado: ok ? 'ok' : 'inconsistente', motivo: ok ? 'set_coincide' : 'set_no_coincide', suma };
  }

  const ofertas = importes.filter(i => i.tipo === 'oferta');
  if (!ofertas.length) return { estado: 'no_aplica', motivo: 'sin_importe_de_oferta' };
  const ok = ofertas.some(i => i.valor === oferta);
  return { estado: ok ? 'ok' : 'inconsistente', motivo: ok ? 'coincide' : 'no_coincide' };
}

// Estado de la campaña (vigencia común a todo el catálogo cargado).
function estadoCampana(campana, hoy) {
  if (!campana) return { estado: 'sin_configurar' };
  const desde = RE_FECHA.test(campana.vigencia_desde || '') ? campana.vigencia_desde : null;
  const hasta = RE_FECHA.test(campana.vigencia_hasta || '') ? campana.vigencia_hasta : null;
  if (!desde && !hasta) return { estado: 'sin_configurar' };
  const base = { nombre: campana.campana || null, desde, hasta };
  if (desde && hoy < desde) return { ...base, estado: 'aun_no_rige' };
  if (hasta && hoy > hasta) return { ...base, estado: 'vencida' };
  const dias = hasta ? diasEntre(hoy, hasta) : null;
  return { ...base, estado: 'vigente', dias_restantes: dias, termina_pronto: dias !== null && dias <= DIAS_AVISO_CIERRE };
}

// Estado de la oferta de un producto: vigencia propia si existe; si no, la de la campaña.
function estadoOferta(producto, campana, hoy) {
  if (!precioValido(producto.precio_oferta)) return { estado: 'sin_oferta' };
  const propiaDesde = RE_FECHA.test(producto.vigencia_desde || '') ? producto.vigencia_desde : null;
  const propiaHasta = RE_FECHA.test(producto.vigencia_hasta || '') ? producto.vigencia_hasta : null;
  if (propiaDesde || propiaHasta) {
    const e = estadoCampana({ campana: null, vigencia_desde: propiaDesde, vigencia_hasta: propiaHasta }, hoy);
    return { ...e, origen: 'producto' };
  }
  const e = estadoCampana(campana, hoy);
  if (e.estado === 'sin_configurar') return { estado: 'sin_vigencia' };
  return { ...e, origen: 'campana' };
}

// La importación del catálogo agrega al final de la promoción una nota interna ("| Se informa precio ... pero no el
// precio normal. Promoción: ..."). No es texto del catálogo: se quita antes de mostrar la promoción.
function limpiarPromocion(texto) {
  return String(texto || '').replace(RE_NOTA_IMPORTACION, '').trim();
}

// "2 x 1 por $56.000": devuelve el importe (56000) o null. Solo 2 x 1; otras formas de combo no se interpretan.
function importeDosPorUno(promocion) {
  const m = RE_DOS_POR_UNO.exec(String(promocion || ''));
  return m ? parseImporte(m[1]) : null;
}

// Producto tal como lo ve el modelo: solo campos autorizados, más banderas calculadas por código.
function prepararProducto(p, campana, hoy) {
  const promocion = limpiarPromocion(p.promocion);
  const oferta = estadoOferta(p, campana, hoy);
  const coherencia = analizarPromocion(promocion, p.precio_oferta);
  const advertencias = [];

  // Regla de negocio (confirmada por la usuaria, 28 oct): en una promoción "2 x 1" el único precio del catálogo es el
  // precio normal de 1 unidad; la oferta es que, al comprar 1, recibe 2. Solo se deduce si falta el precio normal y el
  // importe del texto coincide con el precio registrado.
  const dosPorUno = importeDosPorUno(promocion);
  const normalDeducido = dosPorUno !== null && !precioValido(p.precio_normal)
    && precioValido(p.precio_oferta) && Number(p.precio_oferta) === dosPorUno;
  const precioNormal = precioValido(p.precio_normal) ? Number(p.precio_normal) : (normalDeducido ? Number(p.precio_oferta) : null);
  const precioOferta = normalDeducido ? null : (precioValido(p.precio_oferta) ? Number(p.precio_oferta) : null);

  // Regla de negocio (confirmada por la usuaria, 30 oct): un registro sin ningún precio cuyo texto empieza por "Obsequio"
  // es un regalo con la compra de otro producto, no un dato faltante.
  const esObsequio = precioNormal === null && precioOferta === null && RE_OBSEQUIO.test(promocion);

  if (!p.estado || p.estado === 'pendiente_revision') advertencias.push('Dato pendiente de revisión.');
  // Regla de negocio (confirmada por la usuaria, 2 nov): "Compra especial" = artículo con precio de oferta y sin precio normal
  // que solo se adquiere con la compra de otro producto; nunca se vende suelto.
  const esCompraEspecial = !esObsequio && !normalDeducido && precioNormal === null && precioOferta !== null && RE_COMPRA_ESPECIAL.test(promocion);

  if (precioNormal === null && !esObsequio && !esCompraEspecial) advertencias.push('No tengo el precio normal de este producto.');
  if (precioOferta === null && !normalDeducido && !esObsequio) advertencias.push('No tiene oferta registrada.');
  if (esCompraEspecial) advertencias.push(AVISO_COMPRA_ESPECIAL);
  if (esObsequio) advertencias.push('Obsequio: se entrega gratis con la compra indicada en el catálogo; no se vende por separado.');
  if (normalDeducido) advertencias.push('Promoción 2 x 1: el precio del catálogo es el de 1 unidad y, al comprar 1, recibe 2.');
  if (oferta.estado === 'vencida') advertencias.push('La oferta está vencida: no la presentes como vigente.');
  if (oferta.estado === 'aun_no_rige') advertencias.push('La oferta aún no rige.');
  if (oferta.estado === 'sin_vigencia') advertencias.push('Vigencia no registrada: pide confirmar antes de ofrecerla.');
  if (oferta.termina_pronto) advertencias.push(`La campaña termina pronto (${oferta.hasta}).`);
  if (coherencia.estado === 'inconsistente') {
    advertencias.push('El texto de la promoción y el precio registrado no coinciden: pide confirmar antes de ofrecerlo.');
  }
  if (/solo se vende dentro/i.test(promocion)) {
    advertencias.push('Se vende solo dentro de un set: el importe del texto es el del set, no el del producto.');
  }

  return {
    id: p.id,
    referencia: p.referencia || null,
    nombre: p.nombre,
    categoria: p.categoria,
    presentacion: p.presentacion || null,
    pagina_origen: p.pagina_origen || null,
    precio_normal: precioNormal,
    precio_oferta: precioOferta,
    tipo_promocion: dosPorUno !== null ? '2x1' : (esObsequio ? 'obsequio' : (esCompraEspecial ? 'compra_especial' : null)),
    resumen_oferta: normalDeducido
      ? 'Oferta 2 x 1: pides 1 y recibes 2 por el precio normal.'
      : (esObsequio ? 'Obsequio: se entrega gratis con la compra indicada; no se vende por separado.'
        : (esCompraEspecial ? 'Compra especial: este precio solo aplica con la compra indicada en la promoción; no se vende suelto.' : null)),
    precio_normal_deducido: normalDeducido,
    promocion: promocion || null,
    oferta,
    coherencia: coherencia.estado,
    revision: !p.estado || p.estado === 'pendiente_revision' ? 'pendiente' : 'confirmado',
    advertencias
  };
}

module.exports = {
  parseImporte, fechaColombia, diasEntre, extraerImportes, analizarPromocion,
  estadoCampana, estadoOferta, prepararProducto, precioValido, limpiarPromocion, importeDosPorUno, AVISO_COMPRA_ESPECIAL, DIAS_AVISO_CIERRE
};
