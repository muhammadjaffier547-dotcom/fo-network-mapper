const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ROOT_DIR = path.resolve(__dirname, '../../');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const UPLOADS_DIR = path.join(ROOT_DIR, 'uploads');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// Pastikan folder data dan uploads ada
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// --- DEFAULT ACCOUNTS & USER STORE ---
const DEFAULT_USERS = [
  {
    id: 'usr_superadmin_01',
    username: 'admin',
    password: 'admin123',
    name: 'Super Admin',
    role: 'SUPER_ADMIN',
    avatar: 'fa-user-shield',
    createdAt: new Date().toISOString()
  },
  {
    id: 'usr_teknisi_01',
    username: 'teknisi',
    password: 'teknisi123',
    name: 'Teknisi Lapangan',
    role: 'USER',
    avatar: 'fa-hard-hat',
    createdAt: new Date().toISOString()
  }
];

function getUsers() {
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(DEFAULT_USERS, null, 2), 'utf8');
    return DEFAULT_USERS;
  }
  try {
    const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    if (!Array.isArray(data) || data.length === 0) {
      fs.writeFileSync(USERS_FILE, JSON.stringify(DEFAULT_USERS, null, 2), 'utf8');
      return DEFAULT_USERS;
    }
    return data;
  } catch (e) {
    return DEFAULT_USERS;
  }
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

// Inisialisasi file users jika belum ada
getUsers();

// In-memory active sessions: token -> { user, expiresAt }
const SESSIONS = new Map();

function generateToken(user) {
  const token = 'tok_' + crypto.randomBytes(24).toString('hex');
  SESSIONS.set(token, {
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      avatar: user.avatar || (user.role === 'SUPER_ADMIN' ? 'fa-user-shield' : 'fa-hard-hat')
    },
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 hari
  });
  return token;
}

