'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearResponderContenido, verificarContenido, terminosProhibidos, SISTEMA_CONTENIDO } = require('../src/contenido');
const { crearCatalogo } = require('../src/catalogo');
const { ejecutarHerramienta } = require('../src/ia');
const { productos, campana } = require('./fixtures');

const catalogoEn = hoy => crearCatalogo({ productos, campana, hoy: () => hoy });
const usos = {};
const pide = (consulta, id = 't1') => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name: 'buscar_productos', input: { consulta } }], usage: usos });
const dice = t => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }], usage: usos });

function modelo(guion) {
  const llamadas = [];
  return { llamadas, cliente: async cuerpo => { llamadas.push(JSON.parse(JSON.stringify(cuerpo))); return guion.shift(); } };
}
const resultadosDe = (hoy, consulta) => [ejecutarHerramienta(catalogoEn(hoy), 'buscar_productos', { consulta })];

// ---- Verificador de contenido ----
test('texto válido: precio del catálogo con su vigencia, descripción y hashtags', () => {
  const r = resultadosDe('2026-10-27', '5104');
  const texto = 'DESCRIPCIÓN PARA REDES: Un delineador para tu mirada. Pides 1 y recibes 2 por $56.000, vigente hasta 06/11/2026.\nHASHTAGS: #Yanbal #Maquillaje';
  assert.deepEqual(verificarContenido(texto, r).violaciones, []);
  assert.equal(verificarContenido(texto, r).ok, true);
});

test('importes: un precio inventado o calculado se rechaza', () => {
  const r = resultadosDe('2026-10-27', '5104');
  const v = verificarContenido('Cada uno sale a $28.000, vigente hasta 06/11/2026.', r);
  assert.equal(v.ok, false);
  assert.equal(v.violaciones[0].tipo, 'importe_no_respaldado');
  assert.match(v.correccion, /\$28\.000/);
});

test('términos prohibidos: se detectan sin importar tildes ni mayúsculas', () => {
  const casos = [
    'Un producto MILAGROSO', 'Una crema que cura la piel', 'efecto curativo', 'resultados garantizados', 'es 100% efectivo',
    'elimina las arrugas', 'elimina manchas', 'ayuda a adelgazar', 'te hace bajar de peso', 'resultados inmediatos',
    'sin efectos secundarios', 'Sanar tu piel'
  ];
  for (const c of casos) assert.ok(terminosProhibidos(c).length > 0, c);
});

test('términos prohibidos: no hay falsos positivos con palabras parecidas', () => {
  const sanos = ['procura cuidar tu piel', 'una pantalla curva', 'piel sana y radiante', 'secura', 'cuidado personal', 'sana competencia',
    'un regalo único', 'la curaduría del catálogo', 'aprovecha la oferta'];
  for (const s of sanos) assert.deepEqual(terminosProhibidos(s), [], s);
});

test('vigencia: la fecha va con la oferta, no pegada al precio normal', () => {
  const r = resultadosDe('2026-10-27', 'Biomilk');
  const mal = ['Precio normal: $89.000, vigente hasta 06/11/2026. Oferta: $48.500.', 'Normal $89.000 (vigente hasta 06/11/2026) y oferta $48.500.',
    'Precio normal: $89.000, hasta 06/11/2026'];
  for (const t of mal) assert.ok(verificarContenido(t, r).violaciones.some(v => v.tipo === 'vigencia_en_precio_normal'), t);
  const bien = ['Precio normal: $89.000\nOferta: $48.500, vigente hasta 06/11/2026.', 'Antes $89.000 y ahora $48.500 (vigente hasta 06/11/2026).'];
  for (const t of bien) assert.deepEqual(verificarContenido(t, r).violaciones, [], t);
  assert.match(verificarContenido(mal[0], r).correccion, /solo junto al precio de oferta/);
  assert.match(SISTEMA_CONTENIDO, /vigencia[^.]*es de la OFERTA/);
});

