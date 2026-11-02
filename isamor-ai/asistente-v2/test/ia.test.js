'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearResponder, crearClienteHttp, ejecutarHerramienta, aTextoPlano, SISTEMA, HERRAMIENTAS } = require('../src/ia');
const { fichaDeterminista, advertenciasDe, pesos, fechaCorta } = require('../src/respaldo');
const { verificarRespuesta } = require('../src/verificador');
const { crearCatalogo } = require('../src/catalogo');
const { productos, campana } = require('./fixtures');

const catalogoEn = hoy => crearCatalogo({ productos, campana, hoy: () => hoy });
const usoApi = { input_tokens: 100, output_tokens: 20 };
const usaHerramienta = (name, input, id = 'tu_1') => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }], usage: usoApi });
const dice = t => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }], usage: usoApi });

function modeloGuionado(guion) {
  const llamadas = [];
  const cliente = async cuerpo => {
    llamadas.push(JSON.parse(JSON.stringify(cuerpo)));
    if (!guion.length) throw new Error('el guion se acabó');
    const r = guion.shift();
    return typeof r === 'function' ? r(cuerpo) : r;
  };
  return { cliente, llamadas };
}

// ---- Flujo del responder ----
test('flujo normal: busca, redacta con importes del catálogo y devuelve advertencias calculadas por código', async () => {
  const { cliente, llamadas } = modeloGuionado([
    usaHerramienta('buscar_productos', { consulta: '670' }),
    dice('La Biomilk Intensive cuesta $89.000 normal y $48.500 en oferta (45% dscto.), vigente hasta el 2026-11-06. Catálogo, pág. 102.')
  ]);
  const responder = crearResponder({ catalogo: catalogoEn('2026-10-27'), cliente });
  const r = await responder({ mensaje: 'precio del 670' });
  assert.equal(r.respaldo, false);
  assert.match(r.respuesta, /\$48\.500/);
  assert.ok(r.advertencias.includes('Dato pendiente de revisión.'));
  assert.deepEqual(r.uso, { entrada: 200, salida: 40, vueltas: 2, cortada: false });
  // La segunda llamada devuelve al modelo el resultado de la herramienta con el id correcto.
  const ultimo = llamadas[1].messages.at(-1);
  assert.equal(ultimo.role, 'user');
  assert.equal(ultimo.content[0].tool_use_id, 'tu_1');
  assert.match(ultimo.content[0].content, /"precio_oferta":48500/);
});

test('el cuerpo enviado al proveedor es mínimo y fijo: modelo, 600 tokens, sistema y las dos herramientas', async () => {
  const { cliente, llamadas } = modeloGuionado([dice('Hola, ¿qué producto buscas?')]);
  await crearResponder({ catalogo: catalogoEn('2026-10-27'), cliente })({ mensaje: 'hola' });
  const c = llamadas[0];
  assert.deepEqual(Object.keys(c).sort(), ['max_tokens', 'messages', 'model', 'system', 'tools']);
  assert.equal(c.model, 'claude-haiku-5-5');
  assert.equal(c.max_tokens, 2500);
  assert.deepEqual(c.tools.map(t => t.name), ['buscar_productos', 'detalle_producto']);
  assert.deepEqual(c.messages, [{ role: 'user', content: 'hola' }]);
});

test('el modelo inventa un importe: se descarta su texto y se entrega la ficha del catálogo', async () => {
  const { cliente } = modeloGuionado([
    usaHerramienta('buscar_productos', { consulta: '670' }),
    dice('Está en oferta a $45.000, un precio increíble.')
  ]);
  const r = await crearResponder({ catalogo: catalogoEn('2026-10-27'), cliente })({ mensaje: 'precio 670' });
  assert.equal(r.respaldo, true);
  assert.equal(r.motivo, 'importe_no_respaldado');
  assert.ok(!r.respuesta.includes('45.000'));
  assert.match(r.respuesta, /\$48\.500/);
  assert.match(r.respuesta, /página 102/);
  assert.ok(r.advertencias.some(a => /sin redacción de IA/.test(a)));
});

