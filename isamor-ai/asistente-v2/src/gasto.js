'use strict';
// Tope mensual de gasto de la IA (decisión de la usuaria, 4 nov 2026: 10 USD al mes).
// Suma los tokens que informa el proveedor, los valora con los precios configurados y bloquea las llamadas nuevas al llegar al tope.
//  - Es una protección DE LA APLICACIÓN: el límite real de la organización se fija en la consola de Anthropic y debe ser >= este tope.
//  - Persiste en data/gasto.json (permisos 600, escritura atómica). Si el archivo falta o está dañado empieza en cero (no tumba el servicio).
//  - Solo guarda totales de tokens por mes (hora de Colombia): nunca texto de consultas ni de respuestas.
const fs = require('node:fs');
const path = require('node:path');
const { fechaColombia } = require('./reglas');

// USD por millón de tokens. Haiku 5.5 según la consola de la usuaria (4 nov 2026); se pueden cambiar con variables de entorno.
const PRECIO_ENTRADA_POR_DEFECTO = 0.10;
const PRECIO_SALIDA_POR_DEFECTO = 0.50;
const AVISO_PORCENTAJE = 0.8;

function crearGasto({
  ruta = null, topeUsd = 10, precioEntrada = PRECIO_ENTRADA_POR_DEFECTO, precioSalida = PRECIO_SALIDA_POR_DEFECTO,
  ahora = () => Date.now(), log = () => {}
} = {}) {
  if (!(topeUsd > 0)) throw new Error('El tope mensual debe ser mayor que cero.');
  const mesActual = () => fechaColombia(new Date(ahora())).slice(0, 7);
  let datos = { mes: mesActual(), entrada: 0, salida: 0, llamadas: 0 };

  if (ruta) {
    try {
      const leido = JSON.parse(fs.readFileSync(ruta, 'utf8'));
      if (leido && typeof leido.mes === 'string' && Number.isFinite(leido.entrada) && Number.isFinite(leido.salida)) {
        datos = { mes: leido.mes, entrada: Math.max(0, leido.entrada), salida: Math.max(0, leido.salida), llamadas: Math.max(0, Number(leido.llamadas) || 0) };
      }
    } catch { /* primera vez o archivo dañado: se empieza en cero */ }
  }

  function guardar() {
    if (!ruta) return;
    try {
      const temporal = `${ruta}.tmp`;
      fs.mkdirSync(path.dirname(ruta), { recursive: true });
      fs.writeFileSync(temporal, JSON.stringify(datos), { mode: 0o600 });
      fs.renameSync(temporal, ruta);
      fs.chmodSync(ruta, 0o600);
    } catch (e) { log({ evento: 'gasto_no_guardado', codigo: (e && e.code) || 'error' }); }
  }

  function alDia() {
    const mes = mesActual();
    if (datos.mes !== mes) { datos = { mes, entrada: 0, salida: 0, llamadas: 0 }; guardar(); }
  }

  function estado() {
    alDia();
    const usd = (datos.entrada * precioEntrada + datos.salida * precioSalida) / 1e6;
    return {
      mes: datos.mes, usd: Math.round(usd * 10000) / 10000, tope: topeUsd, porcentaje: Math.round((usd / topeUsd) * 1000) / 10,
      llamadas: datos.llamadas, aviso: usd >= topeUsd * AVISO_PORCENTAJE && usd < topeUsd, bloqueado: usd >= topeUsd
    };
  }

  function registrar(uso) {
    alDia();
    const e = Number(uso && uso.entrada), s = Number(uso && uso.salida);
    if (Number.isFinite(e) && e > 0) datos.entrada += e;
    if (Number.isFinite(s) && s > 0) datos.salida += s;
    datos.llamadas += 1;
    guardar();
    return estado();
  }

  return { estado, registrar };
}

module.exports = { crearGasto, PRECIO_ENTRADA_POR_DEFECTO, PRECIO_SALIDA_POR_DEFECTO, AVISO_PORCENTAJE };