test('alfabeto: letras cirílicas o griegas disfrazadas de latinas se rechazan', () => {
  const r = resultadosDe('2026-10-27', 'Biomilk');
  const cirilico = 'HASHTAGS: #Yanbal #Eleg\u0430nciaCotidiana';
  const v = verificarContenido(cirilico, r);
  assert.ok(v.violaciones.some(x => x.tipo === 'caracteres_extranos'));
  assert.match(v.correccion, /otro alfabeto/);
  assert.ok(verificarContenido('Eleg\u03B1nte', r).violaciones.some(x => x.tipo === 'caracteres_extranos'));
  assert.deepEqual(verificarContenido('HASHTAGS: #Yanbal #ElegánciaCotidiana #Año ¡Hola! 😊 🎁', r).violaciones, []);
});

test('vigencia: hay precios sin fecha -> se exige; con campaña vencida -> se prohíben los precios', () => {
  const vigente = resultadosDe('2026-10-27', '5104');
  assert.equal(verificarContenido('Llévalo por $56.000.', vigente).violaciones[0].tipo, 'falta_vigencia');
  const vencida = resultadosDe('2026-11-20', '5104');
  const v = verificarContenido('Llévalo por $56.000 hasta 06/11/2026.', vencida);
  assert.equal(v.violaciones[0].tipo, 'precios_sin_vigencia');
  assert.equal(verificarContenido('DESCRIPCIÓN: Un detalle para consentirte. HASHTAGS: #Yanbal', vencida).ok, true);
  const sinConfigurar = [ejecutarHerramienta(crearCatalogo({ productos, campana: null, hoy: () => '2026-10-27' }), 'buscar_productos', { consulta: '5104' })];
  assert.equal(verificarContenido('Por $56.000 hasta 06/11/2026', sinConfigurar).violaciones[0].tipo, 'precios_sin_vigencia');
});

test('varias violaciones juntas: la corrección las menciona todas', () => {
  const r = resultadosDe('2026-10-27', '5104');
  const v = verificarContenido('Milagroso a $1.000.', r);
  assert.deepEqual(v.violaciones.map(x => x.tipo).sort(), ['falta_vigencia', 'importe_no_respaldado', 'terminos_prohibidos'].sort());
  assert.match(v.correccion, /milagro/);
  assert.match(v.correccion, /dd\/mm\/aaaa/);
});

// ---- Agente de contenido ----
test('instrucciones y parámetros del agente de contenido', async () => {
  const { cliente, llamadas } = modelo([dice('Hola, ¿qué producto quieres promocionar?')]);
  await crearResponderContenido({ catalogo: catalogoEn('2026-10-27'), cliente })({ mensaje: 'hola' });
  const c = llamadas[0];
  assert.equal(c.max_tokens, 4500);
  for (const frase of ['hashtags', 'dd/mm/aaaa', 'Prohibido prometer curas, milagros', 'No inventes ingredientes', 'NO escribas precios', 'tipo_promocion "2x1"']) {
    assert.ok(SISTEMA_CONTENIDO.includes(frase), frase);
  }
  assert.equal(c.system, SISTEMA_CONTENIDO);
  assert.deepEqual(c.tools.map(t => t.name), ['buscar_productos', 'detalle_producto']);
});

test('flujo correcto: el texto con precio y vigencia se entrega a la primera', async () => {
  const texto = 'GUION REEL (15 s): Abre con el delineador.\nDESCRIPCIÓN PARA REDES: Pides 1 y recibes 2 por $56.000, vigente hasta 06/11/2026.\nHASHTAGS: #Yanbal #Delineador';
  const { cliente, llamadas } = modelo([pide('5104'), dice(texto)]);
  const r = await crearResponderContenido({ catalogo: catalogoEn('2026-10-27'), cliente })({ mensaje: 'Reel del 5104' });
  assert.equal(r.respaldo, false);
  assert.equal(r.respuesta, texto);
  assert.equal(r.uso.reintentos, undefined);
  assert.equal(llamadas.length, 2);
});

