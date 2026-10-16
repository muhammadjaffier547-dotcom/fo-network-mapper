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
    if (typeof hasWritePermission === 'function' && !hasWritePermission()) {
        alert('Akses Ditolak: Hanya SUPER ADMIN yang dapat merelokasi titik rute kabel.');
        return;
    }
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

        // Event Drag: Relokasi titik secara real-time dengan snap magnetik kuat
        handle.on('drag', function(e) {
            let newPos = [e.latlng.lat, e.latlng.lng];
            if (typeof isSnapToNode !== 'undefined' && isSnapToNode && typeof findNearestNode === 'function') {
                const near = findNearestNode(e.latlng.lat, e.latlng.lng, 45);
                if (near) {
                    newPos = [near.node.lat, near.node.lng];
                    handle.setLatLng(newPos); // Visual snap: marker langsung lompat nempel ke node
                    if (typeof renderSnapIndicator === 'function') {
                        renderSnapIndicator(near.node, near.distance);
                    }
                } else if (typeof clearSnapIndicator === 'function') {
                    clearSnapIndicator();
                }
            }
            cable.points[idx] = newPos;
            if (poly) poly.setLatLngs(cable.points);
            if (typeof cableStreamPolylines !== 'undefined' && cableStreamPolylines[cable.id]) {
                cableStreamPolylines[cable.id].setLatLngs(cable.points);
            }

            // Update kalkulasi jarak real-time
            const rawDist = calculatePolylineDistance(cable.points);
            const totalDist = Math.round(rawDist * (1 + cable.slackPercent / 100));
            document.getElementById('route-editor-dist').innerText = `${totalDist} m`;
        });

        // Event Dragend: Perbarui titik setelah digeser
        handle.on('dragend', function(e) {
            if (typeof clearSnapIndicator === 'function') clearSnapIndicator();
            if (typeof isSnapToNode !== 'undefined' && isSnapToNode && typeof findNearestNode === 'function') {
                const pos = e.target.getLatLng();
                const near = findNearestNode(pos.lat, pos.lng, 45);
                if (near) {
                    const exactPos = [near.node.lat, near.node.lng];
                    cable.points[idx] = exactPos;
                    handle.setLatLng(exactPos);
                    if (idx === 0) {
                        cable.fromBuilding = near.node.name;
                    } else if (idx === cable.points.length - 1) {
                        cable.toBuilding = near.node.name;
                    }
                    if (typeof showToast === 'function') {
                        showToast(`🧲 Titik #${idx + 1} otomatis nempel ke "${near.node.name}"!`);
                    }
                }
            }
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
            let newPos = [e.latlng.lat, e.latlng.lng];
            if (typeof isSnapToNode !== 'undefined' && isSnapToNode && typeof findNearestNode === 'function') {
                const near = findNearestNode(e.latlng.lat, e.latlng.lng, 45);
                if (near) {
                    newPos = [near.node.lat, near.node.lng];
                    midHandle.setLatLng(newPos);
                    if (typeof renderSnapIndicator === 'function') {
                        renderSnapIndicator(near.node, near.distance);
                    }
                } else if (typeof clearSnapIndicator === 'function') {
                    clearSnapIndicator();
                }
            }
            cable.points[insertIndex] = newPos;
            if (poly) poly.setLatLngs(cable.points);
            updateCableDistance(cable);
        });

        midHandle.on('dragend', function(e) {
            if (typeof clearSnapIndicator === 'function') clearSnapIndicator();
            if (typeof isSnapToNode !== 'undefined' && isSnapToNode && typeof findNearestNode === 'function') {
                const pos = e.target.getLatLng();
                const near = findNearestNode(pos.lat, pos.lng, 45);
                if (near) {
                    cable.points[insertIndex] = [near.node.lat, near.node.lng];
                    if (typeof showToast === 'function') {
                        showToast(`🧲 Titik baru otomatis nempel ke "${near.node.name}"!`);
                    }
                }
            }
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

    if (typeof cableStreamPolylines !== 'undefined' && cableStreamPolylines[cable.id]) {
        cableStreamPolylines[cable.id].setLatLngs(cable.points);
    }
}

/**
 * Bersihkan semua marker edit dari peta
 */
function clearRouteHandles() {
    cableEditHandles.forEach(h => map.removeLayer(h));
    cableEditHandles = [];
    cableMidpointHandles.forEach(h => map.removeLayer(h));
    cableMidpointHandles = [];
    if (typeof clearSnapIndicator === 'function') clearSnapIndicator();
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

/**
 * Mengoptimalkan rute kabel yang sedang diedit:
 * 1. Menghapus titik duplikat / bertumpuk (< 0.5 meter)
 * 2. Menempelkan otomatis ujung awal & akhir ke gedung terdekat (radius hingga 45m)
 * 3. Menempelkan titik tengah yang dekat gedung/node (radius hingga 35m)
 * 4. Memperbarui nama gedung asal / tujuan serta jarak kabel
 */
function optimizeCurrentCableRoute() {
    if (!editingCableId) {
        if (typeof showToast === 'function') showToast('ℹ️ Pilih jalur yang ingin diedit terlebih dahulu.');
        return;
    }
    const cable = cables.find(c => c.id === editingCableId);
    if (!cable || !cable.points || cable.points.length < 2) return;

    let pts = cable.points;
    const initialCount = pts.length;
    let modified = false;
    let snappedNodes = [];

    // 1. Bersihkan duplikat berurutan
    let cleanPts = [];
    for (let i = 0; i < pts.length; i++) {
        if (cleanPts.length === 0) {
            cleanPts.push(pts[i]);
            continue;
        }
        const last = cleanPts[cleanPts.length - 1];
        const dist = (typeof map !== 'undefined' && map)
            ? map.distance(L.latLng(last[0], last[1]), L.latLng(pts[i][0], pts[i][1]))
            : 10;
        if (dist > 0.4) {
            cleanPts.push(pts[i]);
        } else {
            modified = true;
        }
    }

    // 2. Snap Ujung Awal & Akhir ke Node Terdekat (radius 45m)
    if (typeof findNearestNode === 'function') {
        const startNear = findNearestNode(cleanPts[0][0], cleanPts[0][1], 45);
        if (startNear) {
            cleanPts[0] = [startNear.node.lat, startNear.node.lng];
            cable.fromBuilding = startNear.node.name;
            snappedNodes.push(startNear.node.name);
            modified = true;
        }

        const endIdx = cleanPts.length - 1;
        const endNear = findNearestNode(cleanPts[endIdx][0], cleanPts[endIdx][1], 45);
        if (endNear) {
            cleanPts[endIdx] = [endNear.node.lat, endNear.node.lng];
            cable.toBuilding = endNear.node.name;
            snappedNodes.push(endNear.node.name);
            modified = true;
        }

        // 3. Snap titik tengah jika sangat dekat dengan node (< 35m)
        for (let i = 1; i < cleanPts.length - 1; i++) {
            const midNear = findNearestNode(cleanPts[i][0], cleanPts[i][1], 35);
            if (midNear) {
                cleanPts[i] = [midNear.node.lat, midNear.node.lng];
                if (!snappedNodes.includes(midNear.node.name)) {
                    snappedNodes.push(midNear.node.name);
                }
                modified = true;
            }
        }
    }

    // 4. Bersihkan duplikat lagi setelah snapping (jika ada titik yang nempel ke node sama)
    let finalPts = [];
    for (let i = 0; i < cleanPts.length; i++) {
        if (finalPts.length === 0) {
            finalPts.push(cleanPts[i]);
            continue;
        }
        const last = finalPts[finalPts.length - 1];
        const dist = (typeof map !== 'undefined' && map)
            ? map.distance(L.latLng(last[0], last[1]), L.latLng(cleanPts[i][0], cleanPts[i][1]))
            : 10;
        if (dist > 0.4) {
            finalPts.push(cleanPts[i]);
        }
    }

    cable.points = finalPts;
    updateCableDistance(cable);

    const poly = cablePolylines[cable.id];
    if (poly) poly.setLatLngs(cable.points);
    if (typeof cableStreamPolylines !== 'undefined' && cableStreamPolylines[cable.id]) {
        cableStreamPolylines[cable.id].setLatLngs(cable.points);
    }

    renderRouteHandles();

    const targets = snappedNodes.length > 0 ? Array.from(new Set(snappedNodes)).join(' & ') : 'titik rute';
    const dupCount = initialCount - finalPts.length;
    if (typeof showToast === 'function') {
        showToast(`✨ Jalur "${cable.name}" dioptimasi! Titik nempel ke ${targets}${dupCount > 0 ? ` (${dupCount} titik duplikat dibersihkan)` : ''}.`);
    }

    if (typeof logActivity === 'function') {
        logActivity('cable_update', `Optimalin Rute: ${cable.name}`, `Menempelkan titik ke ${targets}${dupCount > 0 ? `, hapus ${dupCount} duplikat` : ''}`);
    }
}

if (typeof window !== 'undefined') {
    window.startEditingCableRoute = startEditingCableRoute;
    window.finishEditingCableRoute = finishEditingCableRoute;
    window.renderRouteHandles = renderRouteHandles;
    window.deleteSpecificVertex = deleteSpecificVertex;
    window.continueDrawingFromRouteEditor = continueDrawingFromRouteEditor;
    window.optimizeCurrentCableRoute = optimizeCurrentCableRoute;
}


