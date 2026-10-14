/**
 * FO Network Mapper - GPS & EXIF Auto-Geotagging Module
 * Mendukung GPS Real-Time (Lokasi Saya) & Pembacaan Metadata EXIF Foto
 */

let userLocationMarker = null;
let userAccuracyCircle = null;
let isTrackingGps = false;
let watchGpsId = null;

// --- 1. FITUR GPS REAL-TIME (LOKASI SAYA) ---
function getUserLocation(centerMap = true) {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            alert('Browser Anda tidak mendukung fitur Geolocation / GPS.');
            return reject(new Error('Geolocation not supported'));
        }

        const btn = document.getElementById('btn-gps-my-location');
        if (btn) btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                const accuracy = pos.coords.accuracy || 10;

                renderUserLocationMarker(lat, lng, accuracy, centerMap);

                if (btn) btn.innerHTML = '<i class="fa-solid fa-location-crosshairs text-blue-400"></i>';
                resolve({ lat, lng, accuracy });
            },
            (err) => {
                if (btn) btn.innerHTML = '<i class="fa-solid fa-location-crosshairs"></i>';
                let msg = 'Gagal mengambil lokasi GPS.';
                if (err.code === 1) msg = 'Izin akses lokasi GPS ditolak oleh browser/pengguna.';
                else if (err.code === 2) msg = 'Sinyal GPS / posisi tidak dapat ditentukan.';
                else if (err.code === 3) msg = 'Waktu pengambilan GPS habis (timeout).';
                alert(msg);
                reject(err);
            },
            {
                enableHighAccuracy: true,
                timeout: 12000,
                maximumAge: 5000
            }
        );
    });
}

function renderUserLocationMarker(lat, lng, accuracy, centerMap) {
    if (!map) return;

    if (userLocationMarker) map.removeLayer(userLocationMarker);
    if (userAccuracyCircle) map.removeLayer(userAccuracyCircle);

    // Circle radius akurasi
    userAccuracyCircle = L.circle([lat, lng], {
        radius: accuracy,
        color: '#3b82f6',
        fillColor: '#60a5fa',
        fillOpacity: 0.15,
        weight: 1
    }).addTo(map);

    // Pulse icon
    const gpsIcon = L.divIcon({
        className: 'gps-pulse-container',
        html: `
            <div class="relative flex items-center justify-center w-6 h-6">
                <div class="gps-pulse-ring"></div>
                <div class="gps-pulse-marker"></div>
            </div>
        `,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    });

    userLocationMarker = L.marker([lat, lng], { icon: gpsIcon, zIndexOffset: 1000 }).addTo(map);

    userLocationMarker.bindPopup(`
        <div class="text-xs text-slate-800 space-y-1">
            <div class="font-bold text-blue-600 flex items-center gap-1">
                <i class="fa-solid fa-crosshairs"></i> Lokasi Anda Saat Ini
            </div>
            <div><b>Koordinat:</b> ${lat.toFixed(6)}, ${lng.toFixed(6)}</div>
            <div class="text-slate-500 text-[10px]">Akurasi sinyal GPS: ±${Math.round(accuracy)} meter</div>
            <div class="pt-1 flex gap-1">
                <button onclick="setCoordsToForm(${lat}, ${lng})" class="bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 rounded text-[10px] font-semibold w-full">
                    Gunakan untuk Titik Baru
                </button>
            </div>
        </div>
    `);

    if (centerMap) {
        map.setView([lat, lng], Math.max(map.getZoom(), 17));
    }
}

