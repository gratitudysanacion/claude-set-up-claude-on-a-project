'use strict';
// Verificador de importes: ningún importe en pesos puede aparecer en la respuesta
// si no lo devolvió alguna herramienta del catálogo.
const { parseImporte, extraerImportes } = require('./reglas');

const RE_IMPORTE_PESOS = /\$\s?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?/g;
const RE_NUMERO_PESOS = /((?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?)\s*(?:pesos|cop)\b/gi;

function importesPermitidos(resultados) {
  const permitidos = new Set();
  for (const r of resultados || []) {
    for (const p of r.productos || []) {
      if (p.precio_normal != null) permitidos.add(Number(p.precio_normal));
      if (p.precio_oferta != null) permitidos.add(Number(p.precio_oferta));
      for (const i of extraerImportes(p.promocion)) permitidos.add(i.valor);
    }
  }
  return permitidos;
}

function importesEnTexto(texto) {
  const t = String(texto || '');
  const valores = [];
  for (const m of t.matchAll(RE_IMPORTE_PESOS)) valores.push(parseImporte(m[0]));
  for (const m of t.matchAll(RE_NUMERO_PESOS)) valores.push(parseImporte(m[1]));
  return valores.filter(v => v !== null);
}

function verificarRespuesta(texto, resultados) {
  const permitidos = importesPermitidos(resultados);
  const violaciones = [...new Set(importesEnTexto(texto).filter(v => !permitidos.has(v)))];
  return { ok: violaciones.length === 0, violaciones };
}

// Compra especial (regla de la usuaria, 2 nov): si el texto cita el precio de un producto "compra_especial", debe aclarar que solo
// aplica con la compra indicada Y que no se vende suelto. Se comparan sin tildes y en minúsculas.
const RE_SOLO_APLICA = /(?:solo|unicamente|exclusivamente)\s+(?:aplica|con\s+la\s+compra|si\s+compras|al\s+comprar|por\s+la\s+compra|para\s+quien\s+compra)|aplica\s+(?:solo|unicamente|exclusivamente)|(?:requiere|exige)\s+(?:la\s+)?compra/;
const RE_NO_SUELTO = /no\s+(?:se\s+)?(?:vende|venden|ofrece|puede\s+comprar|compra|comercializa)[^.\n]{0,30}(?:suelt|por\s+separado|individual|aparte|sol[oa]s?\b)/;
const sinTildes = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function comprasEspecialesCitadas(texto, resultados) {
  const valores = new Set(importesEnTexto(texto));
  const citadas = [];
  for (const r of resultados || []) {
    for (const p of r.productos || []) {
      if (p.tipo_promocion === 'compra_especial' && p.precio_oferta != null && valores.has(Number(p.precio_oferta))) citadas.push(p);
    }
  }
  return citadas;
}

// Una compra especial no tiene precio normal: decir «precio normal: no tengo ese dato» confunde (parece un dato que falta).
const RE_SIN_NORMAL = /precio\s+normal\s*:?[^.\n]{0,25}no\s+tengo|no\s+tengo\s+(?:el\s+|ese\s+)?(?:dato\s+del\s+)?precio\s+normal/;

// -> { ok, faltan: [] } ; faltan puede contener 'solo_aplica_con_compra', 'no_se_vende_suelto' y 'sin_precio_normal_espurio'
function verificarCompraEspecial(texto, resultados) {
  if (!comprasEspecialesCitadas(texto, resultados).length) return { ok: true, faltan: [] };
  const t = sinTildes(texto);
  const faltan = [];
  if (!RE_SOLO_APLICA.test(t)) faltan.push('solo_aplica_con_compra');
  if (!RE_NO_SUELTO.test(t)) faltan.push('no_se_vende_suelto');
  // Solo se rechaza si ningún otro producto del resultado carece de precio normal (en ese caso la frase podría ser cierta).
  const otroSinNormal = (resultados || []).some(r => (r.productos || []).some(p => p.precio_normal == null && p.tipo_promocion !== 'compra_especial'));
  if (!otroSinNormal && RE_SIN_NORMAL.test(t)) faltan.push('sin_precio_normal_espurio');
  return { ok: faltan.length === 0, faltan };
}

// Afirmar que NO hay productos de un tipo de oferta (2 x 1, obsequio, compra especial) cuando el resultado sí los trae.
const AUSENCIAS = [
  { tipo: '2x1', re: /\bno\s+(?:encontr\w+|hay|tengo|existen?|tenemos|aparecen|figuran)\b[^.\n]{0,80}?(?:\b2\s*x\s*1\b|dos\s+por\s+uno)/ },
  { tipo: 'obsequio', re: /\bno\s+(?:encontr\w+|hay|tengo|existen?|tenemos|aparecen|figuran)\b[^.\n]{0,80}?(?:obsequios?|regalos?)/ },
  { tipo: 'compra_especial', re: /\bno\s+(?:encontr\w+|hay|tengo|existen?|tenemos|aparecen|figuran)\b[^.\n]{0,80}?compras?\s+especial/ }
];
function verificarAusenciaFalsa(texto, resultados) {
  const t = sinTildes(texto);
  const falsos = AUSENCIAS.filter(a => a.re.test(t)
    && (resultados || []).some(r => (r.productos || []).some(p => p.tipo_promocion === a.tipo))).map(a => a.tipo);
  return { ok: falsos.length === 0, tipos: falsos };
}

const CORRECCION_COMPRA_ESPECIAL = 'Cuando menciones el precio de un producto con tipo_promocion "compra_especial" debes aclarar, en ese mismo texto, '
  + 'que ese precio solo aplica con la compra de un producto (el que indica la promoción) y que no se vende suelto. '
  + 'No escribas «precio normal: no tengo ese dato» para estos productos: no tienen precio normal, no es un dato que falte.';

module.exports = { verificarAusenciaFalsa, verificarCompraEspecial, comprasEspecialesCitadas, CORRECCION_COMPRA_ESPECIAL, verificarRespuesta, importesPermitidos, importesEnTexto };
