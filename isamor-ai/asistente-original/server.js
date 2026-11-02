const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT) || 3080;
const publicDir = path.join(__dirname, '..', 'public');
const indexFile = path.join(publicDir, 'index.html');

const server = http.createServer((req, res) => {
  const pathname = new URL(
    req.url,
    'http://127.0.0.1'
  ).pathname;

  if (req.method === 'GET' && pathname === '/health') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });

    res.end(JSON.stringify({
      status: 'ok',
      application: 'Yanbal AI Assistant',
      version: '1.0.0',
      interface: 'available',
      ai: 'not_connected'
    }));
    return;
  }

  if (req.method === 'GET' && pathname === '/api') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });

    res.end(JSON.stringify({
      message: 'Bienvenida a Yanbal AI Assistant',
      modules: [
        'Yanbal Content Studio',
        'Yanbal Beauty Advisor',
        'Yanbal Sales Manager'
      ]
    }));
    return;
  }

  if (req.method === 'GET' &&
      (pathname === '/' || pathname === '/index.html')) {
    fs.readFile(indexFile, (err, content) => {
      if (err) {
        console.error('No se pudo leer la interfaz:', err.message);
        res.writeHead(500, {
          'Content-Type': 'text/plain; charset=utf-8'
        });
        res.end('No se pudo cargar la interfaz Yanbal.');
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN',
        'Referrer-Policy': 'strict-origin-when-cross-origin'
      });

      res.end(content);
    });
    return;
  }

  // Servir el logo de Yanbal
  if (req.method === 'GET' && pathname === '/yanbal-logo.jpg') {
    const logoFile = path.join(publicDir, 'yanbal-logo.jpg');

    fs.readFile(logoFile, (err, content) => {
      if (err) {
        console.error('No se pudo leer el logo:', err.message);
        res.writeHead(404, {
          'Content-Type': 'text/plain; charset=utf-8'
        });
        res.end('No se encontró el logo de Yanbal.');
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=3600',
        'X-Content-Type-Options': 'nosniff'
      });
      res.end(content);
    });
    return;
  }

  res.writeHead(404, {
    'Content-Type': 'application/json; charset=utf-8'
  });

  res.end(JSON.stringify({
    error: 'Ruta no encontrada'
  }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(
    `Yanbal AI Assistant ejecutándose en el puerto ${PORT}`
  );
});
