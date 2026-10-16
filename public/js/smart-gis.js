/**
 * FO Network Mapper - Smart GIS Module
 * Mendukung:
 * 1. Snap-to-Roads (Auto-routing jalan raya via OSRM)
 * 2. Magnetic Node/Building Snapping (Otomatis menyambungkan kabel jika dekat titik gedung/node)
 * 3. Auto-Snap loose ends & visual magnetic ring indicators
 */

let isSnapToRoad = false;
let isSnapToNode = true; // Default ON: kabel otomatis menempel jika dekat titik gedung
let isFetchingRoute = false;
const SNAP_NODE_THRESHOLD_METERS = 45; // Radius magnetik 45 meter (responsif & akurat)
let snapIndicatorLayer = null;

// --- 1. FITUR SNAP-TO-ROADS (OTOMATIS IKUTI JALAN RAYA) ---
function toggleSnapToRoad() {
    isSnapToRoad = !isSnapToRoad;
    const btn = document.getElementById('btn-toggle-snap-road');
    if (btn) {
        if (isSnapToRoad) {
            btn.className = "px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-600 text-white border border-emerald-500 shadow-lg flex items-center gap-1.5 transition";
            btn.innerHTML = '<i class="fa-solid fa-road"></i> Snap Jalan: <b>ON</b>';
            if (typeof showToast === 'function') {
                showToast('🛣️ Snap-to-Roads Aktif: Rute kabel akan otomatis meliuk mengikuti jalan raya.');
            }
        } else {
            btn.className = "px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-800/90 hover:bg-slate-700 text-slate-200 border border-slate-700/80 shadow-lg backdrop-blur flex items-center gap-1.5 transition";
            btn.innerHTML = '<i class="fa-solid fa-road text-amber-400"></i> Snap Jalan: <b>OFF</b>';
            if (typeof showToast === 'function') {
                showToast('Mode Manual: Garis lurus antar titik.');
            }
        }
    }
}

// --- 2. FITUR AUTO-SNAP GEDUNG / TITIK (MAGNETIK KE TITIK TERDEKAT) ---
function toggleSnapToNode() {
    isSnapToNode = !isSnapToNode;
    updateSnapNodeButtonUI();
    if (isSnapToNode) {
        if (typeof showToast === 'function') {
            showToast('🧲 Auto-Snap Gedung: ON. Titik kabel otomatis nempel ke gedung terdekat (radius 45m).');
        }
    } else {
        clearSnapIndicator();
        if (typeof showToast === 'function') {
            showToast('Mode Bebas: Auto-Snap Gedung dinonaktifkan.');
        }
    }
}

function updateSnapNodeButtonUI() {
    const btn = document.getElementById('btn-toggle-snap-node');
    if (!btn) return;
    if (isSnapToNode) {
        btn.className = "px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-600 text-white border border-emerald-500 shadow-lg flex items-center gap-1.5 transition";
        btn.innerHTML = '<i class="fa-solid fa-magnet text-emerald-200"></i> <span class="hidden sm:inline">Snap Gedung: <b>ON</b></span><span class="sm:hidden font-bold">Snap</span>';
    } else {
        btn.className = "px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-800/90 hover:bg-slate-700 text-slate-200 border border-slate-700/80 shadow-lg backdrop-blur flex items-center gap-1.5 transition";
        btn.innerHTML = '<i class="fa-solid fa-magnet text-amber-400"></i> <span class="hidden sm:inline">Snap Gedung: <b>OFF</b></span><span class="sm:hidden font-bold">Snap</span>';
    }
}

/**
 * Mencari node/gedung terdekat dari koordinat lat, lng dalam batas maxDistanceMeters
 */
