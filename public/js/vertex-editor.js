/**
 * FO Network Mapper - Vertex & Route Editor Module
 * Mengelola relokasi (drag), hapus titik individu (vertex), dan tambah titik baru pada jalur kabel FO
 */

let editingCableId = null;
let originalCablePoints = null;
let cableEditHandles = [];
let cableMidpointHandles = [];

/**
 * Mulai mode edit titik / rute untuk jalur kabel tertentu
 */
function startEditingCableRoute(cableId) {
    const cable = cables.find(c => c.id === cableId);
    if (!cable) return;

    // Jika sedang mengedit rute lain, simpan dulu
    if (editingCableId && editingCableId !== cableId) {
        finishEditingCableRoute(true);
    }

    editingCableId = cableId;
    originalCablePoints = JSON.parse(JSON.stringify(cable.points));

    // Tutup popup agar tidak menghalangi
    map.closePopup();

    // Tampilkan Banner Edit Rute di bagian atas peta
    const banner = document.getElementById('route-editor-banner');
    if (banner) {
        document.getElementById('route-editor-name').innerText = cable.name;
        document.getElementById('route-editor-dist').innerText = `${cable.totalDistance} m`;
        banner.classList.remove('hidden');
    }

    // Ubah styling garis kabel agar terlihat sedang aktif diedit
    const poly = cablePolylines[cable.id];
    if (poly) {
        poly.setStyle({
            dashArray: '8, 8',
            weight: 7,
            opacity: 1
        });
        map.fitBounds(poly.getBounds(), { padding: [60, 60] });
    }

    renderRouteHandles();
}

/**
 * Render semua titik sudut (vertex handles) dan titik tengah (midpoint handles)
 */
function renderRouteHandles() {
    clearRouteHandles();

    const cable = cables.find(c => c.id === editingCableId);
    if (!cable) return;

    const poly = cablePolylines[cable.id];

    // 1. Render Titik Sudut (Vertex Handles)
    cable.points.forEach((pt, idx) => {
        const handle = L.marker(pt, {
            draggable: true,
            icon: L.divIcon({
                className: 'cable-vertex-handle',
                html: `<div class="vertex-dot" title="Titik #${idx + 1} - Geser untuk Relokasi | Klik untuk Hapus Titik">${idx + 1}</div>`,
                iconSize: [22, 22],
                iconAnchor: [11, 11]
            })
        }).addTo(map);

        // Event Drag: Relokasi titik secara real-time
        handle.on('drag', function(e) {
            const newPos = [e.latlng.lat, e.latlng.lng];
            cable.points[idx] = newPos;
            if (poly) poly.setLatLngs(cable.points);

            // Update kalkulasi jarak real-time
            const rawDist = calculatePolylineDistance(cable.points);
            const totalDist = Math.round(rawDist * (1 + cable.slackPercent / 100));
            document.getElementById('route-editor-dist').innerText = `${totalDist} m`;
        });

        // Event Dragend: Perbarui titik tengah setelah digeser
        handle.on('dragend', function() {
            updateCableDistance(cable);
            renderRouteHandles();
        });

        // Event Klik: Hapus titik sudut spesifik ini
        handle.on('click', function(e) {
            L.DomEvent.stopPropagation(e);
            deleteSpecificVertex(idx);
        });

        // Event Klik Kanan: Hapus titik sudut
        handle.on('contextmenu', function(e) {
            L.DomEvent.stopPropagation(e);
            deleteSpecificVertex(idx);
        });

        cableEditHandles.push(handle);
    });

    // 2. Render Titik Tengah (Midpoint Handles) untuk menyisipkan titik baru
    for (let i = 0; i < cable.points.length - 1; i++) {
        const p1 = cable.points[i];
        const p2 = cable.points[i + 1];
        const midLat = (p1[0] + p2[0]) / 2;
        const midLng = (p1[1] + p2[1]) / 2;

        const midHandle = L.marker([midLat, midLng], {
            draggable: true,
            icon: L.divIcon({
                className: 'cable-midpoint-handle',
                html: `<div class="midpoint-dot" title="Klik / Geser untuk tambah titik baru di sini">+</div>`,
                iconSize: [14, 14],
                iconAnchor: [7, 7]
            })
        }).addTo(map);

        const insertIndex = i + 1;

        // Saat titik tengah digeser atau diklik, sisipkan titik baru di posisi tersebut
        midHandle.on('dragstart', function(e) {
            const newPoint = [e.latlng.lat, e.latlng.lng];
            cable.points.splice(insertIndex, 0, newPoint);
            if (poly) poly.setLatLngs(cable.points);
        });

        midHandle.on('drag', function(e) {
            cable.points[insertIndex] = [e.latlng.lat, e.latlng.lng];
            if (poly) poly.setLatLngs(cable.points);
            updateCableDistance(cable);
        });

        midHandle.on('dragend', function() {
            updateCableDistance(cable);
            renderRouteHandles();
        });

        midHandle.on('click', function(e) {
            L.DomEvent.stopPropagation(e);
            const newPoint = [midLat, midLng];
            cable.points.splice(insertIndex, 0, newPoint);
            if (poly) poly.setLatLngs(cable.points);
            updateCableDistance(cable);
            renderRouteHandles();
        });

        cableMidpointHandles.push(midHandle);
    }
}