function getAuthenticatedUser(req) {
  const authHeader = req.headers['authorization'] || '';
  let token = '';
  if (authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (req.headers['x-auth-token']) {
    token = String(req.headers['x-auth-token']).trim();
  }
  if (!token) return null;

  const session = SESSIONS.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    SESSIONS.delete(token);
    return null;
  }
  return session.user;
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

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
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-auth-token',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-auth-token');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURI(urlObj.pathname);

  // --- 1. HEALTH CHECK ---
  if (pathname === '/api/health') {
    return sendJson(res, 200, {
      status: 'ok',
      service: 'FO Network Mapper API',
      activeSessions: SESSIONS.size,
      time: new Date().toISOString()
    });
  }

  // --- 2. AUTHENTICATION ENDPOINTS ---

  // POST: Login (Username & Password)
  if (req.method === 'POST' && pathname === '/api/auth/login') {
    try {
      const { username, password } = await parseJsonBody(req);
      if (!username || !password) {
        return sendJson(res, 400, { success: false, error: 'Username dan password wajib diisi.' });
      }

      const users = getUsers();
      const user = users.find(u => u.username.toLowerCase() === String(username).toLowerCase().trim() && u.password === String(password));
      if (!user) {
        return sendJson(res, 401, { success: false, error: 'Username atau password tidak sesuai.' });
      }

      const token = generateToken(user);
      return sendJson(res, 200, {
        success: true,
        token,
        user: {
          id: user.id,
          username: user.username,
          name: user.name,
          role: user.role,
          avatar: user.avatar || (user.role === 'SUPER_ADMIN' ? 'fa-user-shield' : 'fa-hard-hat')
        }
      });
    } catch (e) {
      return sendJson(res, 400, { success: false, error: 'Format JSON data tidak valid.' });
    }
  }

  // GET: Cek profil user saat ini (Me)
  if (req.method === 'GET' && pathname === '/api/auth/me') {
    const authUser = getAuthenticatedUser(req);
    if (!authUser) {
      return sendJson(res, 200, { authenticated: false, role: 'GUEST' });
    }
    return sendJson(res, 200, { authenticated: true, user: authUser });
  }

  // POST: Logout
  if (req.method === 'POST' && pathname === '/api/auth/logout') {
    const authHeader = req.headers['authorization'] || '';
    let token = '';
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else if (req.headers['x-auth-token']) {
      token = String(req.headers['x-auth-token']).trim();
    }
    if (token) SESSIONS.delete(token);
    return sendJson(res, 200, { success: true, message: 'Berhasil keluar.' });
  }

  // --- 3. USER MANAGEMENT (SUPER ADMIN ONLY) ---

  // GET: Daftar semua akun pengguna
  if (req.method === 'GET' && pathname === '/api/users') {
    const authUser = getAuthenticatedUser(req);
    if (!authUser || authUser.role !== 'SUPER_ADMIN') {
      return sendJson(res, 403, {
        error: 'Akses Ditolak (403 Forbidden): Hanya SUPER ADMIN yang diizinkan untuk melihat daftar akun.',
        requiredRole: 'SUPER_ADMIN',
        currentRole: authUser ? authUser.role : 'GUEST'
      });
    }

    const safeUsers = getUsers().map(u => ({
      id: u.id,
      username: u.username,
      name: u.name,
      role: u.role,
      avatar: u.avatar || (u.role === 'SUPER_ADMIN' ? 'fa-user-shield' : 'fa-hard-hat'),
      createdAt: u.createdAt
    }));
    return sendJson(res, 200, { users: safeUsers });
  }

  // POST: Buat akun pengguna baru (SUPER ADMIN ONLY)
  if (req.method === 'POST' && pathname === '/api/users') {
    const authUser = getAuthenticatedUser(req);
    if (!authUser || authUser.role !== 'SUPER_ADMIN') {
      return sendJson(res, 403, {
        error: 'Akses Ditolak (403 Forbidden): Hanya SUPER ADMIN yang dapat membuat akun pengguna baru.',
        requiredRole: 'SUPER_ADMIN',
        currentRole: authUser ? authUser.role : 'GUEST'
      });
    }

    try {
      const { username, password, name, role } = await parseJsonBody(req);
      const cleanUser = String(username || '').trim().toLowerCase();
      const cleanPass = String(password || '').trim();
      const cleanName = String(name || '').trim() || cleanUser;
      const cleanRole = String(role || '').toUpperCase();

      if (!cleanUser || cleanUser.length < 3) {
        return sendJson(res, 400, { error: 'Username minimal 3 karakter.' });
      }
      if (!cleanPass || cleanPass.length < 4) {
        return sendJson(res, 400, { error: 'Password minimal 4 karakter.' });
      }
      if (cleanRole !== 'SUPER_ADMIN' && cleanRole !== 'USER') {
        return sendJson(res, 400, { error: 'Role harus SUPER_ADMIN atau USER.' });
      }

      const users = getUsers();
      if (users.some(u => u.username.toLowerCase() === cleanUser)) {
        return sendJson(res, 400, { error: `Username "${cleanUser}" sudah digunakan.` });
      }

      const newUser = {
        id: 'usr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        username: cleanUser,
        password: cleanPass,
        name: cleanName,
        role: cleanRole,
        avatar: cleanRole === 'SUPER_ADMIN' ? 'fa-user-shield' : 'fa-hard-hat',
        createdAt: new Date().toISOString()
      };

      users.push(newUser);
      saveUsers(users);

      return sendJson(res, 201, {
        success: true,
        user: {
          id: newUser.id,
          username: newUser.username,
          name: newUser.name,
          role: newUser.role,
          avatar: newUser.avatar,
          createdAt: newUser.createdAt
        }
      });
    } catch (e) {
      return sendJson(res, 400, { error: 'Data JSON tidak valid.' });
    }
  }

  // PUT / POST: Update Role / Akun (SUPER ADMIN ONLY)
  if ((req.method === 'PUT' && pathname.startsWith('/api/users')) || (req.method === 'POST' && pathname === '/api/users/update')) {
    const authUser = getAuthenticatedUser(req);
    if (!authUser || authUser.role !== 'SUPER_ADMIN') {
      return sendJson(res, 403, {
        error: 'Akses Ditolak (403 Forbidden): Hanya SUPER ADMIN yang dapat mengubah akun pengguna.',
        requiredRole: 'SUPER_ADMIN',
        currentRole: authUser ? authUser.role : 'GUEST'
      });
    }

    try {
      const { id, role, name, password } = await parseJsonBody(req);
      const targetId = id || pathname.split('/').pop();
      const users = getUsers();
      const user = users.find(u => u.id === targetId);

      if (!user) {
        return sendJson(res, 404, { error: 'Pengguna tidak ditemukan.' });
      }

      if (role && (role === 'SUPER_ADMIN' || role === 'USER')) {
        // Cegah jika satu-satunya super admin diubah menjadi user
        if (user.role === 'SUPER_ADMIN' && role === 'USER') {
          const superAdminCount = users.filter(u => u.role === 'SUPER_ADMIN').length;
          if (superAdminCount <= 1) {
            return sendJson(res, 400, { error: 'Gagal: Sistem harus memiliki minimal satu akun SUPER ADMIN aktif.' });
          }
        }
        user.role = role;
        user.avatar = role === 'SUPER_ADMIN' ? 'fa-user-shield' : 'fa-hard-hat';
      }

      if (name) user.name = String(name).trim();
      if (password && String(password).trim().length >= 4) {
        user.password = String(password).trim();
      }

      saveUsers(users);

      // Update sesi aktif jika ada
      for (const [sTok, sData] of SESSIONS.entries()) {
        if (sData.user.id === user.id) {
          sData.user.role = user.role;
          sData.user.name = user.name;
          sData.user.avatar = user.avatar;
        }
      }

      return sendJson(res, 200, { success: true, message: 'Akun berhasil diperbarui.' });
    } catch (e) {
      return sendJson(res, 400, { error: 'Gagal memperbarui data akun.' });
    }
  }

  // DELETE / POST: Hapus Akun (SUPER ADMIN ONLY)
  if ((req.method === 'DELETE' && pathname.startsWith('/api/users')) || (req.method === 'POST' && pathname === '/api/users/delete')) {
    const authUser = getAuthenticatedUser(req);
    if (!authUser || authUser.role !== 'SUPER_ADMIN') {
      return sendJson(res, 403, {
        error: 'Akses Ditolak (403 Forbidden): Hanya SUPER ADMIN yang dapat menghapus akun.',
        requiredRole: 'SUPER_ADMIN',
        currentRole: authUser ? authUser.role : 'GUEST'
      });
    }

    try {
      let targetId = pathname.replace('/api/users/', '').replace('/api/users', '');
      if (!targetId || targetId === '/delete') {
        const parsed = await parseJsonBody(req);
        targetId = parsed.id;
      }

      if (authUser.id === targetId) {
        return sendJson(res, 400, { error: 'Anda tidak dapat menghapus akun Anda sendiri yang sedang aktif.' });
      }

      let users = getUsers();
      const targetUser = users.find(u => u.id === targetId);
      if (!targetUser) {
        return sendJson(res, 404, { error: 'Pengguna tidak ditemukan.' });
      }

      if (targetUser.role === 'SUPER_ADMIN') {
        const superCount = users.filter(u => u.role === 'SUPER_ADMIN').length;
        if (superCount <= 1) {
          return sendJson(res, 400, { error: 'Gagal: Tidak dapat menghapus satu-satunya SUPER ADMIN tersisa.' });
        }
      }

      users = users.filter(u => u.id !== targetId);
      saveUsers(users);

      // Hapus session jika user sedang login
      for (const [sTok, sData] of SESSIONS.entries()) {
        if (sData.user.id === targetId) {
          SESSIONS.delete(sTok);
        }
      }

      return sendJson(res, 200, { success: true, message: `Akun "${targetUser.username}" berhasil dihapus.` });
    } catch (e) {
      return sendJson(res, 400, { error: 'Gagal memproses penghapusan akun.' });
    }
  }

  // --- 4. PROJECT DATA API (VALIDASI SERVER-SIDE ROLE) ---

  // GET: Daftar file project di folder /data (Dapat diakses Publik/User)
  if (req.method === 'GET' && pathname === '/api/projects') {
    fs.readdir(DATA_DIR, (err, files) => {
      if (err) return sendJson(res, 500, { error: 'Gagal membaca direktori data' });
      const jsonFiles = files.filter(f => f.endsWith('.json') && f !== 'users.json');
      return sendJson(res, 200, { projects: jsonFiles });
    });
    return;
  }

  // POST: Simpan project ke server (DIVALIDASI SERVER: HANYA SUPER ADMIN!)
  if (req.method === 'POST' && pathname === '/api/projects') {
    const authUser = getAuthenticatedUser(req);
    // VALIDASI SERVER: HANYA SUPER ADMIN YANG BISA SIMPAN/MODIFIKASI DATA
    if (!authUser || authUser.role !== 'SUPER_ADMIN') {
      return sendJson(res, 403, {
        error: 'Akses Ditolak (403 Forbidden): Hanya SUPER ADMIN yang memiliki hak akses untuk menyimpan atau mengubah data jaringan FO ke server.',
        requiredRole: 'SUPER_ADMIN',
        currentRole: authUser ? authUser.role : 'GUEST'
      });
    }

    try {
      const payload = await parseJsonBody(req);
      const filename = payload.name ? `${payload.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.json` : `project_${Date.now()}.json`;
      const filePath = path.join(DATA_DIR, filename);
      fs.writeFileSync(filePath, JSON.stringify(payload.data || payload, null, 2), 'utf8');
      return sendJson(res, 200, { success: true, filename, savedBy: authUser.username });
    } catch (e) {
      return sendJson(res, 400, { error: 'Data JSON tidak valid' });
    }
  }

  // --- 5. STATIC FILE SERVING ---
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
  console.log(`🔒 RBAC Auth: Aktif (SUPER_ADMIN & USER)`);
  console.log(`📂 Folder Proyek: ${ROOT_DIR}`);
  console.log('====================================================');
});
