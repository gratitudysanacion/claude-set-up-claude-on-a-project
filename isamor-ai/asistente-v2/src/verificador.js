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

module.exports = { verificarRespuesta, importesPermitidos, importesEnTexto };