/**
 * Hapus titik sudut tertentu pada indeks index
 */
function deleteSpecificVertex(index) {
    const cable = cables.find(c => c.id === editingCableId);
    if (!cable) return;

    if (cable.points.length <= 2) {
        alert('Jalur FO minimal harus memiliki 2 titik (titik awal dan akhir).\nJika ingin menghapus seluruh jalur, gunakan tombol "Hapus Jalur".');
        return;
    }

    if (!confirm(`Hapus titik #${index + 1} dari jalur "${cable.name}"?`)) {
        return;
    }

    cable.points.splice(index, 1);
    const poly = cablePolylines[cable.id];
    if (poly) poly.setLatLngs(cable.points);

    updateCableDistance(cable);
    renderRouteHandles();
}

/**
 * Helper kalkulasi dan update jarak kabel
 */
function updateCableDistance(cable) {
    const rawDist = calculatePolylineDistance(cable.points);
    cable.rawDistance = Math.round(rawDist);
    cable.totalDistance = Math.round(rawDist * (1 + cable.slackPercent / 100));

    const distEl = document.getElementById('route-editor-dist');
    if (distEl) distEl.innerText = `${cable.totalDistance} m`;
}

/**
 * Bersihkan semua marker edit dari peta
 */
function clearRouteHandles() {
    cableEditHandles.forEach(h => map.removeLayer(h));
    cableEditHandles = [];
    cableMidpointHandles.forEach(h => map.removeLayer(h));
    cableMidpointHandles = [];
}

/**
 * Selesai mode edit titik / rute (Simpan atau Batalkan)
 */
function finishEditingCableRoute(saveChanges = true) {
    if (!editingCableId) return;

    const cable = cables.find(c => c.id === editingCableId);
    if (cable) {
        if (!saveChanges && originalCablePoints) {
            cable.points = originalCablePoints;
            updateCableDistance(cable);
        }

        // Kembalikan styling polyline normal
        const poly = cablePolylines[cable.id];
        if (poly) {
            poly.setLatLngs(cable.points);
            poly.setStyle({
                dashArray: null,
                weight: 6,
                opacity: 0.95
            });
        }

        renderCablePolyline(cable);
    }

    clearRouteHandles();
    editingCableId = null;
    originalCablePoints = null;

    const banner = document.getElementById('route-editor-banner');
    if (banner) banner.classList.add('hidden');

    saveAndRefresh();
}

/**
 * Pindah langsung dari mode edit rute ke mode sambung/lanjutkan tarikan kabel
 */
function continueDrawingFromRouteEditor() {
    if (!editingCableId) return;
    const cid = editingCableId;
    finishEditingCableRoute(true);
    if (typeof continueDrawingCable === 'function') {
        continueDrawingCable(cid);
    }
}