test('el modelo escribe "milagroso": el código le pide corregir y se entrega la versión corregida', async () => {
  const { cliente, llamadas } = modelo([
    pide('5104'),
    dice('Un delineador milagroso por $56.000, vigente hasta 06/11/2026. #Yanbal'),
    dice('Un delineador para tu mirada por $56.000, vigente hasta 06/11/2026. #Yanbal')
  ]);
  const r = await crearResponderContenido({ catalogo: catalogoEn('2026-10-27'), cliente })({ mensaje: 'texto del 5104' });
  assert.equal(r.respaldo, false);
  assert.ok(!/milagr/i.test(r.respuesta));
  assert.equal(r.uso.reintentos, 1);
  const tercera = llamadas[2].messages;
  assert.match(tercera.at(-1).content, /No uses estas expresiones/);
  assert.equal(tercera.at(-2).role, 'assistant');
  assert.match(tercera.at(-2).content, /milagroso/); // se le devuelve su propio texto para que lo corrija
});

test('si el modelo insiste en incumplir, nunca se entrega su texto: sale la ficha del catálogo con el motivo', async () => {
  const { cliente } = modelo([
    pide('5104'),
    dice('Es 100% efectivo y garantizado. #Yanbal'),
    dice('Sigue siendo garantizado y milagroso. #Yanbal')
  ]);
  const r = await crearResponderContenido({ catalogo: catalogoEn('2026-10-27'), cliente })({ mensaje: 'texto del 5104' });
  assert.equal(r.respaldo, true);
  assert.equal(r.motivo, 'terminos_prohibidos');
  assert.ok(!/garantiz|milagr|efectivo/i.test(r.respuesta));
  assert.match(r.respuesta, /^No puedo escribir ese texto: la marca no permite promesas de resultados/);
  assert.ok(!/Precio normal|Biomilk|Hay \d+ coincidencia/.test(r.respuesta), 'un problema de marca no vuelca listas de productos');
  assert.ok(r.advertencias.some(a => /sin redacción de IA/.test(a)));
});

test('campaña vencida: si el modelo escribe precios, se le exige quitarlos', async () => {
  const { cliente, llamadas } = modelo([
    pide('5104'),
    dice('Llévalo por $56.000, vigente hasta 06/11/2026. #Yanbal'),
    dice('Un delineador para tu mirada. Consulta disponibilidad con tu asesora. #Yanbal')
  ]);
  const r = await crearResponderContenido({ catalogo: catalogoEn('2026-11-20'), cliente })({ mensaje: 'texto del 5104' });
  assert.equal(r.respaldo, false);
  assert.ok(!r.respuesta.includes('$'));
  assert.match(llamadas[2].messages.at(-1).content, /no escribas ningún precio/);
});

test('sin consultar el catálogo, un precio en el texto es un importe no respaldado', async () => {
  const { cliente } = modelo([dice('Todo a $10.000 hasta 06/11/2026'), dice('Mira nuestras ofertas. #Yanbal')]);
  const r = await crearResponderContenido({ catalogo: catalogoEn('2026-10-27'), cliente })({ mensaje: 'algo' });
  assert.equal(r.respaldo, false);
  assert.equal(r.respuesta, 'Mira nuestras ofertas. #Yanbal');
  assert.equal(r.uso.reintentos, 1);
});

test('sin llave ni cliente el agente de contenido es null', () => {
  assert.equal(crearResponderContenido({ catalogo: catalogoEn('2026-10-27'), apiKey: '' }), null);
});

// ---- Afirmaciones no documentadas y código de campaña ----
const { afirmacionesNoDocumentadas } = require('../src/contenido');

test('afirmaciones no documentadas: duración, resistencia, formulación y "no se corre" se rechazan', () => {
  const r = resultadosDe('2026-10-27', '5104');
  const casos = ['Un delineador de larga duración', 'dura todo el día', 'dura 12 horas', 'resistente al agua', 'a prueba de agua', 'no se corre ni se mancha',
    'dermatológicamente probado', 'es hipoalergénico', '100% natural', 'vegano y libre de parabenos', 'cruelty free'];
  for (const c of casos) assert.ok(afirmacionesNoDocumentadas(c, r).length > 0, c);
  const v = verificarContenido('Un delineador de larga duración. #Yanbal', r);
  assert.equal(v.ok, false);
  assert.equal(v.violaciones[0].tipo, 'afirmaciones_no_documentadas');
  assert.match(v.correccion, /duración/);
});

