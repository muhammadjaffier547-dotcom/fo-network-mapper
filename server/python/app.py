"""
FO Network Mapper - Python Backend Service with RBAC Auth & Role Validation
Jalankan dengan: python app.py
Bisa menggunakan library standar Python (tanpa install library external)
"""
import http.server
import socketserver
import os
import json
import time
import secrets
from pathlib import Path

PORT = 5000
ROOT_DIR = Path(__file__).resolve().parent.parent.parent
PUBLIC_DIR = ROOT_DIR / "public"
DATA_DIR = ROOT_DIR / "data"
UPLOADS_DIR = ROOT_DIR / "uploads"
USERS_FILE = DATA_DIR / "users.json"

DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_USERS = [
    {
        "id": "usr_superadmin_01",
        "username": "admin",
        "password": "admin123",
        "name": "Super Admin",
        "role": "SUPER_ADMIN",
        "avatar": "fa-user-shield",
        "createdAt": "2026-10-14T00:00:00.000Z"
    },
    {
        "id": "usr_teknisi_01",
        "username": "teknisi",
        "password": "teknisi123",
        "name": "Teknisi Lapangan",
        "role": "USER",
        "avatar": "fa-hard-hat",
        "createdAt": "2026-10-14T00:00:00.000Z"
    }
]

