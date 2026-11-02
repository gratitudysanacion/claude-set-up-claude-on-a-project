'use strict';
// Datos de prueba basados en productos reales de la campaña C11 2026 (verificados contra el catálogo impreso).
// No contienen datos personales ni credenciales.
const base = { estado: 'pendiente_revision', vigencia_desde: '', vigencia_hasta: '' };

const productos = [
  { ...base, id: 'p670', nombre: 'Biomilk Crema Corporal Intensive', referencia: '670', categoria: 'Cuidado personal', presentacion: '750 ml',
    precio_normal: 89000, precio_oferta: 48500, promocion: 'Oferta $48.500 c/u; 45% dscto.; ml a $64,67', pagina_origen: '102' },
  { ...base, id: 'p750', nombre: 'Biomilk Crema Corporal Sensitive', referencia: '750', categoria: 'Cuidado personal', presentacion: '750 ml',
    precio_normal: 89000, precio_oferta: 48500, promocion: 'Oferta $48.500 c/u; 45% dscto.; ml a $64,67', pagina_origen: '102' },
  { ...base, id: 'p306', nombre: 'Biomilk Crema Corporal Original', referencia: '306', categoria: 'Cuidado personal', presentacion: '750 ml',
    precio_normal: 89000, precio_oferta: 53000, promocion: 'Oferta 40% dscto.; ml a $70,67; incluye Biomilk Jabón en Barra x4 (90 g x 4) GRATIS', pagina_origen: '103' },
  { ...base, id: 'p603', nombre: 'Producto con precio por gramo', referencia: '603', categoria: 'Maquillaje', presentacion: '',
    precio_normal: 91000, precio_oferta: 55000, promocion: 'Oferta 40% dscto.; g a $275', pagina_origen: '100' },
  { ...base, id: 'p2032', nombre: 'Producto con texto incompleto', referencia: '2032', categoria: 'Maquillaje', presentacion: '',
    precio_normal: 25000, precio_oferta: 12500, promocion: 'A tan solo; 50% dscto.; g a $138,89', pagina_origen: '43' },
  { ...base, id: 'p79989', nombre: 'Set Fragancia y Labial', referencia: '79989', categoria: 'Perfumes y colonias', presentacion: '',
    precio_normal: 191000, precio_oferta: 86000, promocion: 'SET 55% dscto.; componentes en oferta: EDT $70.000, Labial $16.000', pagina_origen: '46' },
  { ...base, id: 'p79900', nombre: 'Set Colonia y Jabón', referencia: '79900', categoria: 'Mundo hombre', presentacion: '',
    precio_normal: 110000, precio_oferta: 49500, promocion: 'SET $49.500 c/u; 55% dscto.; componentes en oferta: Colonia $38.500, Jabón $11.000', pagina_origen: '51' },
  { ...base, id: 'psetmal', nombre: 'Set con suma incorrecta', referencia: '79001', categoria: 'Mundo hombre', presentacion: '',
    precio_normal: 100000, precio_oferta: 60000, promocion: 'SET 55% dscto.; componentes en oferta: Colonia $38.500, Jabón $11.000', pagina_origen: '52' },
  { ...base, id: 'pbrocha1', nombre: 'Brocha Base', referencia: '', categoria: 'Maquillaje', presentacion: '',
    precio_normal: 0, precio_oferta: 0, promocion: 'Solo se vende dentro del Set de Brochas x4 (cód. 60053, $100.500); no se vende por separado', pagina_origen: '77' },
  { ...base, id: 'psinprecio', nombre: 'Producto sin precio', referencia: '9001', categoria: 'Maquillaje', presentacion: '',
    precio_normal: 0, precio_oferta: 0, promocion: '', pagina_origen: '10' },
  { ...base, id: 'poferta_sin_normal', nombre: 'Producto solo con oferta', referencia: '9002', categoria: 'Joyería para mujer', presentacion: '',
    precio_normal: 0, precio_oferta: 18000, promocion: 'A tan solo $18.000 c/u; 50% dscto.', pagina_origen: '20' },
  { ...base, id: 'pcafe', nombre: 'Colonia Café Intenso', referencia: '9003', categoria: 'Mundo hombre', presentacion: '100 ml',
    precio_normal: 120000, precio_oferta: 70000, promocion: 'Oferta $70.000 c/u', pagina_origen: '30' },
  { ...base, id: 'pdoble1', nombre: 'Labial Mate Rosa', referencia: '9101', categoria: 'Maquillaje', presentacion: '3 g',
    precio_normal: 30000, precio_oferta: 15000, promocion: 'Oferta $15.000 c/u', pagina_origen: '60' },
  { ...base, id: 'pdoble2', nombre: 'Labial Mate Rosa', referencia: '9102', categoria: 'Maquillaje', presentacion: '3 g',
    precio_normal: 30000, precio_oferta: 15000, promocion: 'Oferta $15.000 c/u', pagina_origen: '61' },
  { ...base, id: 'ppropia', nombre: 'Producto con vigencia propia', referencia: '9200', categoria: 'Maquillaje', presentacion: '',
    precio_normal: 40000, precio_oferta: 20000, promocion: 'Oferta $20.000 c/u', pagina_origen: '70',
    vigencia_desde: '2026-10-01', vigencia_hasta: '2026-10-20' },
  { ...base, id: 'pconfirmado', nombre: 'Producto confirmado', referencia: '9300', categoria: 'Maquillaje', presentacion: '',
    precio_normal: 50000, precio_oferta: 25000, promocion: 'Oferta $25.000 c/u', pagina_origen: '71', estado: 'confirmado' },
  // Promociones 2 x 1 tal como están en el catálogo real (con la nota interna que agrega la importación).
  { ...base, id: 'p5104', nombre: 'Delineador Plumón Tattoo', referencia: '5104', categoria: 'Maquillaje', presentacion: '0.80 ml',
    precio_normal: 0, precio_oferta: 56000, pagina_origen: '82',
    promocion: '2 x 1 por $56.000 (pide 1, recibe 2) | Se informa precio de oferta (ver hoja Productos) pero no el precio normal. Promoción: 2 x 1 por $56.000 (pide 1, recibe 2)' },
  { ...base, id: 'p723', nombre: 'Línea Reparación Intensiva', referencia: '723', categoria: 'Cuidado facial', presentacion: '',
    precio_normal: 0, precio_oferta: 58000, pagina_origen: '90',
    promocion: '2 x 1 por $58.000 (cualquier combinación entre Reparación Intensiva y Protección Total); ml a $116 | Se informa precio de oferta (ver hoja Productos) pero no el precio normal. Promoción: 2 x 1 por $58.000 (cualquier combinación entre Reparación Intensiva y Protección Total); ml a $116' },
  { ...base, id: 'p2x1mal', nombre: 'Producto 2x1 con importe distinto', referencia: '9400', categoria: 'Maquillaje', presentacion: '',
    precio_normal: 0, precio_oferta: 40000, promocion: '2 x 1 por $56.000 (pide 1, recibe 2)', pagina_origen: '83' },
  { ...base, id: 'p2x1completo', nombre: 'Producto 2x1 con ambos precios', referencia: '9401', categoria: 'Maquillaje', presentacion: '',
    precio_normal: 60000, precio_oferta: 56000, promocion: '2 x 1 por $56.000 (pide 1, recibe 2)', pagina_origen: '84' },
  { ...base, id: 'pobsequio', nombre: 'Obsequio Zentro Eau de Parfum', referencia: '', categoria: 'Perfumes y colonias', presentacion: '',
    precio_normal: 0, precio_oferta: 0, pagina_origen: '35',
    promocion: 'Obsequio GRATIS por la compra de cada Zentro Eau de Parfum; sin precio ni código propio.' },
  { ...base, id: 'psolooferta_nota', nombre: 'Producto solo oferta con nota', referencia: '9402', categoria: 'Joyería para mujer', presentacion: '',
    precio_normal: 0, precio_oferta: 18000, pagina_origen: '21',
    promocion: 'A tan solo $18.000 c/u; 50% dscto. | Se informa precio de oferta (ver hoja Productos) pero no el precio normal. Promoción: A tan solo $18.000 c/u; 50% dscto.' }
];

// Muchos productos para probar el límite de 10 resultados.
for (let i = 1; i <= 14; i++) {
  productos.push({ ...base, id: `pl${i}`, nombre: `Labial Cremoso Tono ${i}`, referencia: `95${String(i).padStart(2, '0')}`,
    categoria: 'Maquillaje', presentacion: '3 g', precio_normal: 30000, precio_oferta: 15000, promocion: 'Oferta $15.000 c/u', pagina_origen: '65' });
}

const campana = { campana: 'C11 2026', vigencia_desde: '2026-10-10', vigencia_hasta: '2026-11-06' };

module.exports = { productos, campana };
