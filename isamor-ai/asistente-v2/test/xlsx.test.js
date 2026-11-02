'use strict';
// Conversor del Excel del artefacto de precios al JSON consolidado. Los .xlsx de prueba se arman aquí mismo (ZIP + XML),
// con la estructura que escribe ExcelJS (textos compartidos, celdas vacías omitidas, flujo comprimido).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');
const { leerLibro, leerZip, convertir, ErrorXlsx } = require('../scripts/xlsx-a-consolidado');

// ---- Escritor mínimo de .xlsx ----
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(archivos, comprimir = true) {
  const locales = [], centrales = [];
  let desplazamiento = 0;
  for (const [nombre, contenido] of Object.entries(archivos)) {
    const datos = Buffer.from(contenido, 'utf8');
    const cuerpo = comprimir ? zlib.deflateRawSync(datos) : datos;
    const nom = Buffer.from(nombre);
    const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4); l.writeUInt16LE(comprimir ? 8 : 0, 8);
    l.writeUInt32LE(crc32(datos), 14); l.writeUInt32LE(cuerpo.length, 18); l.writeUInt32LE(datos.length, 22); l.writeUInt16LE(nom.length, 26);
    locales.push(l, nom, cuerpo);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(comprimir ? 8 : 0, 10);
    c.writeUInt32LE(crc32(datos), 16); c.writeUInt32LE(cuerpo.length, 20); c.writeUInt32LE(datos.length, 24); c.writeUInt16LE(nom.length, 28);
    c.writeUInt32LE(desplazamiento, 42);
    centrales.push(c, nom);
    desplazamiento += 30 + nom.length + cuerpo.length;
  }
  const cd = Buffer.concat(centrales);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(Object.keys(archivos).length, 8); fin.writeUInt16LE(Object.keys(archivos).length, 10);
  fin.writeUInt32LE(cd.length, 12); fin.writeUInt32LE(desplazamiento, 16);
  return Buffer.concat([...locales, cd, fin]);
}
const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const letra = i => String.fromCharCode(65 + i);

