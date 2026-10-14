const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT_DIR = path.resolve(__dirname, '../../');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const UPLOADS_DIR = path.join(ROOT_DIR, 'uploads');

// Pastikan folder data dan uploads ada
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.kml': 'application/vnd.google-earth.kml+xml',
  '.csv': 'text/csv'
};

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer((req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURI(urlObj.pathname);

  // --- REST API ENDPOINTS ---
  if (pathname === '/api/health') {
    return sendJson(res, 200, { status: 'ok', time: new Date().toISOString() });
  }

  // GET: Daftar file project di folder /data
  if (req.method === 'GET' && pathname === '/api/projects') {
    fs.readdir(DATA_DIR, (err, files) => {
      if (err) return sendJson(res, 500, { error: 'Gagal membaca direktori data' });
      const jsonFiles = files.filter(f => f.endsWith('.json'));
      return sendJson(res, 200, { projects: jsonFiles });
    });
    return;
  }

  // POST: Simpan project ke folder /data
  if (req.method === 'POST' && pathname === '/api/projects') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const filename = payload.name ? `${payload.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.json` : `project_${Date.now()}.json`;
        const filePath = path.join(DATA_DIR, filename);
        fs.writeFileSync(filePath, JSON.stringify(payload.data || payload, null, 2), 'utf8');
        return sendJson(res, 200, { success: true, filename });
      } catch (e) {
        return sendJson(res, 400, { error: 'Data JSON tidak valid' });
      }
    });
    return;
  }

  // --- STATIC FILE SERVING ---
  let filePath;
  if (pathname.startsWith('/uploads/')) {
    filePath = path.join(UPLOADS_DIR, pathname.replace('/uploads/', ''));
  } else {
    let relativePath = pathname === '/' ? '/index.html' : pathname;
    filePath = path.join(PUBLIC_DIR, relativePath);
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found: ' + pathname);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': mimeTypes[ext] || 'application/octet-stream',
      'Content-Length': stats.size
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('====================================================');
  console.log(`📡 FO Network Mapper Server is Running!`);
  console.log(`🌐 Akses: http://localhost:${PORT}/`);
  console.log(`📂 Folder Proyek: ${ROOT_DIR}`);
  console.log('====================================================');
});