test('afirmaciones no documentadas: se permiten si el propio dato del producto lo dice, y no hay falsos positivos', () => {
  const documentado = [{ campana: { estado: 'vigente' }, productos: [{ nombre: 'Máscara resistente al agua', promocion: '' }] }];
  assert.deepEqual(afirmacionesNoDocumentadas('Una máscara resistente al agua', documentado), []);
  assert.deepEqual(afirmacionesNoDocumentadas('Una máscara resistente al agua', resultadosDe('2026-10-27', '5104')), ['resistencia al agua']);
  for (const sano of ['Dibuja tu mirada', 'un detalle para consentirte', 'tu rutina diaria', 'ideal para regalar', 'durante la campaña', 'duración de la oferta: hasta 06/11/2026'.replace('duración', 'vigencia')]) {
    assert.deepEqual(afirmacionesNoDocumentadas(sano, resultadosDe('2026-10-27', '5104')), [], sano);
  }
});

test('código de campaña: C11 o C12 en el texto o en un hashtag se rechaza (caduca); la fecha de vigencia sí vale', () => {
  const r = resultadosDe('2026-10-27', '5104');
  for (const texto of ['#CampañaC11 #Yanbal', 'Aprovecha la C12', 'campaña c11']) {
    assert.ok(verificarContenido(texto, r).violaciones.some(v => v.tipo === 'codigo_de_campana'), texto);
  }
  assert.equal(verificarContenido('Oferta vigente hasta 06/11/2026 #Yanbal', r).ok, true);
  assert.equal(verificarContenido('Referencia 5104 #Yanbal #Maquillaje', r).ok, true);
});

test('el texto del guion real de la prueba: lo único que falla es #CampañaC11, y se le pide corregirlo', async () => {
  const conCodigo = 'DESCRIPCIÓN PARA REDES: Dibuja tu mirada. Pides 1 y recibes 2 por $56.000, vigente hasta 06/11/2026.\nHASHTAGS: #Yanbal #Maquillaje #CampañaC11';
  const corregido = conCodigo.replace(' #CampañaC11', '');
  const { cliente, llamadas } = modelo([pide('5104'), dice(conCodigo), dice(corregido)]);
  const r = await crearResponderContenido({ catalogo: catalogoEn('2026-10-27'), cliente })({ mensaje: 'Reel del 5104' });
  assert.equal(r.respaldo, false);
  assert.equal(r.respuesta, corregido);
  assert.match(llamadas[2].messages.at(-1).content, /Quita el código de la campaña/);
});

test('las instrucciones cubren las nuevas reglas', () => {
  for (const frase of ['No afirmes desempeño ni características que el catálogo no documenta', 'No escribas el código de la campaña', 'No agregues notas sobre la revisión de los datos']) {
    assert.ok(SISTEMA_CONTENIDO.includes(frase), frase);
  }
});

// ---- Respaldo según el motivo, recorte y escasez (casos vistos en la prueba real) ----
test('respaldo por precios inventados: sí muestra los datos del catálogo, sin el encabezado duplicado', async () => {
  const { cliente } = modelo([pide('5104'), dice('Cada uno a $28.000 hasta 06/11/2026'), dice('Sale a $30.000 hasta 06/11/2026')]);
  const r = await crearResponderContenido({ catalogo: catalogoEn('2026-10-27'), cliente })({ mensaje: 'texto del 5104' });
  assert.equal(r.respaldo, true);
  assert.equal(r.motivo, 'importe_no_respaldado');
  assert.match(r.respuesta, /^No pude generar un texto con precios correctos y vigentes/);
  assert.match(r.respuesta, /Datos del catálogo para que redactes tú:\n\nDelineador Plumón Tattoo/);
  assert.match(r.respuesta, /Precio normal: \$56\.000/);
  assert.equal((r.respuesta.match(/Estos son los datos del catálogo/g) || []).length, 0);
  assert.ok(!/28\.000|30\.000/.test(r.respuesta));
});

