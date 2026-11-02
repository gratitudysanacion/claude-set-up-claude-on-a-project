'use strict';
// Minimización de datos hacia la IA: antes de enviar notas al modelo se reemplazan teléfonos, cédulas, correos y
// direcciones por marcas, y solo se usa el primer nombre. Lo que se enmascara aquí nunca llega al proveedor.

const RE_CORREO = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Dirección colombiana típica: "Calle 45 #12-34", "Cra 7 No. 80-15", "Carrera 15 # 100 - 20", "Transversal 3 # 4-5"...
const RE_DIRECCION = /\b(?:calle|cll?|carrera|cra?|kr|avenida|av|avenida\s+calle|diagonal|dg|diag|transversal|tv|trans|circular|autopista|manzana|mz)\.?\s*\d+[A-Za-z]?(?:\s*(?:bis|sur|norte|este|oeste))?\s*(?:#|no\.?|nro\.?|n°|numero|número)?\s*\d+[A-Za-z]?\s*[-–]\s*\d+[A-Za-z]?(?:[^\n.;]{0,40}?(?:apto|apartamento|casa|torre|int|interior|bloque|barrio|conjunto)\b[^\n.;]{0,30})?/gi;
// Cualquier secuencia numérica con separadores (espacios, puntos, guiones, paréntesis, +) de 6 a 15 dígitos:
// teléfonos (+57 300 123 4567, (601) 234 5678) y cédulas (1.234.567.890). Los importes en pesos se protegen antes.
const RE_NUMERO = /(?:\+ ?)?\(?\d[\d().\- ]{4,}\d\b/g;

function enmascarar(texto) {
  let t = String(texto || '');
  t = t.replace(RE_CORREO, '[CORREO]');
  t = t.replace(RE_DIRECCION, '[DIRECCIÓN]');
  // Los importes en pesos ($254.000, $ 48.500) no son datos personales: se protegen antes de buscar teléfonos y cédulas.
  const importes = [];
  t = t.replace(/\$\s?\d[\d.,]*/g, m => { importes.push(m); return `\u0000${importes.length - 1}\u0000`; });
  t = t.replace(RE_NUMERO, m => {
    const digitos = m.replace(/\D/g, '');
    if (digitos.length < 6 || digitos.length > 15) return m;
    return /^(?:57)?3\d{9}$/.test(digitos) || /^(?:57)?60\d{8}$/.test(digitos) ? '[TELÉFONO]' : '[NÚMERO]';
  });
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => importes[Number(i)]);
}

function primerNombre(nombre) {
  const t = String(nombre || '').trim().split(/\s+/)[0] || '';
  return t.slice(0, 30);
}

// Resumen de la clienta apto para enviar al modelo: nunca incluye teléfono, cédula ni dirección.
function resumenParaIA(clienta) {
  return {
    nombre: primerNombre(clienta.nombre),
    etapa: clienta.etapa,
    notas: enmascarar(clienta.notas || '')
  };
}

// Verifica que un texto no contenga datos sensibles conocidos de la clienta (se usa sobre lo que redacta el modelo).
function contieneDatosSensibles(texto, clienta) {
  const t = String(texto || '').replace(/\D/g, '');
  const sensibles = [clienta.telefono, clienta.cedula].filter(Boolean).map(x => String(x).replace(/\D/g, '')).filter(x => x.length >= 6);
  if (sensibles.some(s => t.includes(s))) return true;
  const plano = String(texto || '').toLowerCase();
  const dir = String(clienta.direccion || '').trim().toLowerCase();
  return !!(dir && dir.length >= 8 && plano.includes(dir));
}

module.exports = { enmascarar, primerNombre, resumenParaIA, contieneDatosSensibles };
