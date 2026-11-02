'use strict';
// Motor genérico de agentes: el modelo redacta, el código decide.
// Cada módulo (comercial, contenido, ...) aporta sus instrucciones, sus herramientas y su verificador;
// este motor aporta el bucle de herramientas, los topes, el reintento de corrección y el cliente HTTP.
const URL_API = 'https://api.anthropic.com/v1/messages';
const VERSION_API = '2023-06-01';
const MODELO_POR_DEFECTO = 'claude-haiku-5-5';
const MAX_RESULTADO_CHARS = 12000;
const NOTA_RECORTE = '(La respuesta se acortó. Pregunta por un producto a la vez para ver todo el detalle.)';

function error(codigo, mensaje) {
  const e = new Error(mensaje || codigo);
  e.codigo = codigo;
  return e;
}

function acotar(resultado) {
  const texto = JSON.stringify(resultado);
  return texto.length <= MAX_RESULTADO_CHARS ? texto : JSON.stringify({ error: 'resultado_demasiado_grande', detalle: 'Acota la búsqueda.' });
}

// Cliente HTTP real. Traduce los fallos del proveedor a códigos internos sin filtrar cabeceras ni la llave.
function crearClienteHttp({ apiKey, fetchImpl = globalThis.fetch, timeoutMs = 30000, url = URL_API }) {
  return async function llamar(cuerpo) {
    const control = new AbortController();
    const temporizador = setTimeout(() => control.abort(), timeoutMs);
    let respuesta;
    try {
      respuesta = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': VERSION_API },
        body: JSON.stringify(cuerpo),
        signal: control.signal
      });
    } catch (e) {
      throw error(e && e.name === 'AbortError' ? 'tiempo_agotado' : 'ia_no_disponible');
    } finally {
      clearTimeout(temporizador);
    }
    if (!respuesta.ok) {
      let detalle = '';
      try { detalle = String((await respuesta.json()).error?.message || ''); } catch { /* sin cuerpo */ }
      if (respuesta.status === 400 && /credit balance|billing/i.test(detalle)) throw error('saldo_agotado');
      throw error('ia_no_disponible', `HTTP ${respuesta.status}`);
    }
    try { return await respuesta.json(); } catch { throw error('ia_no_disponible'); }
  };
}

// La interfaz muestra solo texto plano. Aunque el modelo se desvíe de la instrucción, no llegan asteriscos ni encabezados.
function aTextoPlano(texto) {
  return String(texto || '')
    .replace(/^\s*\*\s+/gm, '- ')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/\*(?!\s)([^*\n]+?)\*/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '');
}

function textoDe(contenido) {
  return aTextoPlano((contenido || []).filter(b => b.type === 'text').map(b => b.text).join('\n')).trim();
}

// Si el modelo se queda sin espacio (max_tokens) la última frase queda a medias: se descarta hasta el último renglón
// completo y se avisa, en vez de mostrar una frase cortada.
function recortarRespuesta(texto) {
  const renglones = String(texto || '').split('\n');
  renglones.pop();
  // Un encabezado sin contenido ("HASHTAGS:") que quedó al final tampoco se muestra.
  while (renglones.length && (!renglones[renglones.length - 1].trim() || /:\s*$/.test(renglones[renglones.length - 1]))) renglones.pop();
  const completo = renglones.join('\n').trim();
  return completo ? `${completo}\n\n${NOTA_RECORTE}` : NOTA_RECORTE;
}

