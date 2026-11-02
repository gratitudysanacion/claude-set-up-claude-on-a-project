'use strict';
// Guardado de data/usuarios.json: permisos 600, escritura atómica (archivo temporal + renombrar) y copia de la versión
// anterior en usuarios.json.anterior, para poder volver atrás si algo sale mal. No imprime nada.
const fs = require('node:fs');
const path = require('node:path');

// Lee el archivo y separa la lista de usuarios del resto de claves que pudiera tener (se conservan al guardar).
function leerUsuarios(ruta) {
  const { usuarios, ...resto } = JSON.parse(fs.readFileSync(ruta, 'utf8'));
  return { usuarios: usuarios || {}, resto };
}

function crearGuardado(ruta, resto = {}) {
  return async function guardar(usuarios) {
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    if (fs.existsSync(ruta)) {
      fs.copyFileSync(ruta, `${ruta}.anterior`);
      fs.chmodSync(`${ruta}.anterior`, 0o600);
    }
    const temporal = `${ruta}.tmp`;
    fs.writeFileSync(temporal, JSON.stringify({ ...resto, usuarios }, null, 2), { mode: 0o600 });
    fs.renameSync(temporal, ruta);
    fs.chmodSync(ruta, 0o600);
  };
}

module.exports = { leerUsuarios, crearGuardado };