function findNearestNode(lat, lng, maxDistanceMeters = SNAP_NODE_THRESHOLD_METERS) {
    const list = (typeof nodes !== 'undefined' && Array.isArray(nodes))
        ? nodes
        : ((typeof window.nodes !== 'undefined' && Array.isArray(window.nodes)) ? window.nodes : []);
    if (!list || list.length === 0 || typeof map === 'undefined' || !map) return null;

    let closest = null;
    let minDist = Infinity;
    const targetLatLng = L.latLng(lat, lng);

    for (const n of list) {
        if (typeof n.lat !== 'number' || typeof n.lng !== 'number') continue;
        const nodeLatLng = L.latLng(n.lat, n.lng);
        const dist = map.distance(targetLatLng, nodeLatLng);
        if (dist <= maxDistanceMeters && dist < minDist) {
            minDist = dist;
            closest = { node: n, distance: dist };
        }
    }
    return closest;
}

/**
 * Menampilkan ring indikator magnetik visual saat kursor / titik mendekati suatu gedung
 */
function renderSnapIndicator(node, distance) {
    if (typeof map === 'undefined' || !map) return;
    clearSnapIndicator();

    const safeName = (typeof escapeHtml === 'function') ? escapeHtml(node.name) : node.name;
    const typeLabel = node.type ? `[${node.type}] ` : '';
    const icon = L.divIcon({
        className: 'snap-indicator-wrapper',
        html: `
            <div class="snap-target-ring"></div>
            <div class="snap-target-pill">
                <i class="fa-solid fa-magnet text-emerald-300"></i>
                <span>Nempel: <b>${typeLabel}${safeName}</b> (${Math.round(distance)}m)</span>
            </div>
        `,
        iconSize: [44, 44],
        iconAnchor: [22, 22]
    });

    snapIndicatorLayer = L.marker([node.lat, node.lng], {
        icon,
        interactive: false,
        zIndexOffset: 1500
    }).addTo(map);
}