// hojas: { nombre: [[celdas...], ...] }. null/undefined = celda vacía (se omite, como hace ExcelJS).
function xlsx(hojas, { comprimir = true, textoEnLinea = false } = {}) {
  const compartidas = [];
  const idx = t => { let i = compartidas.indexOf(t); if (i < 0) { compartidas.push(t); i = compartidas.length - 1; } return i; };
  const nombres = Object.keys(hojas);
  const archivos = {};
  nombres.forEach((nombre, h) => {
    const filas = hojas[nombre].map((fila, r) => {
      const celdas = fila.map((v, c) => {
        if (v === null || v === undefined) return '';
        const ref = `${letra(c)}${r + 1}`;
        if (typeof v === 'number') return `<c r="${ref}" s="4"><v>${v}</v></c>`;
        return textoEnLinea ? `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>` : `<c r="${ref}" s="1" t="s"><v>${idx(v)}</v></c>`;
      }).join('');
      return `<row r="${r + 1}">${celdas}</row>`;
    }).join('');
    archivos[`xl/worksheets/sheet${h + 1}.xml`] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${filas}</sheetData></worksheet>`;
  });
  archivos['xl/workbook.xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${
    nombres.map((n, h) => `<sheet name="${esc(n)}" sheetId="${h + 1}" r:id="rId${h + 1}"/>`).join('')}</sheets></workbook>`;
  archivos['xl/_rels/workbook.xml.rels'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${
    nombres.map((n, h) => `<Relationship Id="rId${h + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${h + 1}.xml"/>`).join('')}</Relationships>`;
  if (!textoEnLinea) archivos['xl/sharedStrings.xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${compartidas.length}" uniqueCount="${compartidas.length}">${
    compartidas.map(t => `<si><t xml:space="preserve">${esc(t)}</t></si>`).join('')}</sst>`;
  return zip(archivos, comprimir);
}

const ENC_P = ['Nombre del producto', 'Código', 'Categoría', 'Precio oferta COP', 'Precio normal COP', 'Presentación', 'Página PDF', 'Promoción / condición', 'Estado / observaciones'];
const ENC_S = ['Producto', 'Código', 'Categoría', 'Página PDF', 'Presentación', 'Tipo', 'Motivo / observación'];
const hojasEjemplo = () => ({
  Productos: [ENC_P,
    ['Biomilk Crema Corporal Intensive', 670, 'Cuidado personal', 48500, 89000, '750 ml', 102, 'Oferta $48.500 c/u; 45% dscto.', 'Verificado'],
    ['Delineador Plumón Tattoo', 5104, 'Maquillaje', 56000, null, '0.80 ml', 82, '2 x 1 por $56.000 (pide 1, recibe 2)', 'Precio normal no informado | No se informa precio normal; $56.000 corresponde a 2 unidades'],
    ['Labial & Brillo "Dream Rose"', 723, 'Maquillaje', 35500, 65000, '4.20 ml', 21, 'A tan solo $35.500', 'Verificado | NUEVO'],
    [null, null, null, null, null, null, null, null, null]],
  'Sin precio': [ENC_S,
    ['Loción Perfumada Ccori Rosé (obsequio)', null, 'Perfumes y colonias', 37, '200 ml', 'Sin precio encontrado', 'Obsequio GRATIS por la compra de cada perfume; sin precio ni código propio'],
    ['Brocha Base', 'No indica', 'Maquillaje', 77, null, 'Sin precio encontrado', 'Solo se vende dentro del Set de Brochas x4; no se vende por separado'],
    ['Delineador Plumón Tattoo', '5104', 'Maquillaje', 82, '0.80 ml', 'Precio normal no informado', 'Se informa precio de oferta (ver hoja Productos) pero no el precio normal.']]
});

// ---- Lector ----
test('xlsx: lee textos compartidos, números, entidades y celdas vacías, con o sin compresión y con texto en línea', () => {
  for (const opciones of [{}, { comprimir: false }, { textoEnLinea: true }]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-'));
    try {
      const ruta = path.join(dir, 'a.xlsx');
      fs.writeFileSync(ruta, xlsx(hojasEjemplo(), opciones));
      const libro = leerLibro(ruta);
      assert.deepEqual(Object.keys(libro), ['Productos', 'Sin precio']);
      assert.equal(libro.Productos[3][0], 'Labial & Brillo "Dream Rose"');
      assert.equal(libro.Productos[1][1], 670);
      assert.equal(libro.Productos[2][4], undefined); // celda vacía
      assert.equal(libro.Productos[2][3], 56000);
      assert.equal(libro['Sin precio'][1][1] ?? null, null);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('xlsx: archivos que no son un Excel válido dan un mensaje claro', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-'));
  try {
    const mal = path.join(dir, 'mal.xlsx');
    fs.writeFileSync(mal, 'esto no es un zip');
    assert.throws(() => leerLibro(mal), e => e instanceof ErrorXlsx && /no es un \.xlsx válido/.test(e.message));
    fs.writeFileSync(mal, zip({ 'hola.txt': 'x' }));
    assert.throws(() => leerLibro(mal), e => e instanceof ErrorXlsx && /workbook\.xml/.test(e.message));
    assert.throws(() => leerLibro(path.join(dir, 'no-existe.xlsx')), e => e instanceof ErrorXlsx && /No se pudo leer/.test(e.message));
    const bueno = xlsx(hojasEjemplo());
    fs.writeFileSync(mal, bueno.subarray(0, bueno.length - 40)); // truncado
    assert.throws(() => leerLibro(mal), ErrorXlsx);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('xlsx: se rechaza un archivo interno que se descomprime a un tamaño desproporcionado', () => {
  const zipBomba = zip({ 'xl/workbook.xml': 'a'.repeat(1024) });
  // se falsea el tamaño declarado por encima del tope
  const buf = Buffer.from(zipBomba);
  const eocd = buf.length - 22;
  const cd = buf.readUInt32LE(eocd + 16);
  buf.writeUInt32LE(100 * 1024 * 1024, cd + 24);
  assert.throws(() => leerZip(buf).leer('xl/workbook.xml'), e => e instanceof ErrorXlsx && /demasiado grande/.test(e.message));
});

// ---- Conversión ----
const aLibro = h => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-')); try { const r = path.join(dir, 'a.xlsx'); fs.writeFileSync(r, xlsx(h)); return leerLibro(r); } finally { fs.rmSync(dir, { recursive: true, force: true }); } };

test('convertir: arma el consolidado con los campos del panel y respeta 2 x 1, obsequios y sin precio', () => {
  const { datos, resumen } = convertir(aLibro(hojasEjemplo()));
  assert.equal(resumen.total, 5);
  assert.equal(resumen.con_precio, 3);
  assert.equal(resumen.sin_precio, 2);
  assert.equal(resumen.dos_por_uno_aparente, 1);
  assert.equal(resumen.parciales_omitidos, 1); // el 5104 repetido en la hoja "Sin precio" no se duplica
  const por = id => datos.productos.find(p => p.id === id);
  assert.deepEqual(Object.keys(datos.productos[0]).sort(), ['aviso_revision', 'categoria', 'estado', 'estado_importacion', 'id', 'nombre', 'notas', 'origen',
    'pagina_origen', 'precio_normal', 'precio_oferta', 'presentacion', 'promocion', 'referencia', 'vigencia_desde', 'vigencia_hasta']);
  assert.equal(por('p670').precio_oferta, 48500);
  assert.equal(por('p670').precio_normal, 89000);
  assert.equal(por('p670').pagina_origen, '102');
  assert.equal(por('p670').estado, 'pendiente_revision');
  assert.equal(por('p670').estado_importacion, 'Valido');
  assert.equal(por('p670').aviso_revision, '');
  assert.equal(por('p5104').precio_normal, null);
  assert.equal(por('p5104').precio_oferta, 56000);
  assert.match(por('p5104').promocion, /^2 x 1/);
  assert.equal(por('p723').nombre, 'Labial & Brillo "Dream Rose"');
  assert.equal(por('p723').aviso_revision, 'Verificado | NUEVO');
  const obsequio = datos.productos.find(p => /Ccori/.test(p.nombre));
  assert.equal(obsequio.estado_importacion, 'Sin precio');
  assert.match(obsequio.promocion, /^Obsequio/);
  assert.equal(obsequio.precio_normal, null);
  assert.match(obsequio.id, /^s37-/);
  assert.equal(new Set(datos.productos.map(p => p.id)).size, 5);
});

test('convertir: un código repetido recibe un id distinto y queda marcado como Doble', () => {
  const h = hojasEjemplo();
  h.Productos.push(['Biomilk (segunda aparición)', 670, 'Cuidado personal', 50000, 89000, '750 ml', 103, 'Oferta', 'Verificado']);
  const { datos, resumen } = convertir(aLibro(h));
  const dobles = datos.productos.filter(p => p.estado_importacion === 'Doble');
  assert.equal(dobles.length, 1);
  assert.equal(dobles[0].id, 'p670_2');
  assert.equal(resumen.repetidos, 1);
});

test('convertir: las filas "Revisar" se rechazan salvo --permitir-revisar', () => {
  const h = hojasEjemplo();
  h.Productos.push(['Producto dudoso', 9999, 'Maquillaje', 10000, 20000, '', 5, '', 'Revisar: precio oferta no aparece en la página']);
  assert.throws(() => convertir(aLibro(h)), e => e instanceof ErrorXlsx && /1 fila\(s\) en estado "Revisar" sin aprobar \(códigos: 9999\)/.test(e.message));
  const ok = convertir(aLibro(h), { permitirRevisar: true });
  assert.equal(ok.resumen.revisar, 1);
  assert.match(ok.datos.productos.find(p => p.id === 'p9999').aviso_revision, /^Revisar/);
});

test('convertir: --aprobar admite solo los códigos nombrados, y rechaza códigos que no estaban en Revisar', () => {
  const h = hojasEjemplo();
  h.Productos.push(['Dudoso uno', 9001, 'Maquillaje', 10000, 20000, '', 5, '', 'Revisar: precio oferta no aparece en la página']);
  h.Productos.push(['Dudoso dos', 9002, 'Maquillaje', 11000, 22000, '', 5, '', 'Revisar: código no aparece en la página']);
  const libro = aLibro(h);
  const parcial = () => convertir(libro, { aprobar: ['9001'] });
  assert.throws(parcial, e => e instanceof ErrorXlsx && /1 fila\(s\) en estado "Revisar" sin aprobar \(códigos: 9002\)/.test(e.message));
  const ok = convertir(libro, { aprobar: ['9001', ' 9002 '] });
  assert.equal(ok.resumen.revisar, 2);
  assert.match(ok.datos.productos.find(p => p.id === 'p9001').aviso_revision, /^Revisar/); // queda constancia
  assert.throws(() => convertir(libro, { aprobar: ['9001', '9002', '670'] }), /no están en estado "Revisar" en este Excel: 670/);
  assert.throws(() => convertir(aLibro(hojasEjemplo()), { aprobar: ['1234'] }), /no están en estado "Revisar"/);
});

test('convertir: detecta filas con datos inválidos y los lista todos', () => {
  const h = hojasEjemplo();
  h.Productos.push(['Sin código', null, 'X', 1000, 2000, '', 1, '', 'Verificado']);
  h.Productos.push(['Oferta mayor', 777, 'X', 9000, 5000, '', 1, '', 'Verificado']);
  h.Productos.push(['Sin precios', 888, 'X', null, null, '', 1, '', 'Verificado']);
  h.Productos.push([null, 999, 'X', 1000, 2000, '', 1, '', 'Verificado']);
  assert.throws(() => convertir(aLibro(h)), e => e instanceof ErrorXlsx && /4 problema\(s\)/.test(e.message) && /código no válido/.test(e.message)
    && /supera al precio normal/.test(e.message) && /sin ningún precio/.test(e.message) && /sin nombre/.test(e.message));
});

test('convertir: hojas o columnas ausentes dan mensajes claros', () => {
  assert.throws(() => convertir({ Productos: [ENC_P] }), /Falta la hoja "Sin precio"/);
  assert.throws(() => convertir({ 'Sin precio': [ENC_S] }), /Falta la hoja "Productos"/);
  assert.throws(() => convertir({ Productos: [['A', 'B']], 'Sin precio': [ENC_S] }), /no tiene las columnas esperadas: nombre del producto/);
  assert.throws(() => convertir({ Productos: [ENC_P], 'Sin precio': [ENC_S] }), /no contiene productos/);
});

// ---- Línea de comandos e integración con el cargador de campañas ----
test('xlsx -> consolidado -> cargar-campana (ensayo): la cadena completa funciona y no escribe nada del catálogo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-cli-'));
  const raiz = path.join(__dirname, '..');
  try {
    const origen = path.join(dir, 'c12.xlsx'), destino = path.join(dir, 'consolidado.json');
    fs.writeFileSync(origen, xlsx(hojasEjemplo()));
    const correr = (script, args, env = {}) => spawnSync(process.execPath, [path.join(raiz, 'scripts', script), ...args], { encoding: 'utf8', env: { ...process.env, ...env } });

    const mal = correr('xlsx-a-consolidado.js', ['--origen', origen, '--destino', destino, '--esperados', '99']);
    assert.equal(mal.status, 1);
    assert.match(mal.stderr, /Se esperaban 99 productos y el Excel trae 5/);
    assert.equal(fs.existsSync(destino), false);

    const r = correr('xlsx-a-consolidado.js', ['--origen', origen, '--destino', destino, '--esperados', '5']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Convertido: 5 productos/);
    assert.ok(!/Biomilk|Delineador|48500|89000/.test(r.stdout + r.stderr), 'la salida no debe mostrar nombres ni precios');
    assert.equal(fs.statSync(destino).mode & 0o777, 0o600);
    assert.equal(JSON.parse(fs.readFileSync(destino, 'utf8')).productos.length, 5);

    const otra = correr('xlsx-a-consolidado.js', ['--origen', origen, '--destino', destino]);
    assert.equal(otra.status, 1);
    assert.match(otra.stderr, /ya existe/);

    const datos = path.join(dir, 'data');
    fs.mkdirSync(datos);
    const carga = correr('cargar-campana.js', ['--origen', destino, '--campana', 'C12 2026', '--desde', '2026-11-07', '--hasta', '2026-12-04', '--esperados', '5'], { DATA_DIR: datos });
    assert.equal(carga.status, 0, carga.stdout + carga.stderr);
    assert.match(carga.stdout, /Productos en el origen: 5/);
    assert.deepEqual(fs.readdirSync(datos), []); // ensayo: no escribe nada
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
