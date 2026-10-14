/**
 * FO Network Mapper - Smart GIS Module
 * Mendukung Snap-to-Roads (Auto-routing jalan via OSRM)
 */

let isSnapToRoad = false;
let isFetchingRoute = false;

// --- 1. FITUR SNAP-TO-ROADS (OTOMATIS IKUTI JALAN RAYA) ---
function toggleSnapToRoad() {
    isSnapToRoad = !isSnapToRoad;
    const btn = document.getElementById('btn-toggle-snap-road');
    if (btn) {
        if (isSnapToRoad) {
            btn.className = "px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-600 text-white border border-emerald-500 shadow-lg flex items-center gap-1.5 transition";
            btn.innerHTML = '<i class="fa-solid fa-road"></i> Snap Jalan: <b>ON</b>';
            showToast('🛣️ Snap-to-Roads Aktif: Rute kabel akan otomatis meliuk mengikuti jalan raya.');
        } else {
            btn.className = "px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-800/90 hover:bg-slate-700 text-slate-200 border border-slate-700/80 shadow-lg backdrop-blur flex items-center gap-1.5 transition";
            btn.innerHTML = '<i class="fa-solid fa-road text-amber-400"></i> Snap Jalan: <b>OFF</b>';
            showToast('Mode Manual: Garis lurus antar titik.');
        }
    }
}

// Mengambil geometri jalan raya dari OSRM Routing Engine
async function fetchRoadGeometry(p1, p2) {
    const url = `https://router.project-osrm.org/route/v1/driving/${p1[1]},${p1[0]};${p2[1]},${p2[0]}?overview=full&geometries=geojson`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!response.ok) throw new Error('OSRM status not OK');
        const data = await response.json();

        if (data.routes && data.routes.length > 0 && data.routes[0].geometry) {
            // Konversi OSRM GeoJSON [lng, lat] ke Leaflet [lat, lng]
            return data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
        }
    } catch (err) {
        console.warn('Gagal mengambil rute OSRM:', err);
    }
    // Fallback garis lurus
    return [p1, p2];
}

// Hook integrasi ke fungsi klik peta saat menggambar rute kabel
async function handleCableMapClickWithSnap(lat, lng) {
    if (isFetchingRoute) return;

    if (!isSnapToRoad || activeCablePoints.length === 0) {
        addPointToActiveCable([lat, lng]);
        return;
    }

    const prevPoint = activeCablePoints[activeCablePoints.length - 1];
    isFetchingRoute = true;
    showToast('🛣️ Mengikuti lekukan jalan raya...', 1500);

    try {
        const roadPoints = await fetchRoadGeometry(prevPoint, [lat, lng]);
        if (roadPoints && roadPoints.length > 1) {
            // Lewati titik pertama karena sama dengan prevPoint
            for (let i = 1; i < roadPoints.length; i++) {
                addPointToActiveCable(roadPoints[i]);
            }
        } else {
            addPointToActiveCable([lat, lng]);
        }
    } catch (e) {
        addPointToActiveCable([lat, lng]);
    } finally {
        isFetchingRoute = false;
    }
}