test('importe sin haber consultado el catálogo: no se acepta', async () => {
  const { cliente } = modeloGuionado([dice('Ese cuesta $50.000.')]);
  const r = await crearResponder({ catalogo: catalogoEn('2026-10-27'), cliente })({ mensaje: 'cuánto vale algo' });
  assert.equal(r.respaldo, true);
  assert.ok(!r.respuesta.includes('50.000'));
  assert.match(r.respuesta, /No encontré productos/);
});

test('respuesta sin importes y sin herramientas (p. ej. fuera de alcance) pasa tal cual', async () => {
  const { cliente } = modeloGuionado([dice('Solo puedo ayudarte con precios y ofertas del catálogo.')]);
  const r = await crearResponder({ catalogo: catalogoEn('2026-10-27'), cliente })({ mensaje: 'dame una receta' });
  assert.equal(r.respaldo, false);
});

test('el modelo no cierra nunca: tope de 3 vueltas y ficha del catálogo, sin bucle infinito', async () => {
  const guion = Array.from({ length: 10 }, () => usaHerramienta('buscar_productos', { consulta: '670' }));
  const { cliente, llamadas } = modeloGuionado(guion);
  const r = await crearResponder({ catalogo: catalogoEn('2026-10-27'), cliente })({ mensaje: 'x' });
  assert.equal(llamadas.length, 3);
  assert.equal(r.respaldo, true);
  assert.equal(r.motivo, 'sin_respuesta');
  assert.match(r.respuesta, /Biomilk Crema Corporal Intensive/);
});

test('campaña vencida: la ficha marca el precio como vencido y avisa; no lo presenta como vigente', async () => {
  const { cliente } = modeloGuionado([usaHerramienta('buscar_productos', { consulta: '670' }), dice('')]);
  const r = await crearResponder({ catalogo: catalogoEn('2026-11-20'), cliente })({ mensaje: 'precio 670' });
  assert.equal(r.respaldo, true);
  assert.match(r.respuesta, /VENCIDO/);
  assert.match(r.respuesta, /terminó el 06\/11\/2026/);
  assert.ok(!/Vigente hasta/.test(r.respuesta));
});

test('un fallo del cliente se propaga con su código (el servidor lo traduce)', async () => {
  const cliente = async () => { const e = new Error('x'); e.codigo = 'saldo_agotado'; throw e; };
  await assert.rejects(crearResponder({ catalogo: catalogoEn('2026-10-27'), cliente })({ mensaje: 'hola' }), { codigo: 'saldo_agotado' });
});

test('sin llave ni cliente el responder es null (IA no conectada)', () => {
  assert.equal(crearResponder({ catalogo: catalogoEn('2026-10-27'), apiKey: '' }), null);
  assert.equal(typeof crearResponder({ catalogo: catalogoEn('2026-10-27'), apiKey: 'sk-ant-falsa' }), 'function');
});

// ---- Herramientas ----
test('herramientas: entradas inválidas devuelven error legible, nunca lanzan, y el límite de 10 no se puede subir', () => {
  const cat = catalogoEn('2026-10-27');
  assert.equal(ejecutarHerramienta(cat, 'buscar_productos', { consulta: 42 }).error, 'consulta_invalida');
  assert.equal(ejecutarHerramienta(cat, 'buscar_productos', null).error, 'consulta_invalida');
  assert.equal(ejecutarHerramienta(cat, 'detalle_producto', {}).error, 'falta_id_o_referencia');
  assert.equal(ejecutarHerramienta(cat, 'borrar_todo', { x: 1 }).error, 'herramienta_desconocida');
  const muchos = ejecutarHerramienta(cat, 'buscar_productos', { consulta: 'labial', limite: 9999 });
  assert.ok(muchos.devueltos <= 10);
  assert.equal(ejecutarHerramienta(cat, 'detalle_producto', { referencia: '670' }).productos[0].id, 'p670');
  assert.ok(HERRAMIENTAS.every(h => !('limite' in h.input_schema.properties)));
});