function clearSnapIndicator() {
    if (snapIndicatorLayer && typeof map !== 'undefined' && map) {
        map.removeLayer(snapIndicatorLayer);
        snapIndicatorLayer = null;
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

/**
 * Handler terpadu untuk klik pada peta saat menggambar kabel FO:
 * - Jika dekat gedung (<= 30m) & isSnapToNode aktif -> Otomatis SNAP ke koordinat gedung
 * - Jika isSnapToRoad aktif -> Otomatis meliuk mengikuti jalan raya ke target
 * - Mengisi otomatis dropdown Gedung Asal / Tujuan
 */
async function handleCableMapClickWithSnap(lat, lng, forcedNode = null) {
    if (isFetchingRoute) return;

    let targetLat = lat;
    let targetLng = lng;
    let snappedNode = forcedNode;

    if (!snappedNode && isSnapToNode) {
        const nearest = findNearestNode(lat, lng, SNAP_NODE_THRESHOLD_METERS);
        if (nearest) {
            targetLat = nearest.node.lat;
            targetLng = nearest.node.lng;
            snappedNode = nearest.node;
        }
    }

    clearSnapIndicator();

    // Auto-update field Asal / Tujuan jika snap ke gedung
    if (snappedNode) {
        if (typeof activeCablePoints !== 'undefined' && activeCablePoints.length === 0) {
            const fromEl = document.getElementById('cable-from-building');
            if (fromEl) fromEl.value = snappedNode.name;
            const powerEl = document.getElementById('cable-power-source');
            if (powerEl && !powerEl.value) powerEl.value = 'Power dari ' + snappedNode.name;
            if (typeof showToast === 'function') {
                showToast(`🧲 Titik awal otomatis menempel ke "${snappedNode.name}"!`);
            }
        } else {
            const toEl = document.getElementById('cable-to-building');
            if (toEl) toEl.value = snappedNode.name;
            if (typeof showToast === 'function') {
                showToast(`🧲 Kabel otomatis tersambung ke "${snappedNode.name}"!`);
            }
        }
    }

    if (!isSnapToRoad || typeof activeCablePoints === 'undefined' || activeCablePoints.length === 0) {
        if (typeof addPointToActiveCable === 'function') {
            addPointToActiveCable([targetLat, targetLng]);
        }
        return;
    }

    const prevPoint = activeCablePoints[activeCablePoints.length - 1];
    isFetchingRoute = true;
    if (typeof showToast === 'function' && !snappedNode) {
        showToast('🛣️ Mengikuti lekukan jalan raya...', 1200);
    }

    try {
        const roadPoints = await fetchRoadGeometry(prevPoint, [targetLat, targetLng]);
        if (roadPoints && roadPoints.length > 1) {
            // Pastikan titik akhir persis di targetLat, targetLng (gedung)
            roadPoints[roadPoints.length - 1] = [targetLat, targetLng];
            for (let i = 1; i < roadPoints.length; i++) {
                addPointToActiveCable(roadPoints[i]);
            }
        } else {
            addPointToActiveCable([targetLat, targetLng]);
        }
    } catch (e) {
        addPointToActiveCable([targetLat, targetLng]);
    } finally {
        isFetchingRoute = false;
    }
}

/**
 * Fitur Sambungkan Otomatis ke Gedung Terdekat untuk Kabel yang Sudah Ada:
 * Memeriksa titik ujung awal & titik ujung akhir kabel.
 * Jika berjarak <= maxDistance meter dari titik gedung/node, otomatis ditempelkan!
 */
function autoSnapCableEndpoints(cableId, maxDistance = 35) {
    if (typeof hasWritePermission === 'function' && !hasWritePermission()) {
        alert('Akses Ditolak: Diperlukan hak akses Admin atau Super Admin untuk mengedit kabel.');
        return false;
    }
    const cableList = (typeof cables !== 'undefined') ? cables : (window.cables || []);
    const cable = cableList.find(c => c.id === cableId);
    if (!cable || !cable.points || cable.points.length < 2) {
        if (typeof showToast === 'function') showToast('⚠️ Data kabel tidak valid.');
        return false;
    }

    let modified = false;
    const pStart = cable.points[0];
    const pEnd = cable.points[cable.points.length - 1];

    const nearStart = findNearestNode(pStart[0], pStart[1], maxDistance);
    if (nearStart) {
        const d = map.distance(L.latLng(pStart[0], pStart[1]), L.latLng(nearStart.node.lat, nearStart.node.lng));
        if (d > 0.05) {
            cable.points[0] = [nearStart.node.lat, nearStart.node.lng];
            cable.fromBuilding = nearStart.node.name;
            modified = true;
        }
    }

    const nearEnd = findNearestNode(pEnd[0], pEnd[1], maxDistance);
    if (nearEnd) {
        const d = map.distance(L.latLng(pEnd[0], pEnd[1]), L.latLng(nearEnd.node.lat, nearEnd.node.lng));
        if (d > 0.05) {
            cable.points[cable.points.length - 1] = [nearEnd.node.lat, nearEnd.node.lng];
            cable.toBuilding = nearEnd.node.name;
            modified = true;
        }
    }

    if (modified) {
        const rawDist = calculatePolylineDistance(cable.points);
        cable.rawDistance = Math.round(rawDist);
        cable.totalDistance = Math.round(rawDist * (1 + (cable.slackPercent || 0) / 100));

        if (typeof cablePolylines !== 'undefined' && cablePolylines[cable.id]) {
            cablePolylines[cable.id].setLatLngs(cable.points);
        }
        if (typeof cableStreamPolylines !== 'undefined' && cableStreamPolylines[cable.id]) {
            cableStreamPolylines[cable.id].setLatLngs(cable.points);
        }

        if (typeof saveAndRefresh === 'function') {
            saveAndRefresh();
        }

        if (typeof logActivity === 'function') {
            logActivity('cable_update', `Auto-Snap Kabel ke Gedung: ${cable.name}`, `Menghubungkan ujung kabel ke ${nearStart?.node?.name || ''} & ${nearEnd?.node?.name || ''}`);
        }

        const targets = [nearStart?.node?.name, nearEnd?.node?.name].filter(Boolean).join(' & ');
        if (typeof showToast === 'function') {
            showToast(`🧲 Berhasil! Ujung kabel "${cable.name}" otomatis disambungkan ke ${targets}.`);
        }
        if (typeof map !== 'undefined' && map) map.closePopup();
        return true;
    } else {
        if (typeof showToast === 'function') {
            showToast(`ℹ️ Ujung kabel sudah terhubung atau tidak ditemukan gedung dalam radius ${maxDistance}m.`);
        }
        return false;
    }
}

/**
 * Shortcut untuk tombol "Auto-Snap Gedung" di Route Editor Banner
 */
function autoSnapCurrentEditingCable() {
    if (typeof optimizeCurrentCableRoute === 'function') {
        optimizeCurrentCableRoute();
    } else if (typeof editingCableId !== 'undefined' && editingCableId) {
        const ok = autoSnapCableEndpoints(editingCableId, 45);
        if (ok && typeof renderRouteHandles === 'function') {
            renderRouteHandles();
        }
    }
}

/**
 * Menyambungkan semua kabel yang ujungnya menggantung ke gedung terdekat sekaligus
 */
function autoSnapAllCables(maxDistance = 35) {
    if (typeof hasWritePermission === 'function' && !hasWritePermission()) {
        alert('Akses Ditolak: Diperlukan hak akses Admin atau Super Admin.');
        return;
    }
    const cableList = (typeof cables !== 'undefined') ? cables : (window.cables || []);
    let count = 0;
    cableList.forEach(c => {
        if (!c.points || c.points.length < 2) return;
        const pStart = c.points[0];
        const pEnd = c.points[c.points.length - 1];
        let mod = false;

        const nearStart = findNearestNode(pStart[0], pStart[1], maxDistance);
        if (nearStart) {
            const d = map.distance(L.latLng(pStart[0], pStart[1]), L.latLng(nearStart.node.lat, nearStart.node.lng));
            if (d > 0.05) {
                c.points[0] = [nearStart.node.lat, nearStart.node.lng];
                c.fromBuilding = nearStart.node.name;
                mod = true;
            }
        }

        const nearEnd = findNearestNode(pEnd[0], pEnd[1], maxDistance);
        if (nearEnd) {
            const d = map.distance(L.latLng(pEnd[0], pEnd[1]), L.latLng(nearEnd.node.lat, nearEnd.node.lng));
            if (d > 0.05) {
                c.points[c.points.length - 1] = [nearEnd.node.lat, nearEnd.node.lng];
                c.toBuilding = nearEnd.node.name;
                mod = true;
            }
        }

        if (mod) {
            const rawDist = calculatePolylineDistance(c.points);
            c.rawDistance = Math.round(rawDist);
            c.totalDistance = Math.round(rawDist * (1 + (c.slackPercent || 0) / 100));
            if (typeof cablePolylines !== 'undefined' && cablePolylines[c.id]) {
                cablePolylines[c.id].setLatLngs(c.points);
            }
            if (typeof cableStreamPolylines !== 'undefined' && cableStreamPolylines[c.id]) {
                cableStreamPolylines[c.id].setLatLngs(c.points);
            }
            count++;
        }
    });

    if (count > 0) {
        if (typeof saveAndRefresh === 'function') saveAndRefresh();
        if (typeof showToast === 'function') {
            showToast(`🧲 Sukses! ${count} jalur kabel otomatis tersambung ke gedung terdekat.`);
        }
    } else {
        if (typeof showToast === 'function') {
            showToast('ℹ️ Semua kabel sudah terhubung ke gedung terdekat.');
        }
    }
}

if (typeof window !== 'undefined') {
    window.isSnapToRoad = isSnapToRoad;
    window.isSnapToNode = isSnapToNode;
    window.toggleSnapToRoad = toggleSnapToRoad;
    window.toggleSnapToNode = toggleSnapToNode;
    window.findNearestNode = findNearestNode;
    window.renderSnapIndicator = renderSnapIndicator;
    window.clearSnapIndicator = clearSnapIndicator;
    window.handleCableMapClickWithSnap = handleCableMapClickWithSnap;
    window.autoSnapCableEndpoints = autoSnapCableEndpoints;
    window.autoSnapCurrentEditingCable = autoSnapCurrentEditingCable;
    window.autoSnapAllCables = autoSnapAllCables;
}