async function fillCoordsFromGps() {
    const input = document.getElementById('node-coords');
    if (!input) return;

    try {
        const { lat, lng } = await getUserLocation(true);
        input.value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
        showToast(`📍 Koordinat GPS berhasil disalin: ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    } catch (e) {}
}

function setCoordsToForm(lat, lng) {
    const input = document.getElementById('node-coords');
    if (input) {
        input.value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
        showToast(`📍 Koordinat GPS diterapkan ke form input.`);
        switchTab('tab-input');
    }
}

// --- 2. FITUR AUTO-GEOTAGGING DARI EXIF FOTO ---
// Pure JavaScript EXIF reader untuk file JPG/JPEG tanpa dependensi luar
function extractExifGps(file) {
    return new Promise((resolve) => {
        if (!file || !file.type.match(/^image\/jpe?g$/i)) {
            return resolve(null);
        }

        const reader = new FileReader();
        // Baca hanya 128KB awal (APP1 EXIF terletak di awal file)
        const blobSlice = file.slice(0, 131072);

        reader.onload = function(e) {
            try {
                const buffer = new Uint8Array(e.target.result);
                if (buffer.length < 4 || buffer[0] !== 0xFF || buffer[1] !== 0xD8) {
                    return resolve(null);
                }

                let offset = 2;
                let tiffStart = -1;

                while (offset < buffer.length) {
                    if (buffer[offset] !== 0xFF) break;
                    const marker = buffer[offset + 1];

                    // APP1 Marker (Exif)
                    if (marker === 0xE1) {
                        const len = (buffer[offset + 2] << 8) | buffer[offset + 3];
                        // Cek header 'Exif\0\0' (0x45, 0x78, 0x69, 0x66, 0x00, 0x00)
                        if (buffer[offset + 4] === 0x45 && buffer[offset + 5] === 0x78 &&
                            buffer[offset + 6] === 0x69 && buffer[offset + 7] === 0x66 &&
                            buffer[offset + 8] === 0x00 && buffer[offset + 9] === 0x00) {
                            tiffStart = offset + 10;
                            break;
                        }
                        offset += 2 + len;
                    } else if ((marker >= 0xE0 && marker <= 0xEF) || marker === 0xFE || marker === 0xDB || marker === 0xC0 || marker === 0xC4) {
                        const len = (buffer[offset + 2] << 8) | buffer[offset + 3];
                        offset += 2 + len;
                    } else {
                        break;
                    }
                }

                if (tiffStart === -1) return resolve(null);

                const view = new DataView(e.target.result, tiffStart);
                const byteOrder = view.getUint16(0);
                const isLittleEndian = (byteOrder === 0x4949); // 'II'

                const readU16 = (o) => view.getUint16(o, isLittleEndian);
                const readU32 = (o) => view.getUint32(o, isLittleEndian);

                const ifd0Offset = readU32(4);
                const numEntries = readU16(ifd0Offset);
                let gpsOffset = -1;

                for (let i = 0; i < numEntries; i++) {
                    const entryOffset = ifd0Offset + 2 + (i * 12);
                    const tag = readU16(entryOffset);
                    if (tag === 0x8825) { // GPS Info IFD
                        gpsOffset = readU32(entryOffset + 8);
                        break;
                    }
                }

                if (gpsOffset === -1) return resolve(null);

                const numGpsEntries = readU16(gpsOffset);
                let latRef = 'N', lonRef = 'E';
                let latRationals = null, lonRationals = null;

                for (let i = 0; i < numGpsEntries; i++) {
                    const entryOffset = gpsOffset + 2 + (i * 12);
                    const tag = readU16(entryOffset);
                    const valOffset = readU32(entryOffset + 8);

                    if (tag === 0x0001) { // LatRef
                        latRef = String.fromCharCode(view.getUint8(entryOffset + 8));
                    } else if (tag === 0x0003) { // LonRef
                        lonRef = String.fromCharCode(view.getUint8(entryOffset + 8));
                    } else if (tag === 0x0002) { // Latitude (3 rationals)
                        latRationals = [
                            readU32(valOffset) / readU32(valOffset + 4),
                            readU32(valOffset + 8) / readU32(valOffset + 12),
                            readU32(valOffset + 16) / readU32(valOffset + 20)
                        ];
                    } else if (tag === 0x0004) { // Longitude (3 rationals)
                        lonRationals = [
                            readU32(valOffset) / readU32(valOffset + 4),
                            readU32(valOffset + 8) / readU32(valOffset + 12),
                            readU32(valOffset + 16) / readU32(valOffset + 20)
                        ];
                    }
                }

                if (latRationals && lonRationals) {
                    let lat = latRationals[0] + (latRationals[1] / 60) + (latRationals[2] / 3600);
                    let lng = lonRationals[0] + (lonRationals[1] / 60) + (lonRationals[2] / 3600);
                    if (latRef === 'S') lat = -lat;
                    if (lonRef === 'W') lng = -lng;

                    return resolve({
                        lat: parseFloat(lat.toFixed(6)),
                        lng: parseFloat(lng.toFixed(6))
                    });
                }

                resolve(null);
            } catch (err) {
                console.warn('Gagal membaca EXIF GPS:', err);
                resolve(null);
            }
        };

        reader.onerror = () => resolve(null);
        reader.readAsArrayBuffer(blobSlice);
    });
}

// Banner info jika foto terdeteksi memiliki koordinat GPS
function displayPhotoGpsSuggestion(gps, containerId, targetInputId) {
    let container = document.getElementById(containerId);
    if (!container) return;

    let banner = document.getElementById(containerId + '-gps-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = containerId + '-gps-banner';
        banner.className = 'mt-2 p-2.5 bg-emerald-500/20 border border-emerald-500/40 rounded-lg text-emerald-200 text-xs flex items-center justify-between gap-2 shadow';
        container.parentNode.insertBefore(banner, container.nextSibling);
    }

    banner.innerHTML = `
        <div class="flex items-center gap-1.5 overflow-hidden">
            <i class="fa-solid fa-map-location-dot text-emerald-400 text-sm flex-shrink-0"></i>
            <span class="truncate"><b>GPS Foto:</b> ${gps.lat}, ${gps.lng}</span>
        </div>
        <button type="button" onclick="applyPhotoGps('${targetInputId}', ${gps.lat}, ${gps.lng})" class="bg-emerald-600 hover:bg-emerald-500 text-white px-2.5 py-1 rounded text-[11px] font-bold whitespace-nowrap shadow flex-shrink-0">
            <i class="fa-solid fa-check mr-1"></i> Pakai Titik Ini
        </button>
    `;
}

function applyPhotoGps(targetInputId, lat, lng) {
    const input = document.getElementById(targetInputId);
    if (input) {
        input.value = `${lat}, ${lng}`;
        if (map) map.setView([lat, lng], 17);
        showToast(`📍 Koordinat dari foto GPS berhasil diterapkan!`);
    }
}

// Toast Notifikasi Ringan
function showToast(msg, duration = 3000) {
    let toast = document.getElementById('app-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'app-toast';
        toast.className = 'fixed bottom-5 right-5 z-[9999] bg-slate-900 border border-slate-700 text-white px-4 py-2.5 rounded-xl shadow-2xl text-xs font-medium flex items-center gap-2 transform transition-all duration-300 opacity-0 translate-y-3 pointer-events-none';
        document.body.appendChild(toast);
    }

    toast.innerHTML = msg;
    toast.classList.remove('opacity-0', 'translate-y-3', 'pointer-events-none');
    toast.classList.add('opacity-100', 'translate-y-0');

    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
        toast.classList.remove('opacity-100', 'translate-y-0');
        toast.classList.add('opacity-0', 'translate-y-3', 'pointer-events-none');
    }, duration);
}

