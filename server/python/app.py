"""
FO Network Mapper - Python Backend Service
Jalankan dengan: python app.py
Bisa menggunakan library standar Python (tanpa install library external)
"""
import http.server
import socketserver
import os
import json
from pathlib import Path

PORT = 5000
ROOT_DIR = Path(__file__).resolve().parent.parent.parent
PUBLIC_DIR = ROOT_DIR / "public"
DATA_DIR = ROOT_DIR / "data"
UPLOADS_DIR = ROOT_DIR / "uploads"

DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

class FOMapperHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLIC_DIR), **kwargs)

    def do_GET(self):
        if self.path == "/api/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(b'{"status":"ok","backend":"python"}')
            return

        if self.path == "/api/projects":
            files = [f.name for f in DATA_DIR.glob("*.json")]
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"projects": files}).encode())
            return

        if self.path.startswith("/uploads/"):
            filename = self.path.replace("/uploads/", "")
            file_path = UPLOADS_DIR / filename
            if file_path.exists() and file_path.is_file():
                self.send_response(200)
                self.end_headers()
                with open(file_path, "rb") as f:
                    self.wfile.write(f.read())
                return

        return super().do_GET()

    def do_POST(self):
        if self.path == "/api/projects":
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            try:
                data = json.loads(post_data.decode('utf-8'))
                filename = data.get("name", f"project_{int(os.times().elapsed)}.json")
                if not filename.endswith(".json"):
                    filename += ".json"
                file_path = DATA_DIR / filename
                with open(file_path, "w", encoding="utf-8") as f:
                    json.dump(data.get("data", data), f, indent=2)

                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"success": True, "filename": filename}).encode())
                return
            except Exception as e:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(str(e).encode())
                return

if __name__ == "__main__":
    with socketserver.TCPServer(("", PORT), FOMapperHandler) as httpd:
        print("====================================================")
        print(f"🐍 FO Network Mapper Python Server running at http://localhost:{PORT}")
        print("====================================================")
        httpd.serve_forever()