// Configuración de un agente:
//   sistema, herramientas            instrucciones y definición de herramientas para el modelo
//   ejecutar(nombre, entrada)        ejecuta una herramienta y devuelve un objeto (nunca lanza por entradas inválidas)
//   verificar(texto, resultados)     -> { ok, violaciones, correccion? }  decide si el texto se puede entregar
//   respaldo(resultados, motivo)     texto determinístico si el modelo falla o no cumple las reglas
//   advertencias(resultados)         avisos calculados por código para la usuaria
//   reintentos                       veces que se le pide al modelo corregir su texto antes de usar el respaldo
//   cliente                          función async (cuerpo) => respuesta de la API. Inyectable para pruebas sin gastar saldo.
function crearAgente({
  sistema, herramientas, ejecutar, verificar, respaldo, advertencias = () => [], reintentos = 0, postprocesar = null,
  cliente = null, apiKey = process.env.ANTHROPIC_API_KEY, modelo = process.env.MODELO_IA || MODELO_POR_DEFECTO,
  maxVueltas = 3, maxTokens = 1000, timeoutMs = 30000, fetchImpl
}) {
  const llamar = cliente || (apiKey ? crearClienteHttp({ apiKey, fetchImpl, timeoutMs }) : null);
  if (!llamar) return null; // sin llave: el servidor responde "IA no conectada"

  return async function responder({ mensaje }) {
    const mensajes = [{ role: 'user', content: String(mensaje) }];
    const resultados = [];
    const uso = { entrada: 0, salida: 0, vueltas: 0 };
    let texto = null;
    let cortada = false;
    let verificacion = { ok: false, violaciones: [] };
    let reintentosHechos = 0;

    for (let vuelta = 0; vuelta < maxVueltas + reintentos; vuelta++) {
      const r = await llamar({ model: modelo, max_tokens: maxTokens, system: sistema, tools: herramientas, messages: mensajes });
      uso.vueltas++;
      uso.entrada += (r.usage && r.usage.input_tokens) || 0;
      uso.salida += (r.usage && r.usage.output_tokens) || 0;

      const usos = (r.content || []).filter(b => b.type === 'tool_use');
      if (r.stop_reason === 'tool_use' && usos.length) {
        mensajes.push({ role: 'assistant', content: r.content });
        const respuestas = usos.map(u => {
          const resultado = ejecutar(u.name, u.input);
          resultados.push(resultado);
          return { type: 'tool_result', tool_use_id: u.id, content: acotar(resultado) };
        });
        mensajes.push({ role: 'user', content: respuestas });
        continue;
      }

      texto = textoDe(r.content);
      cortada = false;
      if (texto && r.stop_reason === 'max_tokens') { texto = recortarRespuesta(texto); cortada = true; }
      if (!texto) break;

      // Tras un reintento el modelo a veces comenta su corrección ("mi texto anterior..."): eso no es para la usuaria.
      if (reintentosHechos && postprocesar) texto = postprocesar(texto) || texto;
      verificacion = verificar(texto, resultados);
      if (!verificacion.ok && reintentosHechos < reintentos) {
        // Se le devuelve su propio texto con la corrección exacta que pide el código.
        reintentosHechos++;
        mensajes.push({ role: 'assistant', content: textoPlano(r.content) });
        mensajes.push({ role: 'user', content: verificacion.correccion || 'Tu respuesta no cumple las reglas. Escríbela de nuevo completa respetándolas.' });
        texto = null;
        continue;
      }
      break;
    }

    if (reintentosHechos) uso.reintentos = reintentosHechos;
    const avisos = advertencias(resultados, texto && verificacion.ok ? texto : undefined);
    if (texto && verificacion.ok) return { respuesta: texto, advertencias: avisos, uso: { ...uso, cortada }, respaldo: false };

    // Sin texto del modelo o con texto que incumple las reglas: respaldo determinístico con datos del catálogo.
    const motivo = texto ? (verificacion.motivo || 'incumple_reglas') : 'sin_respuesta';
    return {
      respuesta: respaldo(resultados, motivo, verificacion),
      advertencias: [...avisos, 'Respuesta generada directamente desde el catálogo, sin redacción de IA.'],
      uso, respaldo: true, motivo
    };
  };
}

// Contenido de texto de una respuesta del modelo, para reenviarlo como mensaje de asistente.
function textoPlano(contenido) {
  return (contenido || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim() || '(sin texto)';
}

module.exports = {
  crearAgente, crearClienteHttp, aTextoPlano, textoDe, recortarRespuesta, acotar, error,
  MODELO_POR_DEFECTO, NOTA_RECORTE
};