def get_users():
    if not USERS_FILE.exists():
        with open(USERS_FILE, "w", encoding="utf-8") as f:
            json.dump(DEFAULT_USERS, f, indent=2)
        return DEFAULT_USERS
    try:
        with open(USERS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            if not isinstance(data, list) or len(data) == 0:
                return DEFAULT_USERS
            return data
    except Exception:
        return DEFAULT_USERS

def save_users(users):
    with open(USERS_FILE, "w", encoding="utf-8") as f:
        json.dump(users, f, indent=2)

get_users()

SESSIONS = {}

def generate_token(user):
    token = "tok_" + secrets.token_hex(24)
    SESSIONS[token] = {
        "user": {
            "id": user["id"],
            "username": user["username"],
            "name": user.get("name", user["username"]),
            "role": user["role"],
            "avatar": user.get("avatar", "fa-user-shield" if user["role"] == "SUPER_ADMIN" else "fa-hard-hat")
        },
        "expires_at": time.time() + 7 * 24 * 3600
    }
    return token

def get_authenticated_user(headers):
    auth = headers.get("Authorization", "")
    token = ""
    if auth.startswith("Bearer "):
        token = auth[7:].strip()
    elif "x-auth-token" in headers:
        token = headers.get("x-auth-token").strip()

    if not token or token not in SESSIONS:
        return None

    sess = SESSIONS[token]
    if time.time() > sess["expires_at"]:
        del SESSIONS[token]
        return None
    return sess["user"]

class FOMapperHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLIC_DIR), **kwargs)

    def send_json(self, status_code, data):
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, x-auth-token")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, x-auth-token")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.end_headers()

    def do_GET(self):
        path = self.path.split("?")[0]

        if path == "/api/health":
            return self.send_json(200, {
                "status": "ok",
                "backend": "python",
                "activeSessions": len(SESSIONS)
            })

        if path == "/api/auth/me":
            user = get_authenticated_user(self.headers)
            if not user:
                return self.send_json(200, {"authenticated": False, "role": "GUEST"})
            return self.send_json(200, {"authenticated": True, "user": user})

        if path == "/api/users":
            user = get_authenticated_user(self.headers)
            if not user or user.get("role") != "SUPER_ADMIN":
                return self.send_json(403, {
                    "error": "Akses Ditolak (403 Forbidden): Hanya SUPER ADMIN yang dapat mengakses daftar pengguna."
                })
            safe_users = [{
                "id": u["id"],
                "username": u["username"],
                "name": u.get("name", u["username"]),
                "role": u["role"],
                "avatar": u.get("avatar", "fa-user-shield"),
                "createdAt": u.get("createdAt")
            } for u in get_users()]
            return self.send_json(200, {"users": safe_users})

        if path == "/api/projects":
            files = [f.name for f in DATA_DIR.glob("*.json") if f.name != "users.json"]
            return self.send_json(200, {"projects": files})

        if path.startswith("/uploads/"):
            filename = path.replace("/uploads/", "")
            file_path = UPLOADS_DIR / filename
            if file_path.exists() and file_path.is_file():
                self.send_response(200)
                self.end_headers()
                with open(file_path, "rb") as f:
                    self.wfile.write(f.read())
                return

        return super().do_GET()

    def do_POST(self):
        path = self.path.split("?")[0]
        content_length = int(self.headers.get("Content-Length", 0))
        post_data = self.rfile.read(content_length) if content_length > 0 else b"{}"

        try:
            body = json.loads(post_data.decode("utf-8")) if post_data else {}
        except Exception:
            body = {}

        if path == "/api/auth/login":
            username = str(body.get("username", "")).strip().lower()
            password = str(body.get("password", "")).strip()
            users = get_users()
            user = next((u for u in users if u["username"].lower() == username and u["password"] == password), None)
            if not user:
                return self.send_json(401, {"success": False, "error": "Username atau password tidak sesuai."})

            token = generate_token(user)
            return self.send_json(200, {
                "success": True,
                "token": token,
                "user": SESSIONS[token]["user"]
            })

        if path == "/api/auth/logout":
            auth = self.headers.get("Authorization", "")
            token = auth[7:].strip() if auth.startswith("Bearer ") else self.headers.get("x-auth-token", "").strip()
            if token in SESSIONS:
                del SESSIONS[token]
            return self.send_json(200, {"success": True, "message": "Berhasil keluar."})

        if path == "/api/users":
            user = get_authenticated_user(self.headers)
            if not user or user.get("role") != "SUPER_ADMIN":
                return self.send_json(403, {
                    "error": "Akses Ditolak (403 Forbidden): Hanya SUPER ADMIN yang dapat membuat akun pengguna baru."
                })

            username = str(body.get("username", "")).strip().lower()
            password = str(body.get("password", "")).strip()
            name = str(body.get("name", "")).strip() or username
            role = str(body.get("role", "")).upper()

            if len(username) < 3 or len(password) < 4:
                return self.send_json(400, {"error": "Username minimal 3 karakter dan password minimal 4 karakter."})
            if role not in ["SUPER_ADMIN", "USER"]:
                return self.send_json(400, {"error": "Role harus SUPER_ADMIN atau USER."})

            users = get_users()
            if any(u["username"].lower() == username for u in users):
                return self.send_json(400, {"error": f"Username '{username}' sudah digunakan."})

            new_user = {
                "id": "usr_" + secrets.token_hex(6),
                "username": username,
                "password": password,
                "name": name,
                "role": role,
                "avatar": "fa-user-shield" if role == "SUPER_ADMIN" else "fa-hard-hat",
                "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            }
            users.append(new_user)
            save_users(users)
            return self.send_json(201, {"success": True, "user": new_user})

        if path == "/api/projects":
            user = get_authenticated_user(self.headers)
            # SERVER-SIDE ROLE CHECK: ONLY SUPER ADMIN!
            if not user or user.get("role") != "SUPER_ADMIN":
                return self.send_json(403, {
                    "error": "Akses Ditolak (403 Forbidden): Hanya SUPER ADMIN yang memiliki hak akses untuk menyimpan atau mengubah data jaringan FO ke server.",
                    "requiredRole": "SUPER_ADMIN",
                    "currentRole": user.get("role") if user else "GUEST"
                })

            filename = body.get("name", f"project_{int(time.time())}.json")
            if not filename.endswith(".json"):
                filename += ".json"
            file_path = DATA_DIR / filename
            with open(file_path, "w", encoding="utf-8") as f:
                json.dump(body.get("data", body), f, indent=2)

            return self.send_json(200, {"success": True, "filename": filename, "savedBy": user.get("username")})

        return super().do_POST()

if __name__ == "__main__":
    with socketserver.TCPServer(("", PORT), FOMapperHandler) as httpd:
        print("====================================================")
        print(f"🐍 FO Network Mapper Python Server running at http://localhost:{PORT}")
        print("🔒 RBAC Auth: Aktif (SUPER_ADMIN & USER)")
        print("====================================================")
        httpd.serve_forever()
