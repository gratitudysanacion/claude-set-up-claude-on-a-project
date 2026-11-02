'use strict';
// Límites de uso del chat por usuaria: ventana de un minuto y tope diario (día de Colombia).
const { fechaColombia } = require('./reglas');

function crearLimites({ ahora = () => Date.now(), porMinuto = 12, porDia = 200 } = {}) {
  const minuto = new Map();
  const dia = new Map();

  function consumir(usuario) {
    const t = ahora();
    const recientes = (minuto.get(usuario) || []).filter(x => t - x < 60000);
    if (recientes.length >= porMinuto) {
      minuto.set(usuario, recientes);
      return { ok: false, motivo: 'minuto', retryAfterS: Math.max(1, Math.ceil((60000 - (t - recientes[0])) / 1000)) };
    }

    const hoy = fechaColombia(new Date(t));
    const d = dia.get(usuario);
    const contador = d && d.fecha === hoy ? d.cuenta : 0;
    if (contador >= porDia) return { ok: false, motivo: 'dia', retryAfterS: 3600 };

    recientes.push(t);
    minuto.set(usuario, recientes);
    dia.set(usuario, { fecha: hoy, cuenta: contador + 1 });
    return { ok: true, restantesHoy: porDia - contador - 1 };
  }

  return { consumir };
}

module.exports = { crearLimites };