test('respaldo solo por código de campaña: mensaje breve y sin listas', async () => {
  const { cliente } = modelo([pide('5104'), dice('Oferta #C11 $56.000 hasta 06/11/2026'), dice('Otra vez C11 por $56.000 hasta 06/11/2026')]);
  const r = await crearResponderContenido({ catalogo: catalogoEn('2026-10-27'), cliente })({ mensaje: 'x' });
  assert.equal(r.respaldo, true);
  assert.match(r.respuesta, /sin el código de la campaña/);
  assert.ok(!/Delineador/.test(r.respuesta));
});

test('petición de milagros: si el modelo se niega mencionando la palabra prohibida, se le pide reformular y entrega una negativa limpia', async () => {
  const { cliente, llamadas } = modelo([
    dice('No puedo escribir que la crema es milagrosa ni que cura arrugas.'),
    dice('La marca no permite promesas de resultados. Dime el producto y preparo una versión con descripción y hashtags. #Yanbal')
  ]);
  const r = await crearResponderContenido({ catalogo: catalogoEn('2026-10-27'), cliente })({ mensaje: 'texto de crema milagrosa que cura arrugas' });
  assert.equal(r.respaldo, false);
  assert.ok(!/milagr|cura/i.test(r.respuesta));
  assert.match(r.respuesta, /no permite promesas de resultados/);
  assert.match(llamadas[1].messages.at(-1).content, /No uses estas expresiones/);
});

test('escasez: "se acaba", "últimas unidades" o "stock limitado" se rechazan salvo que el dato del producto lo diga', () => {
  const r = resultadosDe('2026-10-27', '5104');
  for (const t of ['Cómpralo antes de que se acabe la promo', 'últimas unidades', 'stock limitado', 'quedan pocos', 'hasta agotar existencias']) {
    assert.ok(afirmacionesNoDocumentadas(t, r).includes('escasez / existencias'), t);
  }
  const documentado = [{ productos: [{ nombre: 'Material promocional', promocion: 'Material promocional limitado hasta agotar existencias' }] }];
  assert.deepEqual(afirmacionesNoDocumentadas('Entrega hasta agotar existencias', documentado), []);
  for (const sano of ['aprovecha la promo hasta 06/11/2026', 'no se acaba tu estilo'.replace('no se acaba', 'siempre brilla'), 'agotar tus ganas de brillar'.replace('agotar', 'consentir')]) {
    assert.deepEqual(afirmacionesNoDocumentadas(sano, r), [], sano);
  }
});

test('las instrucciones cubren la negativa, la brevedad de las variantes y la escasez', () => {
  for (const frase of ['NO redactes ese texto', 'no repitas las palabras prohibidas', 'máximo 60 palabras', 'No insinúes escasez ni urgencia por existencias', 'dilo en una frase y ofrece cambiarlo']) {
    assert.ok(SISTEMA_CONTENIDO.includes(frase), frase);
  }
});

// ---- Fuga del reintento, avisos explicativos y reservas (segunda prueba real) ----
const { limpiarMeta } = require('../src/contenido');
const { advertenciasDe } = require('../src/respaldo');

test('limpiarMeta: quita el comentario sobre la corrección que el modelo escribió al inicio (texto real de la prueba)', () => {
  const real = 'Mi texto anterior no contenía esas palabras, pero aquí tienes una versión completa que tampoco las usa:\n\nTEXTO PARA WHATSAPP:\nHola, te comparto un detalle.\n\nHASHTAGS: #Yanbal';
  assert.equal(limpiarMeta(real), 'TEXTO PARA WHATSAPP:\nHola, te comparto un detalle.\n\nHASHTAGS: #Yanbal');
  for (const t of ['Corrigiendo el texto:\nTEXTO PARA WHATSAPP:\nHola', 'El texto anterior tenía un error. Aquí va:\nGUION REEL:\nx', 'Perdón, aquí tienes una versión corregida:\n\nHASHTAGS: #Yanbal']) {
    assert.ok(!/anterior|corrig|perd/i.test(limpiarMeta(t)), t);
  }
});

