'use strict';
// Cifrado de datos personales del Gestor: AES-256-GCM con valor aleatorio por dato y autenticación.
// El "contexto" (usuaria|clienta|campo) se ata al dato: un valor copiado a otra fila o a otro campo no se puede descifrar.
const crypto = require('node:crypto');

const VERSION = 'v1';
const LARGO_LLAVE = 32;

function error(codigo, mensaje) {
  const e = new Error(mensaje || codigo);
  e.codigo = codigo;
  return e;
}

// llaveHex: 64 caracteres hexadecimales (32 bytes). Nunca se imprime ni se incluye en errores.
function crearCifrado(llaveHex) {
  if (typeof llaveHex !== 'string' || !/^[0-9a-fA-F]{64}$/.test(llaveHex)) {
    throw error('llave_invalida', 'La llave de cifrado debe tener 64 caracteres hexadecimales.');
  }
  const llave = Buffer.from(llaveHex, 'hex');
  if (llave.length !== LARGO_LLAVE) throw error('llave_invalida');

  function cifrar(texto, contexto) {
    if (texto === null || texto === undefined || texto === '') return null;
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', llave, iv);
    c.setAAD(Buffer.from(String(contexto), 'utf8'));
    const cifrado = Buffer.concat([c.update(String(texto), 'utf8'), c.final()]);
    return [VERSION, iv.toString('base64'), c.getAuthTag().toString('base64'), cifrado.toString('base64')].join(':');
  }

  function descifrar(valor, contexto) {
    if (valor === null || valor === undefined || valor === '') return null;
    const partes = String(valor).split(':');
    if (partes.length !== 4 || partes[0] !== VERSION) throw error('dato_invalido', 'Formato de dato cifrado no reconocido.');
    try {
      const d = crypto.createDecipheriv('aes-256-gcm', llave, Buffer.from(partes[1], 'base64'));
      d.setAAD(Buffer.from(String(contexto), 'utf8'));
      d.setAuthTag(Buffer.from(partes[2], 'base64'));
      return Buffer.concat([d.update(Buffer.from(partes[3], 'base64')), d.final()]).toString('utf8');
    } catch {
      throw error('descifrado_fallido', 'No se pudo descifrar el dato (llave distinta o dato alterado).');
    }
  }

  return { cifrar, descifrar };
}

function generarLlaveHex() { return crypto.randomBytes(LARGO_LLAVE).toString('hex'); }

module.exports = { crearCifrado, generarLlaveHex };
