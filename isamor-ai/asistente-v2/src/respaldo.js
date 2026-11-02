'use strict';
// Respuesta determinística ("ficha") sin IA: se usa cuando el modelo falla o el verificador rechaza su texto.
// Solo escribe datos que vienen de las herramientas del catálogo; no redacta nada propio sobre precios.
const MAX_FICHAS = 5;
const AVISO_CE = 'solo aplica con la compra indicada en el catálogo; no se vende suelto';

function pesos(valor) {
  // Formato manual (no depende de ICU): 48500 -> $48.500
  return '$' + String(Math.round(Number(valor))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

// 2026-11-06 -> 06/11/2026
function fechaCorta(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || '');
}

function lineaVigencia(oferta) {
  switch (oferta && oferta.estado) {
    case 'vigente': return `Vigente hasta el ${fechaCorta(oferta.hasta)}${oferta.termina_pronto ? ' (termina pronto)' : ''}`;
    case 'vencida': return `Oferta vencida: terminó el ${fechaCorta(oferta.hasta)}`;
    case 'aun_no_rige': return `Aún no rige: desde el ${fechaCorta(oferta.desde)}`;
    case 'sin_vigencia': return 'Vigencia no registrada: confirma antes de ofrecerla';
    default: return null;
  }
}

function fichaProducto(p) {
  const vencida = p.oferta && p.oferta.estado === 'vencida';
  const lineas = [`${p.nombre}${p.referencia ? ` (ref. ${p.referencia})` : ''}${p.presentacion ? ` · ${p.presentacion}` : ''}`];
  if (p.tipo_promocion === 'compra_especial') {
    // el precio y la aclaración van en una sola línea (abajo)
  } else if (p.tipo_promocion === 'obsequio') {
    lineas.push('  Obsequio: se entrega gratis con la compra indicada en el catálogo (no se vende por separado)');
  } else {
    lineas.push(`  Precio normal: ${p.precio_normal !== null ? pesos(p.precio_normal) : 'no tengo ese dato'}`);
  }
  if (p.tipo_promocion === 'obsequio') {
    // sin línea de precio de oferta: no aplica
  } else if (p.tipo_promocion === 'compra_especial') {
    lineas.push(`  Precio: ${pesos(p.precio_oferta)}${vencida ? ' (VENCIDO, solo de referencia)' : ''} — ${AVISO_CE}`);
  } else if (p.tipo_promocion === '2x1' && p.precio_oferta === null) {
    lineas.push(`  Oferta: 2 x 1 (pides 1 y recibes 2)${vencida ? ' (VENCIDA, solo de referencia)' : ''}`);
  } else {
    lineas.push(`  Precio de oferta: ${p.precio_oferta !== null ? pesos(p.precio_oferta) + (vencida ? ' (VENCIDO, solo de referencia)' : '') : 'sin oferta registrada'}`);
  }
  const vig = lineaVigencia(p.oferta);
  if (vig) lineas.push(`  Vigencia: ${vig}`);
  if (p.promocion) lineas.push(`  Promoción (texto del catálogo): ${p.promocion}`);
  if (p.pagina_origen) lineas.push(`  Catálogo, página ${p.pagina_origen}`);
  return lineas.join('\n');
}

// resultados: lista de respuestas de herramientas ({productos, truncado, total_coincidencias, aviso_campana}).
function fichaDeterminista(resultados) {
  const vistos = new Set();
  const productos = [];
  let aviso = null;
  let total = 0;
  for (const r of resultados || []) {
    if (r.aviso_campana) aviso = r.aviso_campana;
    if (r.total_coincidencias > total) total = r.total_coincidencias;
    for (const p of r.productos || []) {
      if (vistos.has(p.id)) continue;
      vistos.add(p.id);
      productos.push(p);
    }
  }

  const partes = [];
  if (aviso) partes.push(`Aviso: ${aviso}`);
  if (!productos.length) {
    partes.push('No encontré productos con ese criterio en el catálogo cargado. Prueba con el nombre o el código del producto.');
    return partes.join('\n\n');
  }
  partes.push('Estos son los datos del catálogo:');
  partes.push(productos.slice(0, MAX_FICHAS).map(fichaProducto).join('\n\n'));
  const faltan = Math.max(total, productos.length) - Math.min(productos.length, MAX_FICHAS);
  if (faltan > 0) partes.push(`Hay ${faltan} coincidencia(s) más. Indica el nombre o el código exacto para verlas.`);
  return partes.join('\n\n');
}

// Advertencias para mostrar a la usuaria (sin repetir), a partir de los resultados de las herramientas.
// Avisos para la usuaria. Los explicativos (2 x 1, obsequio) solo se muestran si el texto entregado habla de eso: así no
// aparecen por productos que se consultaron pero no se mencionaron. Sin texto (respaldo) se muestran todos.
function advertenciasDe(resultados, texto) {
  const salida = new Set();
  for (const r of resultados || []) {
    if (r.aviso_campana) salida.add(r.aviso_campana);
    for (const p of r.productos || []) for (const a of p.advertencias || []) salida.add(a);
  }
  if (typeof texto === 'string') {
    const t = texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    for (const a of [...salida]) {
      if (a.startsWith('Promoción 2 x 1') && !/2\s*x\s*1|dos\s+por\s+uno|pides\s+1/.test(t)) salida.delete(a);
      if (a.startsWith('Compra especial:') && !/compra\s+especial|no se vende suelto|no se vende por separado|solo aplica|solo con la compra/.test(t)) salida.delete(a);
      if (a.startsWith('Obsequio:') && !/obsequio|regalo|gratis/.test(t)) salida.delete(a);
    }
  }
  return [...salida];
}

module.exports = { fichaDeterminista, advertenciasDe, pesos, fechaCorta, MAX_FICHAS };