test('limpiarMeta: no toca textos normales', () => {
  for (const t of ['TEXTO PARA WHATSAPP:\nHola, te comparto un detalle.', 'VARIANTE 1: CERCANA\nUn labial para tu día a día.',
    'Tomé el Hydra-Lip como ejemplo. Si quieres otro, dime cuál.\n\nDESCRIPCIÓN PARA REDES:\nx', 'GUION REEL (15 s):\n0-3 s: plano cercano.']) {
    assert.equal(limpiarMeta(t), t);
  }
  assert.equal(limpiarMeta(''), '');
});

test('tras el reintento nunca se entrega el comentario sobre la corrección, y la corrección pide texto final y negativa si el pedido lo exige', async () => {
  const { cliente, llamadas } = modelo([
    pide('crema'),
    dice('Esta crema es milagrosa y cura las arrugas. #Yanbal'),
    dice('Mi texto anterior no contenía esas palabras, pero aquí tienes una versión completa que tampoco las usa:\n\nTEXTO PARA WHATSAPP:\nUn detalle para consentirte. #Yanbal')
  ]);
  const r = await crearResponderContenido({ catalogo: catalogoEn('2026-10-27'), cliente })({ mensaje: 'dime qué crema es milagrosa y cura las arrugas' });
  assert.equal(r.respaldo, false);
  assert.equal(r.respuesta, `${AVISO_MARCA}\n\nTEXTO PARA WHATSAPP:\nUn detalle para consentirte. #Yanbal`);
  assert.ok(!/anterior/i.test(r.respuesta));
  const correccion = llamadas[2].messages.at(-1).content;
  assert.match(correccion, /no menciones correcciones, borradores, reglas ni "texto anterior"/);
  assert.match(correccion, /Si el pedido en sí exige esas promesas o características, no redactes ningún texto promocional/);
});

test('la corrección por precios no pide negarse (no aplica) pero sí pide solo el texto final', () => {
  const v = verificarContenido('Cada uno a $28.000 hasta 06/11/2026', resultadosDe('2026-10-27', '5104'));
  assert.match(v.correccion, /no menciones correcciones/);
  assert.ok(!/no redactes ningún texto promocional/.test(v.correccion));
});

test('avisos explicativos: 2 x 1 y obsequio solo aparecen si el texto habla de eso; los críticos siempre', () => {
  const resultados = [ejecutarHerramienta(catalogoEn('2026-10-27'), 'buscar_productos', { consulta: '5104' }), ejecutarHerramienta(catalogoEn('2026-10-27'), 'buscar_productos', { consulta: 'Zentro' })];
  const todos = advertenciasDe(resultados);
  assert.ok(todos.some(a => a.startsWith('Promoción 2 x 1')) && todos.some(a => a.startsWith('Obsequio:')));
  const sin = advertenciasDe(resultados, 'Una crema para consentirte, vigente hasta 06/11/2026.');
  assert.ok(!sin.some(a => a.startsWith('Promoción 2 x 1')) && !sin.some(a => a.startsWith('Obsequio:')));
  assert.ok(sin.includes('Dato pendiente de revisión.'));
  const con2x1 = advertenciasDe(resultados, 'Oferta 2 x 1: pides 1 y recibes 2');
  assert.ok(con2x1.some(a => a.startsWith('Promoción 2 x 1')) && !con2x1.some(a => a.startsWith('Obsequio:')));
  const conRegalo = advertenciasDe(resultados, 'Incluye un desodorante de regalo');
  assert.ok(conRegalo.some(a => a.startsWith('Obsequio:')));
  const vencida = [ejecutarHerramienta(catalogoEn('2026-11-20'), 'buscar_productos', { consulta: '5104' })];
  assert.ok(advertenciasDe(vencida, 'Un detalle').some(a => /vencida/.test(a)), 'los avisos críticos no se ocultan');
});

