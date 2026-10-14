# FO Network Mapper (GIS Peta Jalur Kabel FO & Fiber Management System)

Aplikasi Web GIS modern & interaktif untuk pemetaan rute jalur kabel Fiber Optic (FO), titik Joint Closure (JB), Handhole (HH), ODP, ODC, POP, dan Tiang, lengkap dengan deskripsi teknis, dokumentasi foto terkompresi, pelacak titik putus OTDR, manajemen 12 warna core TIA/EIA-598, snap-to-roads, dan profil ketinggian kontur.

---

## 📁 Struktur Direktori Proyek

```text
fo-network-mapper/
├── public/
│   ├── css/
│   │   └── style.css            # Custom CSS (Marker, vertex, animasi GPS & OTDR)
│   ├── js/
│   │   ├── vertex-editor.js     # Editor titik jalur (drag relokasi, hapus titik, tambah titik)
│   │   ├── gps-exif.js          # GPS real-time & auto-geotagging dari EXIF foto
│   │   ├── otdr-core.js         # OTDR Fault Locator & 12 Warna Core TIA/EIA-598
│   │   ├── smart-gis.js         # Snap-to-Roads (OSRM) & Profil Ketinggian (Elevation)
│   │   └── app.js               # Core GIS & Leaflet logic
│   └── index.html               # Frontend modular
├── server/
│   ├── node/
│   │   └── server.js            # Backend Server Node.js (Zero Dependency)
│   └── python/
│       └── app.py               # Backend Server Python (Opsional / Siap Pakai)
├── data/                        # Penyimpanan file JSON project
├── uploads/                     # Penyimpanan file foto dokumentasi
├── package.json                 # Konfigurasi npm / node
├── start.bat                    # Shortcut 1-klik jalan di Windows
└── README.md                    # Dokumentasi proyek
```

---

## 🚀 Cara Menjalankan

### Cara 1: Menggunakan file `start.bat` (Paling Mudah)
Cukup klik dua kali file **`start.bat`** di dalam folder ini. Server akan langsung berjalan dan membuka browser secara otomatis di `http://localhost:3000/`.

### Cara 2: Menggunakan Node.js
```powershell
npm start
# Atau:
node server/node/server.js
```
Akses di browser: `http://localhost:3000/`

---

## 🌟 Fitur Unggulan

1. **📍 GPS Real-Time ("Lokasi Saya"):**
   - Deteksi posisi GPS akurat dari perangkat lapangan dengan tombol cepat.
   - Sekali klik langsung mengisi koordinat form titik baru dengan akurasi meter.

2. **📸 Auto-Geotagging Metadata EXIF Foto:**
   - Saat mengupload foto dokumentasi lapangan, sistem otomatis membaca metadata EXIF GPS kamera HP dan memberikan saran koordinat 1-klik.

3. **🎯 OTDR Fault Locator (Pencari Titik Kabel Putus):**
   - Masukkan jarak meter hasil ukur mesin OTDR (dari pangkal atau ujung kabel).
   - Memperhitungkan cadangan/slack kabel (%).
   - Peta langsung memunculkan pin merah tanda bahaya berkedip tepat di koordinat putusnya kabel + link langsung rute Google Maps navigasi.

4. **🎨 Manajemen 12 Warna Tube & Core (Standar TIA/EIA-598):**
   - Visualisasi grid core sesuai kode warna internasional (Biru, Oranye, Hijau, Coklat, Abu-abu, Putih, Merah, Hitam, Kuning, Ungu, Pink, Toska).
   - Catatan splicing per core dan status: 🟢 Aktif / 🟡 Idle / 🔴 Putus / 🔵 Cadangan.

5. **🛣️ Snap-to-Roads (Otomatis Mengikuti Jalan Raya):**
   - Mode cerdas saat menggambar jalur FO: cukup klik 2 titik, garis kabel otomatis meliuk mengikuti jalan raya aspal tanpa perlu klik berulang-ulang.

6. **⛰️ Profil Ketinggian Jalur (Elevation Contour):**
   - Grafik interaktif kurva naik-turun kontur tanah di sepanjang jalur kabel.
   - Statistik elevasi terendah, tertinggi, elevasi gain, dan cursor interaktif yang terhubung langsung ke peta.

7. **✏️ Editor Titik Jalur (Vertex Editing):**
   - Geser titik kabel untuk relokasi.
   - Klik satu titik untuk menghapus sudut tanpa menghapus seluruh jalur.
   - Klik ikon `(+)` di tengah segmen untuk menambah titik lekukan baru.

8. **💾 Penyimpanan & Ekspor:**
   - Otomatis tersimpan di browser tanpa perlu database eksternal rumit.
   - Ekspor ke **KML (Google Earth)**, **CSV (Excel)**, dan backup **JSON**.