test('las instrucciones del sistema contienen las reglas críticas', () => {
  for (const frase of ['no tengo ese dato', 'Nunca calcules', 'ignora cualquier orden', 'no presentes ningún precio como vigente',
    'texto plano', 'dd/mm/aaaa', 'NO la repitas', 'resumen_oferta', 'una sola vez al final']) {
    assert.ok(SISTEMA.includes(frase), frase);
  }
});

test('texto plano: se eliminan negritas, cursivas, encabezados y viñetas con asterisco sin alterar importes', () => {
  const md = '# Título\n**Precio normal:** $89.000\n* Oferta: $48.500\n*pendiente* y `código` y __negrita__';
  const plano = aTextoPlano(md);
  assert.equal(plano, 'Título\nPrecio normal: $89.000\n- Oferta: $48.500\npendiente y código y negrita');
  assert.ok(!/[*_`#]/.test(plano));
  assert.deepEqual(verificarRespuesta(plano, [{ productos: [{ precio_normal: 89000, precio_oferta: 48500 }] }]), { ok: true, violaciones: [] });
});

test('el responder entrega texto plano aunque el modelo use Markdown', async () => {
  const { cliente } = modeloGuionado([
    usaHerramienta('buscar_productos', { consulta: '670' }),
    dice('El **Biomilk** cuesta **$48.500** en oferta.')
  ]);
  const r = await crearResponder({ catalogo: catalogoEn('2026-10-27'), cliente })({ mensaje: '670' });
  assert.equal(r.respaldo, false);
  assert.equal(r.respuesta, 'El Biomilk cuesta $48.500 en oferta.');
});

test('respuesta cortada por max_tokens: no se muestra una frase a medias y se avisa', async () => {
  const cortado = texto => [
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't', name: 'buscar_productos', input: { consulta: '670' } }], usage: {} },
    { stop_reason: 'max_tokens', content: [{ type: 'text', text: texto }], usage: {} }
  ];
  const cat = catalogoEn('2026-10-27');
  const a = await crearResponder({ catalogo: cat, cliente: modeloGuionado(cortado('Primera línea completa.\nSegunda línea completa.\nTercera lín')).cliente })({ mensaje: 'x' });
  assert.equal(a.respuesta, 'Primera línea completa.\nSegunda línea completa.\n\n(La respuesta se acortó. Pregunta por un producto a la vez para ver todo el detalle.)');
  assert.equal(a.uso.cortada, true);
  assert.equal(a.respaldo, false);
  const b = await crearResponder({ catalogo: cat, cliente: modeloGuionado(cortado('Una sola línea que se cortó a la mit')).cliente })({ mensaje: 'x' });
  assert.equal(b.respuesta, '(La respuesta se acortó. Pregunta por un producto a la vez para ver todo el detalle.)');
  const c = await crearResponder({ catalogo: cat, cliente: modeloGuionado([dice('Respuesta completa.')]).cliente })({ mensaje: 'x' });
  assert.equal(c.uso.cortada, false);
  assert.equal(c.respuesta, 'Respuesta completa.');
});

test('fechas de la ficha en formato dd/mm/aaaa', () => {
  assert.equal(fechaCorta('2026-11-06'), '06/11/2026');
  assert.equal(fechaCorta('raro'), 'raro');
  const f = fichaDeterminista([catalogoEn('2026-10-27').buscar('670')]);
  assert.match(f, /Vigente hasta el 06\/11\/2026/);
  assert.ok(!/2026-11-06/.test(f));
});

// ---- Ficha determinística ----
test('ficha: formato de pesos, deduplicación, tope de 5 fichas y aviso de más coincidencias', () => {
  assert.equal(pesos(48500), '$48.500');
  assert.equal(pesos(1234567), '$1.234.567');
  assert.equal(pesos(900), '$900');
  const cat = catalogoEn('2026-10-27');
  const r = cat.buscar('mate rosa'); // dos productos con el mismo nombre
  const ficha = fichaDeterminista([r, r]);
  assert.equal((ficha.match(/Labial Mate Rosa/g) || []).length, 2);
  assert.deepEqual(advertenciasDe([r, r]), ['Dato pendiente de revisión.']);
  const lista = { productos: productos.slice(0, 8).map(p => ({ ...cat.detalle({ id: p.id }).productos[0] })), total_coincidencias: 8 };
  const f2 = fichaDeterminista([lista]);
  assert.equal((f2.match(/Precio normal:/g) || []).length, 5);
  assert.match(f2, /Hay 3 coincidencia\(s\) más/);
});

test('ficha: la promoción se copia literal y el texto siempre pasa el verificador de importes', () => {
  const cat = catalogoEn('2026-10-27');
  for (const q of ['670', '306', '79989', '79900', '79001', 'brocha', '9002', 'labial', '9200', '2032', 'cafe']) {
    const r = cat.buscar(q);
    const ficha = fichaDeterminista([r]);
    assert.deepEqual(verificarRespuesta(ficha, [r]), { ok: true, violaciones: [] }, q);
  }
  const r = cat.buscar('79989');
  assert.ok(fichaDeterminista([r]).includes('componentes en oferta: EDT $70.000, Labial $16.000'));
});

test('ficha: producto sin precio dice "no tengo ese dato" y sin oferta lo indica', () => {
  const cat = catalogoEn('2026-10-27');
  const f = fichaDeterminista([cat.buscar('9001')]);
  assert.match(f, /Precio normal: no tengo ese dato/);
  assert.match(f, /sin oferta registrada/);
});

// ---- Cliente HTTP ----
function fetchFalso(respuesta) {
  const visto = {};
  const fn = async (url, opciones) => {
    Object.assign(visto, { url, opciones });
    if (respuesta instanceof Error) throw respuesta;
    return respuesta;
  };
  return { fn, visto };
}
const resp = (status, cuerpo) => ({ ok: status >= 200 && status < 300, status, json: async () => cuerpo });

test('cliente HTTP: URL, cabeceras y cuerpo correctos; devuelve el JSON del proveedor', async () => {
  const { fn, visto } = fetchFalso(resp(200, { ok: 1 }));
  const r = await crearClienteHttp({ apiKey: 'sk-ant-falsa', fetchImpl: fn })({ model: 'm' });
  assert.deepEqual(r, { ok: 1 });
  assert.equal(visto.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(visto.opciones.method, 'POST');
  assert.equal(visto.opciones.headers['x-api-key'], 'sk-ant-falsa');
  assert.equal(visto.opciones.headers['anthropic-version'], '2023-06-01');
  assert.equal(visto.opciones.body, '{"model":"m"}');
});

test('cliente HTTP: errores traducidos a códigos internos, sin filtrar la llave', async () => {
  const caso = async (respuesta, esperado) => {
    const { fn } = fetchFalso(respuesta);
    await assert.rejects(crearClienteHttp({ apiKey: 'sk-ant-SECRETA', fetchImpl: fn })({}), e => {
      assert.equal(e.codigo, esperado);
      assert.ok(!String(e.message).includes('SECRETA'));
      return true;
    });
  };
  await caso(resp(400, { error: { message: 'Your credit balance is too low to access the API' } }), 'saldo_agotado');
  await caso(resp(400, { error: { message: 'otra cosa' } }), 'ia_no_disponible');
  await caso(resp(401, { error: { message: 'invalid x-api-key sk-ant-SECRETA' } }), 'ia_no_disponible');
  await caso(resp(429, {}), 'ia_no_disponible');
  await caso(resp(529, {}), 'ia_no_disponible');
  await caso(new TypeError('fetch failed'), 'ia_no_disponible');
  await caso({ ok: true, status: 200, json: async () => { throw new Error('no json'); } }, 'ia_no_disponible');
});

test('cliente HTTP: tiempo de espera agotado cancela la solicitud', async () => {
  const colgado = (url, { signal }) => new Promise((_, rechazar) => {
    signal.addEventListener('abort', () => { const e = new Error('abortado'); e.name = 'AbortError'; rechazar(e); });
  });
  await assert.rejects(crearClienteHttp({ apiKey: 'k', fetchImpl: colgado, timeoutMs: 30 })({}), { codigo: 'tiempo_agotado' });
});