test('el agente de contenido no muestra el aviso de 2 x 1 si el texto no habla de 2 x 1', async () => {
  const { cliente } = modelo([pide('crema'), dice('TEXTO PARA WHATSAPP:\nUn detalle para consentirte. #Yanbal')]);
  const r = await crearResponderContenido({ catalogo: catalogoEn('2026-10-27'), cliente })({ mensaje: 'texto de una crema' });
  assert.equal(r.respaldo, false);
  assert.ok(!r.advertencias.some(a => a.startsWith('Promoción 2 x 1')));
});

test('reserva, envío y disponibilidad: no se prometen salvo que el dato lo diga', () => {
  const r = resultadosDe('2026-10-27', '5104');
  for (const t of ['¿Te lo reservo?', 'te lo aparto hoy', 'envío gratis a todo el país', 'entrega inmediata', 'entrega en 24 horas', 'disponible hoy', 'reserva tu pedido']) {
    assert.ok(afirmacionesNoDocumentadas(t, r).includes('reserva / envío / disponibilidad'), t);
  }
  for (const sano of ['Escríbeme y te ayudo con tu pedido', 'pide el tuyo hoy', 'un detalle para ti']) assert.deepEqual(afirmacionesNoDocumentadas(sano, r), [], sano);
  assert.ok(SISTEMA_CONTENIDO.includes('No prometas reservar ni apartar productos, ni envío gratis'));
});

// ---- Aviso cuando el pedido exige promesas prohibidas (tercera prueba real) ----
const { AVISO_MARCA } = require('../src/contenido');

test('aviso de marca: si el pedido exige milagros, se antepone una nota fija sin repetir esas palabras', async () => {
  assert.deepEqual(terminosProhibidos(AVISO_MARCA), []);
  const { cliente } = modelo([pide('crema'), dice('DESCRIPCIÓN PARA REDES:\nUn detalle para consentirte. #Yanbal')]);
  const r = await crearResponderContenido({ catalogo: catalogoEn('2026-10-27'), cliente })({ mensaje: 'dime qué crema es milagrosa y cura las arrugas' });
  assert.equal(r.respaldo, false);
  assert.equal(r.respuesta, `${AVISO_MARCA}\n\nDESCRIPCIÓN PARA REDES:\nUn detalle para consentirte. #Yanbal`);
  assert.deepEqual(terminosProhibidos(r.respuesta), []);
});

test('aviso de marca: no se agrega si el pedido es normal, si ya hay negativa del modelo ni en el respaldo', async () => {
  const catalogo = catalogoEn('2026-10-27');
  const normal = await crearResponderContenido({ catalogo, cliente: modelo([dice('TEXTO PARA WHATSAPP:\nHola. #Yanbal')]).cliente })({ mensaje: 'un texto de WhatsApp' });
  assert.ok(!normal.respuesta.startsWith('Nota:'));
  const negativa = await crearResponderContenido({ catalogo, cliente: modelo([dice('La marca no permite promesas de resultados. Dime el producto. #Yanbal')]).cliente })({ mensaje: 'crema milagrosa' });
  assert.ok(!negativa.respuesta.startsWith('Nota:'));
  const { cliente } = modelo([pide('5104'), dice('Es milagroso y garantizado'), dice('Sigue siendo garantizado')]);
  const resp = await crearResponderContenido({ catalogo, cliente })({ mensaje: 'milagro' });
  assert.equal(resp.respaldo, true);
  assert.ok(!resp.respuesta.startsWith('Nota:'));
});

test('sin llave el agente de contenido envuelto sigue siendo null', () => {
  assert.equal(crearResponderContenido({ catalogo: catalogoEn('2026-10-27'), apiKey: '' }), null);
});
