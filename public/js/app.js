/**
 * FO Network Mapper - Main Application Logic
 * GIS Pemetaan Rute Kabel Fiber Optic, Closure, ODP, ODC, POP & Tiang
 */

// --- 1. INISIALISASI PETA DENGAN LAYER MAPS ---
const googleStreets = L.tileLayer('https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
    maxZoom: 21,
    subdomains: ['0', '1', '2', '3'],
    attribution: '&copy; Google Maps'
});

const googleHybrid = L.tileLayer('https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
    maxZoom: 21,
    subdomains: ['0', '1', '2', '3'],
    attribution: '&copy; Google Maps Satellite'
});

const esriSatellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: '&copy; Esri &mdash; World Imagery'
});

const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
});

// Batas Wilayah Negara Kesatuan Republik Indonesia (Sabang sampai Merauke)
const INDONESIA_BOUNDS = L.latLngBounds(
    [-11.5, 94.5], // Barat Daya (Rote / Samudera Hindia)
    [6.5, 141.5]   // Timur Laut (Miangas / Merauke Papua)
);

const map = L.map('map', {
    center: [-6.200000, 106.816666], // Default Jakarta Pusat
    zoom: 14,
    minZoom: 5,                      // Batasi zoom out terjauh: sebatas wilayah Indonesia
    maxZoom: 20,                     // Detail hingga level atap gedung/tiang
    maxBounds: INDONESIA_BOUNDS,     // Mengunci peta agar tidak bisa digeser ke luar negeri
    maxBoundsViscosity: 1.0,         // Rigid/kaku (1.0) memantul kembali jika digeser keluar
    layers: [googleHybrid]
});

L.control.layers({
    "Google Maps Satelit (Hybrid)": googleHybrid,
    "Google Maps Jalan (Street)": googleStreets,
    "Esri Satelit (Alternatif)": esriSatellite,
    "OpenStreetMap": osmLayer
}, null, { position: 'topright' }).addTo(map);

// Pastikan ukuran peta terhitung dengan benar
setTimeout(() => { map.invalidateSize(); }, 300);
window.addEventListener('resize', () => { map.invalidateSize(); });

// --- 2. STATE APLIKASI ---
let currentMode = 'pan'; // 'pan', 'node', 'cable', 'delete'
let nodes = [];
let cables = [];
let nodeMarkers = {};
let cablePolylines = {};

// State untuk foto form input sidebar
let pendingNodePhotos = [];
let pendingCablePhotos = [];

// State untuk modal edit
let currentEditingType = null; // 'node' | 'cable'
let currentEditingId = null;
let editingPhotos = [];

// State untuk menggambar kabel aktif
let activeCablePoints = [];
let tempPolyline = null;
let tempVertices = [];
let extendingCableId = null;
let extendingOriginalPoints = null;

const nodeStyleMap = {
    'Gedung':   { bg: '#d97706', icon: 'fa-building-circle-bolt', label: 'Gedung / Titik Power' },
    'Closure':  { bg: '#ef4444', icon: 'fa-box-archive', label: 'Joint Closure (JB)' },
    'Handhole': { bg: '#8b5cf6', icon: 'fa-cube', label: 'Handhole (HH) / Manhole' },
    'ODP':      { bg: '#3b82f6', icon: 'fa-network-wired', label: 'ODP' },
    'ODC':      { bg: '#f97316', icon: 'fa-server', label: 'ODC' },
    'POP':      { bg: '#10b981', icon: 'fa-building-shield', label: 'POP / Server' },
    'Tiang':    { bg: '#64748b', icon: 'fa-up-long', label: 'Tiang Tumpu' }
};

// State pengelompokan & filter Tab 2
let nodeGroupFilter = 'ALL';
let nodeGroupSearch = '';
let cableGroupSearch = '';
let collapsedNodeGroups = {};
let collapsedCableGroups = {};
let collapsedBuildingCards = {};
let collapsedSections = {
    'nodes': false,
    'buildings': false,
    'cables': false
};

function toggleDataSection(sectionId) {
    collapsedSections[sectionId] = !collapsedSections[sectionId];
    const contentEl = document.getElementById(`section-content-${sectionId}`);
    const iconEl = document.getElementById(`section-icon-${sectionId}`);
    if (contentEl) {
        if (collapsedSections[sectionId]) {
            contentEl.classList.add('hidden');
        } else {
            contentEl.classList.remove('hidden');
        }
    }
    if (iconEl) {
        iconEl.style.transform = collapsedSections[sectionId] ? 'rotate(-90deg)' : 'rotate(0deg)';
    }
}

function toggleNodeGroup(type) {
    collapsedNodeGroups[type] = !collapsedNodeGroups[type];
    updateUI();
}

function toggleCableGroup(spec) {
    collapsedCableGroups[spec] = !collapsedCableGroups[spec];
    updateUI();
}

function toggleBuildingCard(bName) {
    collapsedBuildingCards[bName] = !collapsedBuildingCards[bName];
    updateUI();
}

function filterNodeGroup(type) {
    nodeGroupFilter = type;
    updateUI();
}

function searchNodeGroup(query) {
    nodeGroupSearch = (query || '').toLowerCase().trim();
    updateUI();
}

function searchCableGroup(query) {
    cableGroupSearch = (query || '').toLowerCase().trim();
    updateUI();
}

// --- HELPER FUNGSI FOTO, ESCAPE, JARAK & LIGHTBOX ---
function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
    if (typeof map !== 'undefined' && map && map.distance) {
        return map.distance([lat1, lon1], [lat2, lon2]);
    }
    const R = 6371e3;
    const rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad;
    const dLon = (lon2 - lon1) * rad;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * rad) * Math.cos(lat2 * rad) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, function(m) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
}

function compressImage(file, maxWidth = 900, quality = 0.75) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

async function handleNodePhotoUpload(event) {
    if (typeof hasWritePermission === 'function' && !hasWritePermission()) {
        alert('Akses Ditolak: Diperlukan hak akses Admin atau Super Admin untuk dapat mengunggah foto dokumentasi.');
        event.target.value = '';
        return;
    }
    const files = Array.from(event.target.files);
    for (const f of files) {
        if (!f.type.startsWith('image/')) continue;

        // Auto-Geotagging: Periksa metadata EXIF GPS bawaan foto
        if (typeof extractExifGps === 'function') {
            const gps = await extractExifGps(f);
            if (gps) {
                displayPhotoGpsSuggestion(gps, 'node-photo-preview', 'node-coords');
                const coordInput = document.getElementById('node-coords');
                if (coordInput && !coordInput.value.trim()) {
                    coordInput.value = `${gps.lat}, ${gps.lng}`;
                    if (map) map.setView([gps.lat, gps.lng], 17);
                    showToast(`📍 Koordinat GPS dari foto otomatis diterapkan: ${gps.lat}, ${gps.lng}`);
                }
            }
        }

        // Kompres gambar terlebih dahulu
        const compressed = await compressImage(f);

        // Simpan base64 sementara di preview (untuk tampilkan instan)
        // Saat simpan node, akan di-upload ke GitHub Repo otomatis
        pendingNodePhotos.push({ dataUrl: compressed, uploaded: false, url: null });
    }
    renderPendingNodePhotos();
    event.target.value = '';
}

function renderPendingNodePhotos() {
    const countEl = document.getElementById('node-photo-count');
    if (countEl) countEl.innerText = `${pendingNodePhotos.length} foto`;
    const previewEl = document.getElementById('node-photo-preview');
    if (!previewEl) return;
    previewEl.innerHTML = pendingNodePhotos.map((photo, idx) => {
        const src = (typeof photo === 'string') ? photo : (photo.url || photo.dataUrl || photo);
        const isUploading = (typeof photo === 'object' && photo.uploaded === false && photo.url);
        return `
        <div class="relative group w-12 h-12 rounded-lg overflow-hidden border border-slate-700 bg-slate-800">
            <img src="${src}" class="w-full h-full object-cover cursor-pointer" onclick="openLightbox('${src}', 'Foto Titik (Baru)')">
            ${isUploading ? '<div class="absolute inset-0 bg-black/50 flex items-center justify-center"><i class="fa-solid fa-cloud-arrow-up text-white text-xs animate-pulse"></i></div>' : ''}
            <button onclick="removePendingNodePhoto(${idx})" class="absolute top-0.5 right-0.5 bg-red-600 hover:bg-red-500 text-white w-4 h-4 rounded-full flex items-center justify-center text-[10px] shadow">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>
    `;
    }).join('');
}

function removePendingNodePhoto(idx) {
    pendingNodePhotos.splice(idx, 1);
    renderPendingNodePhotos();
}

async function handleCablePhotoUpload(event) {
    if (typeof hasWritePermission === 'function' && !hasWritePermission()) {
        alert('Akses Ditolak: Diperlukan hak akses Admin atau Super Admin untuk dapat mengunggah foto dokumentasi.');
        event.target.value = '';
        return;
    }
    const files = Array.from(event.target.files);
    for (const f of files) {
        if (!f.type.startsWith('image/')) continue;
        const compressed = await compressImage(f);
        pendingCablePhotos.push({ dataUrl: compressed, uploaded: false, url: null });
    }
    renderPendingCablePhotos();
    event.target.value = '';
}

function renderPendingCablePhotos() {
    const countEl = document.getElementById('cable-photo-count');
    if (countEl) countEl.innerText = `${pendingCablePhotos.length} foto`;
    const previewEl = document.getElementById('cable-photo-preview');
    if (!previewEl) return;
    previewEl.innerHTML = pendingCablePhotos.map((photo, idx) => {
        const src = (typeof photo === 'string') ? photo : (photo.url || photo.dataUrl || photo);
        return `
        <div class="relative group w-12 h-12 rounded-lg overflow-hidden border border-slate-700 bg-slate-800">
            <img src="${src}" class="w-full h-full object-cover cursor-pointer" onclick="openLightbox('${src}', 'Foto Jalur (Baru)')">
            <button onclick="removePendingCablePhoto(${idx})" class="absolute top-0.5 right-0.5 bg-red-600 hover:bg-red-500 text-white w-4 h-4 rounded-full flex items-center justify-center text-[10px] shadow">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>
    `;
    }).join('');
}

function removePendingCablePhoto(idx) {
    pendingCablePhotos.splice(idx, 1);
    renderPendingCablePhotos();
}

function openLightbox(src, caption = '') {
    const modal = document.getElementById('modal-lightbox');
    const img = document.getElementById('lightbox-img');
    const cap = document.getElementById('lightbox-caption');
    img.src = src;
    cap.innerText = caption;
    modal.classList.remove('hidden');
}

function closeLightbox() {
    const modal = document.getElementById('modal-lightbox');
    modal.classList.add('hidden');
    document.getElementById('lightbox-img').src = '';
}

function renderPhotoThumbnails(photos, title = '') {
    if (!photos || photos.length === 0) return '';
    return `
        <div class="pt-1.5 border-t border-slate-200">
            <div class="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1">
                <i class="fa-solid fa-camera text-blue-600"></i> Dokumentasi Foto (${photos.length})
            </div>
            <div class="flex gap-1.5 overflow-x-auto py-1">
                ${photos.map((photo, idx) => {
                    // Support old base64 strings dan new URL format
                    const src = (typeof photo === 'string') ? photo : (photo.url || photo.dataUrl || '');
                    if (!src) return '';
                    const escapedTitle = escapeHtml(title);
                    return `<img src="${src}" alt="Foto ${idx+1}" onclick="openLightbox('${src}', '${escapedTitle} - Dokumentasi Foto ${idx+1}')" class="w-12 h-12 rounded-lg object-cover border border-slate-300 hover:border-blue-500 cursor-pointer shadow-sm hover:scale-105 transition flex-shrink-0" loading="lazy">`;
                }).join('')}
            </div>
        </div>
    `;
}

// --- 3. MODE & INTERAKSI ---
function setMode(mode) {
    if (currentMode === 'cable' && mode !== 'cable') {
        if (activeCablePoints.length > 1) {
            finishDrawingCable();
        } else {
            resetTempCable();
        }
    }

    currentMode = mode;
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.className = "mode-btn py-2 px-1 rounded-lg text-[11px] font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 flex flex-col items-center gap-1 border border-slate-600";
    });

    const activeBtn = document.getElementById(`btn-mode-${mode}`);
    if (activeBtn) {
        if (mode === 'delete') {
            activeBtn.className = "mode-btn py-2 px-1 rounded-lg text-[11px] font-medium bg-red-600 text-white flex flex-col items-center gap-1 border border-red-500 shadow";
        } else {
            activeBtn.className = "mode-btn py-2 px-1 rounded-lg text-[11px] font-medium bg-blue-600 text-white flex flex-col items-center gap-1 border border-blue-500 shadow";
        }
    }

    const drawingBanner = document.getElementById('drawing-banner');
    const deleteBanner = document.getElementById('delete-banner');

    if (mode === 'cable') {
        drawingBanner.classList.remove('hidden');
        if (deleteBanner) deleteBanner.classList.add('hidden');
        map.getContainer().style.cursor = 'crosshair';
        updateDrawingBanner();
    } else if (mode === 'delete') {
        if (drawingBanner) drawingBanner.classList.add('hidden');
        if (deleteBanner) deleteBanner.classList.remove('hidden');
        map.getContainer().style.cursor = 'not-allowed';
    } else if (mode === 'node') {
        if (drawingBanner) drawingBanner.classList.add('hidden');
        if (deleteBanner) deleteBanner.classList.add('hidden');
        map.getContainer().style.cursor = 'pointer';
    } else {
        if (drawingBanner) drawingBanner.classList.add('hidden');
        if (deleteBanner) deleteBanner.classList.add('hidden');
        map.getContainer().style.cursor = '';
    }
}

function updateDrawingBanner() {
    const countEl = document.getElementById('active-point-count');
    if (countEl) {
        const rawDist = activeCablePoints.length >= 2 ? Math.round(calculatePolylineDistance(activeCablePoints)) : 0;
        countEl.innerText = `${activeCablePoints.length} titik (${rawDist} m)`;
    }
}

function undoLastCablePoint() {
    if (activeCablePoints.length === 0) return;
    if (extendingCableId && extendingOriginalPoints && activeCablePoints.length <= extendingOriginalPoints.length) {
        if (typeof showToast === 'function') {
            showToast('⚠️ Sudah mencapai titik awal kabel sebelumnya.');
        }
        return;
    }
    activeCablePoints.pop();
    const lastVertex = tempVertices.pop();
    if (lastVertex) map.removeLayer(lastVertex);
    if (tempPolyline) {
        tempPolyline.setLatLngs(activeCablePoints);
    }
    updateDrawingBanner();
}

function cancelDrawingCable() {
    if (extendingCableId) {
        const cable = cables.find(c => c.id === extendingCableId);
        if (cable && extendingOriginalPoints) {
            cable.points = [...extendingOriginalPoints];
            const rawDist = calculatePolylineDistance(cable.points);
            cable.rawDistance = Math.round(rawDist);
            cable.totalDistance = Math.round(rawDist * (1 + cable.slackPercent / 100));
            renderCablePolyline(cable);
        }
        extendingCableId = null;
        extendingOriginalPoints = null;
        const bannerTitle = document.getElementById('drawing-banner-title');
        if (bannerTitle) {
            bannerTitle.innerHTML = '<i class="fa-solid fa-route mr-1"></i> Klik titik/peta untuk rute FO';
        }
        if (typeof showToast === 'function') showToast('Tarikan sambungan kabel dibatalkan.');
    }
    resetTempCable();
    setMode('pan');
}

/**
 * Memulai tarikan kabel baru langsung dari suatu titik/gedung
 */
function startCableFromNode(nodeId) {
    if (typeof hasWritePermission === 'function' && !hasWritePermission()) {
        alert('Akses Ditolak: Diperlukan hak akses Admin atau Super Admin untuk dapat menarik jalur FO.');
        return;
    }
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    if (typeof finishEditingCableRoute === 'function') {
        finishEditingCableRoute(false);
    }
    if (extendingCableId) {
        cancelDrawingCable();
    } else {
        resetTempCable();
    }

    setMode('cable');
    switchTab('tab-input');

    const fromEl = document.getElementById('cable-from-building');
    if (fromEl) fromEl.value = node.name;

    const powerEl = document.getElementById('cable-power-source');
    if (powerEl && !powerEl.value) {
        powerEl.value = 'Power dari Gedung Asal';
    }

    addPointToActiveCable(node.lat, node.lng);
    map.setView([node.lat, node.lng], 18);

    if (typeof showToast === 'function') {
        showToast(`🏢 Tarikan kabel dimulai dari "${node.name}". Klik rute jalan atau gedung tujuan.`);
    }
}

/**
 * Melanjutkan / menyambung tarikan jalur FO yang sudah ada dari titik ujungnya
 */
function continueDrawingCable(cableId) {
    if (typeof hasWritePermission === 'function' && !hasWritePermission()) {
        alert('Akses Ditolak: Diperlukan hak akses Admin atau Super Admin untuk dapat menyambung atau mengedit jalur.');
        return;
    }
    const cable = cables.find(c => c.id === cableId);
    if (!cable || !cable.points || cable.points.length === 0) return;

    if (typeof finishEditingCableRoute === 'function') {
        finishEditingCableRoute(true);
    }
    if (extendingCableId && extendingCableId !== cableId) {
        cancelDrawingCable();
    } else {
        resetTempCable();
    }

    extendingCableId = cable.id;
    extendingOriginalPoints = JSON.parse(JSON.stringify(cable.points));

    if (cablePolylines[cable.id]) {
        map.removeLayer(cablePolylines[cable.id]);
    }

    setMode('cable');
    switchTab('tab-input');

    const nameEl = document.getElementById('cable-name');
    if (nameEl) nameEl.value = cable.name;

    const fromEl = document.getElementById('cable-from-building');
    if (fromEl) fromEl.value = cable.fromBuilding || '';

    const toEl = document.getElementById('cable-to-building');
    if (toEl) toEl.value = cable.toBuilding || '';

    const powerSourceEl = document.getElementById('cable-power-source');
    if (powerSourceEl) powerSourceEl.value = cable.powerSource || 'Power dari Gedung Asal';

    const powerNotesEl = document.getElementById('cable-power-notes');
    if (powerNotesEl) powerNotesEl.value = cable.powerNotes || '';

    const descEl = document.getElementById('cable-desc');
    if (descEl) descEl.value = cable.description || '';

    const slackEl = document.getElementById('cable-slack');
    if (slackEl) slackEl.value = cable.slackPercent || 10;

    activeCablePoints = [...cable.points];

    tempPolyline = L.polyline(activeCablePoints, {
        color: cable.color || '#f59e0b',
        weight: 6,
        dashArray: '6, 6'
    }).addTo(map);

    const firstPt = activeCablePoints[0];
    const startMarker = L.circleMarker(firstPt, {
        radius: 6,
        color: '#fff',
        fillColor: '#3b82f6',
        fillOpacity: 1
    }).addTo(map);
    tempVertices.push(startMarker);

    const lastPt = activeCablePoints[activeCablePoints.length - 1];
    const endMarker = L.circleMarker(lastPt, {
        radius: 7,
        color: '#fff',
        fillColor: '#10b981',
        fillOpacity: 1
    }).addTo(map);
    tempVertices.push(endMarker);

    const bannerTitle = document.getElementById('drawing-banner-title');
    if (bannerTitle) {
        bannerTitle.innerHTML = `<i class="fa-solid fa-link text-emerald-400 mr-1"></i> Menyambung: <b class="text-white">${escapeHtml(cable.name)}</b>`;
    }
    updateDrawingBanner();

    map.setView(lastPt, 18);

    if (typeof showToast === 'function') {
        showToast(`🔗 Melanjutkan "${cable.name}". Silakan klik peta/jalan untuk menyambung.`);
    }
}

/**
 * Handle klik pada marker titik/gedung saat dalam mode penarikan kabel
 */
function handleNodeClickInCableMode(node) {
    if (activeCablePoints.length === 0) {
        const fromEl = document.getElementById('cable-from-building');
        if (fromEl) fromEl.value = node.name;
        const powerEl = document.getElementById('cable-power-source');
        if (powerEl && !powerEl.value) powerEl.value = 'Power dari Gedung Asal';

        addPointToActiveCable(node.lat, node.lng);
        if (typeof showToast === 'function') {
            showToast(`🏢 Titik awal kabel: ${node.name}`);
        }
    } else {
        const toEl = document.getElementById('cable-to-building');
        if (toEl) toEl.value = node.name;

        if (typeof handleCableMapClickWithSnap === 'function' && typeof isSnapToRoad !== 'undefined' && isSnapToRoad) {
            handleCableMapClickWithSnap(node.lat, node.lng);
        } else {
            addPointToActiveCable(node.lat, node.lng);
        }
        if (typeof showToast === 'function') {
            showToast(`🏢 Kabel tersambung ke: ${node.name}`);
        }
    }
}

map.on('click', function(e) {
    const { lat, lng } = e.latlng;
    document.getElementById('node-coords').value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

    if (currentMode === 'node') {
        createNode(lat, lng);
    } else if (currentMode === 'cable') {
        if (typeof handleCableMapClickWithSnap === 'function') {
            handleCableMapClickWithSnap(lat, lng);
        } else {
            addPointToActiveCable(lat, lng);
        }
    }
});

map.on('mousemove', function(e) {
    if (currentMode !== 'cable') {
        if (typeof clearSnapIndicator === 'function') clearSnapIndicator();
        return;
    }
    if (typeof isSnapToNode !== 'undefined' && isSnapToNode && typeof findNearestNode === 'function') {
        const near = findNearestNode(e.latlng.lat, e.latlng.lng, 30);
        if (near) {
            if (typeof renderSnapIndicator === 'function') {
                renderSnapIndicator(near.node, near.distance);
            }
        } else {
            if (typeof clearSnapIndicator === 'function') {
                clearSnapIndicator();
            }
        }
    }
});

map.on('mouseout', function() {
    if (typeof clearSnapIndicator === 'function') clearSnapIndicator();
});

// --- 4. MANAJEMEN TITIK (CLOSURE / ODP / DLL) ---
function createNode(lat, lng, customName = null, customType = null, customNote = null, customDesc = null, customPhotos = null) {
    if (typeof hasWritePermission === 'function' && !hasWritePermission()) {
        alert('Akses Ditolak: Diperlukan hak akses Admin atau Super Admin untuk dapat menambah titik.');
        return;
    }
    const type = customType || document.getElementById('node-type').value;
    const autoNumber = nodes.filter(n => n.type === type).length + 1;
    const nameInput = document.getElementById('node-name').value.trim();
    const name = customName || nameInput || `${type}-${String(autoNumber).padStart(2, '0')}`;
    const note = customNote !== null ? customNote : (document.getElementById('node-note').value.trim() || '-');
    const description = customDesc !== null ? customDesc : (document.getElementById('node-desc').value.trim() || '');
    const rawPhotos = customPhotos !== null ? customPhotos : [...pendingNodePhotos];

    const newNode = {
        id: 'node_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        name,
        type,
        note,
        description,
        photos: [], // will be filled after upload
        lat: parseFloat(lat),
        lng: parseFloat(lng)
    };

    nodes.push(newNode);
    renderNodeMarker(newNode);
    if (typeof logActivity === 'function') {
        logActivity('node_create', `Tambah Titik: ${newNode.name}`, `Tipe: ${newNode.type} • Koordinat: ${newNode.lat.toFixed(5)}, ${newNode.lng.toFixed(5)}`);
    }
    document.getElementById('node-name').value = '';
    document.getElementById('node-desc').value = '';
    pendingNodePhotos = [];
    renderPendingNodePhotos();

    // Upload foto ke GitHub Repo (Opsi 1: Kapasitas 1-5 GB)
    uploadPhotosAndSave(rawPhotos, newNode, 'node');
}

function addNodeFromInput() {
    const rawCoords = document.getElementById('node-coords').value.trim();
    const parts = rawCoords.split(/[,\s]+/);
    if (parts.length < 2) {
        alert('Masukkan format koordinat yang benar, contoh: -6.2088, 106.8456');
        return;
    }
    const lat = parseFloat(parts[0]);
    const lng = parseFloat(parts[1]);
    if (isNaN(lat) || isNaN(lng)) {
        alert('Koordinat harus berupa angka.');
        return;
    }
    createNode(lat, lng);
    map.setView([lat, lng], 18);
}

function getNodePopupHtml(node) {
    if (!node) return '';
    const canWrite = typeof hasWritePermission === 'function' ? hasWritePermission() : false;
    const style = nodeStyleMap[node.type] || nodeStyleMap['Closure'];

    const descHtml = node.description ? `
        <div class="bg-slate-100 p-2 rounded-lg text-slate-700 text-[11px] leading-relaxed border border-slate-200">
            <b>Deskripsi:</b><br>${escapeHtml(node.description).replace(/\n/g, '<br>')}
        </div>
    ` : '';

    const photoHtml = renderPhotoThumbnails(node.photos, node.name);

    const spliceCount = (node.splices && Array.isArray(node.splices)) ? node.splices.length : 0;
    const spliceBtnHtml = `
        <button onclick="openNodeSplicingModal('${node.id}')" title="Buka Tabel Sambungan Core & Splicing Tray" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-1.5 px-2 rounded-lg text-xs flex items-center justify-center gap-1.5 shadow transition">
            <i class="fa-solid fa-arrows-split-up-and-left"></i>
            <span>Tabel Splicing Core ${spliceCount > 0 ? `(${spliceCount})` : ''}</span>
        </button>
    `;

    const actionSectionHtml = canWrite ? `
        <div class="pt-1.5 border-t border-slate-200 flex flex-col gap-1.5">
            <button onclick="startCableFromNode('${node.id}')" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-1.5 px-2 rounded-lg text-xs flex items-center justify-center gap-1.5 shadow transition">
                <i class="fa-solid fa-route"></i> + Tarik Jalur FO dari Titik Ini
            </button>
            ${spliceBtnHtml}
            <div class="flex items-center justify-between gap-1 pt-1 border-t border-slate-100">
                <button onclick="openEditNodeModal('${node.id}')" class="text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-1">
                    <i class="fa-solid fa-pen-to-square"></i> Edit
                </button>
                <a href="https://www.google.com/maps?q=${node.lat},${node.lng}" target="_blank" class="text-emerald-600 hover:text-emerald-700 font-semibold flex items-center gap-1">
                    <i class="fa-solid fa-arrow-up-right-from-square"></i> G-Maps
                </a>
                <button onclick="deleteNode('${node.id}')" class="text-red-600 hover:text-red-700 font-semibold flex items-center gap-1">
                    <i class="fa-solid fa-trash"></i> Hapus
                </button>
            </div>
        </div>
    ` : `
        <div class="pt-1.5 border-t border-slate-200 flex flex-col gap-1.5">
            ${spliceBtnHtml}
            <div class="flex items-center justify-between pt-1 border-t border-slate-100">
                <span class="text-[10px] text-slate-500 italic flex items-center gap-1"><i class="fa-solid fa-lock"></i> Read-Only</span>
                <a href="https://www.google.com/maps?q=${node.lat},${node.lng}" target="_blank" class="text-emerald-600 hover:text-emerald-700 font-semibold flex items-center gap-1 text-xs">
                    <i class="fa-solid fa-arrow-up-right-from-square"></i> Buka Google Maps
                </a>
            </div>
        </div>
    `;

    return `
        <div class="text-slate-800 text-xs space-y-2 min-w-[210px] max-w-[280px]">
            <div class="flex items-center justify-between border-b pb-1.5">
                <span class="font-bold text-sm text-slate-900">${escapeHtml(node.name)}</span>
                <span class="px-2 py-0.5 rounded text-[10px] font-semibold text-white shadow-sm" style="background:${style.bg}">${node.type}</span>
            </div>
            <div class="space-y-1 text-slate-600">
                <div><b>Keterangan:</b> ${escapeHtml(node.note || '-')}</div>
                <div><b>Koordinat:</b> ${node.lat.toFixed(6)}, ${node.lng.toFixed(6)}</div>
            </div>
            ${descHtml}
            ${photoHtml}
            ${actionSectionHtml}
        </div>
    `;
}

function renderNodeMarker(node) {
    if (nodeMarkers[node.id]) {
        map.removeLayer(nodeMarkers[node.id]);
        delete nodeMarkers[node.id];
    }

    const style = nodeStyleMap[node.type] || nodeStyleMap['Closure'];
    const icon = L.divIcon({
        className: '',
        html: `<div class="custom-marker" style="width:28px;height:28px;background:${style.bg};" title="${escapeHtml(node.name)}">
                 <i class="fa-solid ${style.icon}"></i>
               </div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
    });

    const canWrite = typeof hasWritePermission === 'function' ? hasWritePermission() : false;
    const marker = L.marker([node.lat, node.lng], { icon, draggable: canWrite }).addTo(map);

    // Dynamic Leaflet Popup: Callback dievaluasi setiap kali marker diklik agar role selalu akurat
    marker.bindPopup(function() {
        return getNodePopupHtml(node);
    });

    // Klik marker
    marker.on('click', function(e) {
        if (currentMode === 'delete') {
            if (typeof hasWritePermission === 'function' && !hasWritePermission()) return;
            L.DomEvent.stopPropagation(e);
            deleteNode(node.id);
        } else if (currentMode === 'cable') {
            if (typeof hasWritePermission === 'function' && !hasWritePermission()) return;
            L.DomEvent.stopPropagation(e);
            handleNodeClickInCableMode(node);
        }
    });

    // Klik kanan langsung hapus titik (hanya Super Admin)
    marker.on('contextmenu', function(e) {
        if (typeof hasWritePermission === 'function' && !hasWritePermission()) return;
        L.DomEvent.stopPropagation(e);
        deleteNode(node.id);
    });

    marker.on('dragend', function(e) {
        if (typeof hasWritePermission === 'function' && !hasWritePermission()) return;
        const oldLat = node.lat;
        const oldLng = node.lng;
        const pos = e.target.getLatLng();
        node.lat = pos.lat;
        node.lng = pos.lng;

        // Auto-update rute kabel yang tersambung ke titik ini agar tetap menempel
        let updatedCablesCount = 0;
        if (Array.isArray(cables)) {
            cables.forEach(c => {
                if (!c.points || c.points.length < 2) return;
                let cModified = false;
                const pFirst = c.points[0];
                const pLast = c.points[c.points.length - 1];

                if (c.fromBuilding === node.name || (Math.abs(pFirst[0] - oldLat) < 0.00015 && Math.abs(pFirst[1] - oldLng) < 0.00015)) {
                    c.points[0] = [node.lat, node.lng];
                    c.fromBuilding = node.name;
                    cModified = true;
                }
                if (c.toBuilding === node.name || (Math.abs(pLast[0] - oldLat) < 0.00015 && Math.abs(pLast[1] - oldLng) < 0.00015)) {
                    c.points[c.points.length - 1] = [node.lat, node.lng];
                    c.toBuilding = node.name;
                    cModified = true;
                }
                if (cModified) {
                    const rawDist = calculatePolylineDistance(c.points);
                    c.rawDistance = Math.round(rawDist);
                    c.totalDistance = Math.round(rawDist * (1 + (c.slackPercent || 0) / 100));
                    if (cablePolylines && cablePolylines[c.id]) {
                        cablePolylines[c.id].setLatLngs(c.points);
                    }
                    updatedCablesCount++;
                }
            });
        }

        if (updatedCablesCount > 0 && typeof showToast === 'function') {
            showToast(`🧲 ${updatedCablesCount} rute kabel otomatis ikut menempel ke posisi baru "${node.name}".`);
        }

        saveAndRefresh();
    });

    nodeMarkers[node.id] = marker;
}

function deleteNode(id, confirmAsk = true) {
    if (typeof hasWritePermission === 'function' && !hasWritePermission()) {
        alert('Akses Ditolak: Diperlukan hak akses Admin atau Super Admin untuk dapat menghapus titik.');
        return;
    }
    const node = nodes.find(n => n.id === id);
    if (!node) return;
    if (confirmAsk && !confirm(`Yakin ingin menghapus titik "${node.name}" (${node.type})?`)) {
        return;
    }
    nodes = nodes.filter(n => n.id !== id);
    if (nodeMarkers[id]) {
        map.removeLayer(nodeMarkers[id]);
        delete nodeMarkers[id];
    }
    if (typeof logActivity === 'function') {
        logActivity('node_delete', `Hapus Titik: ${node.name}`, `Tipe: ${node.type} • Koordinat: ${node.lat.toFixed(5)}, ${node.lng.toFixed(5)}`);
    }
    saveAndRefresh();
}

// --- 5. MANAJEMEN JALUR KABEL FO ---
function addPointToActiveCable(latOrPt, maybeLng) {
    let lat, lng;
    if (Array.isArray(latOrPt)) {
        lat = latOrPt[0];
        lng = latOrPt[1];
    } else {
        lat = latOrPt;
        lng = maybeLng;
    }
    activeCablePoints.push([lat, lng]);

    const vertex = L.circleMarker([lat, lng], {
        radius: 5,
        color: '#fff',
        fillColor: '#f59e0b',
        fillOpacity: 1
    }).addTo(map);
    tempVertices.push(vertex);

    if (tempPolyline) {
        tempPolyline.setLatLngs(activeCablePoints);
    } else {
        tempPolyline = L.polyline(activeCablePoints, {
            color: '#f59e0b',
            weight: 5,
            dashArray: '6, 6'
        }).addTo(map);
    }
    updateDrawingBanner();
}

function finishDrawingCable() {
    if (typeof hasWritePermission === 'function' && !hasWritePermission()) {
        alert('Akses Ditolak: Diperlukan hak akses Admin atau Super Admin untuk dapat membuat atau mengedit rute kabel.');
        resetTempCable();
        return;
    }

    if (activeCablePoints.length < 2) {
        resetTempCable();
        return;
    }

    // Auto-Snap kedua ujung kabel jika berada dekat titik gedung (<= 35m)
    if (typeof isSnapToNode !== 'undefined' && isSnapToNode && typeof findNearestNode === 'function') {
        const pStart = activeCablePoints[0];
        const nearStart = findNearestNode(pStart[0], pStart[1], 35);
        if (nearStart) {
            activeCablePoints[0] = [nearStart.node.lat, nearStart.node.lng];
            const fromEl = document.getElementById('cable-from-building');
            if (fromEl && (!fromEl.value || !fromEl.value.trim())) {
                fromEl.value = nearStart.node.name;
            }
        }

        const pEnd = activeCablePoints[activeCablePoints.length - 1];
        const nearEnd = findNearestNode(pEnd[0], pEnd[1], 35);
        if (nearEnd) {
            activeCablePoints[activeCablePoints.length - 1] = [nearEnd.node.lat, nearEnd.node.lng];
            const toEl = document.getElementById('cable-to-building');
            if (toEl && (!toEl.value || !toEl.value.trim())) {
                toEl.value = nearEnd.node.name;
            }
        }
    }
    if (typeof clearSnapIndicator === 'function') clearSnapIndicator();

    if (extendingCableId) {
        const cable = cables.find(c => c.id === extendingCableId);
        if (cable) {
            cable.points = [...activeCablePoints];
            const rawType = document.getElementById('cable-type').value.split('|');
            const nameInput = document.getElementById('cable-name').value.trim();
            if (nameInput) cable.name = nameInput;
            cable.coreSpec = rawType[0];
            cable.color = rawType[1];
            cable.slackPercent = parseFloat(document.getElementById('cable-slack').value) || 0;
            const descInput = document.getElementById('cable-desc').value.trim();
            if (descInput) cable.description = descInput;

            const fromB = (document.getElementById('cable-from-building')?.value || '').trim();
            if (fromB) cable.fromBuilding = fromB;
            const toB = (document.getElementById('cable-to-building')?.value || '').trim();
            if (toB) cable.toBuilding = toB;
            const powerS = (document.getElementById('cable-power-source')?.value || '').trim();
            if (powerS) cable.powerSource = powerS;
            const powerN = (document.getElementById('cable-power-notes')?.value || '').trim();
            if (powerN) cable.powerNotes = powerN;

            if (pendingCablePhotos.length > 0) {
                cable.photos = [...(cable.photos || []), ...pendingCablePhotos];
                pendingCablePhotos = [];
                renderPendingCablePhotos();
            }

            const rawDist = calculatePolylineDistance(cable.points);
            cable.rawDistance = Math.round(rawDist);
            cable.totalDistance = Math.round(rawDist * (1 + cable.slackPercent / 100));

            renderCablePolyline(cable);
            if (typeof logActivity === 'function') {
                logActivity('cable_update', `Sambung Rute Kabel: ${cable.name}`, `Panjang rute baru: ${cable.totalDistance}m (${cable.coreSpec || '24C'})`);
            }
            if (typeof showToast === 'function') {
                showToast(`✅ Jalur "${cable.name}" berhasil disambung! Total panjang baru: ${cable.totalDistance}m.`);
            }
        }

        extendingCableId = null;
        extendingOriginalPoints = null;
        const bannerTitle = document.getElementById('drawing-banner-title');
        if (bannerTitle) bannerTitle.innerHTML = '<i class="fa-solid fa-route mr-1"></i> Klik titik/peta untuk rute FO';

        document.getElementById('cable-name').value = '';
        document.getElementById('cable-desc').value = '';
        if (document.getElementById('cable-from-building')) document.getElementById('cable-from-building').value = '';
        if (document.getElementById('cable-to-building')) document.getElementById('cable-to-building').value = '';
        if (document.getElementById('cable-power-notes')) document.getElementById('cable-power-notes').value = '';
        resetTempCable();
        saveAndRefresh();
        setMode('pan');
        return;
    }

    const rawType = document.getElementById('cable-type').value.split('|');
    const coreSpec = rawType[0];
    const color = rawType[1];
    const slackPercent = parseFloat(document.getElementById('cable-slack').value) || 0;
    const autoNumber = cables.length + 1;
    const name = document.getElementById('cable-name').value.trim() || `Jalur FO-${String(autoNumber).padStart(2, '0')}`;
    const description = document.getElementById('cable-desc').value.trim() || '';
    const rawPhotos = [...pendingCablePhotos];

    const rawDist = calculatePolylineDistance(activeCablePoints);
    const totalDist = rawDist * (1 + slackPercent / 100);

    const fromBuilding = (document.getElementById('cable-from-building')?.value || '').trim();
    const toBuilding = (document.getElementById('cable-to-building')?.value || '').trim();
    const powerSource = (document.getElementById('cable-power-source')?.value || '').trim();
    const powerNotes = (document.getElementById('cable-power-notes')?.value || '').trim();

    const newCable = {
        id: 'cable_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        name,
        fromBuilding,
        toBuilding,
        powerSource,
        powerNotes,
        coreSpec,
        color,
        slackPercent,
        description,
        photos: [], // will be filled after upload
        rawDistance: Math.round(rawDist),
        totalDistance: Math.round(totalDist),
        points: [...activeCablePoints]
    };

    cables.push(newCable);
    renderCablePolyline(newCable);
    if (typeof logActivity === 'function') {
        logActivity('cable_create', `Tarik Jalur Kabel Baru: ${newCable.name}`, `Panjang: ${newCable.totalDistance}m • Kapasitas: ${newCable.coreSpec || '24C'} • Warna: ${newCable.color}`);
    }
    document.getElementById('cable-name').value = '';
    document.getElementById('cable-desc').value = '';
    if (document.getElementById('cable-from-building')) document.getElementById('cable-from-building').value = '';
    if (document.getElementById('cable-to-building')) document.getElementById('cable-to-building').value = '';
    if (document.getElementById('cable-power-notes')) document.getElementById('cable-power-notes').value = '';
    pendingCablePhotos = [];
    renderPendingCablePhotos();
    resetTempCable();
    setMode('pan');

    // Upload foto ke GitHub Repo (Opsi 1: Kapasitas 1-5 GB)
    uploadPhotosAndSave(rawPhotos, newCable, 'cable');
}

function resetTempCable() {
    activeCablePoints = [];
    if (tempPolyline) {
        map.removeLayer(tempPolyline);
        tempPolyline = null;
    }
    tempVertices.forEach(v => map.removeLayer(v));
    tempVertices = [];
    updateDrawingBanner();
}

function calculatePolylineDistance(pts) {
    let dist = 0;
    for (let i = 0; i < pts.length - 1; i++) {
        dist += map.distance(pts[i], pts[i + 1]);
    }
    return dist;
}

function renderCablePolyline(cable) {
    if (cablePolylines[cable.id]) {
        map.removeLayer(cablePolylines[cable.id]);
        delete cablePolylines[cable.id];
    }

    const poly = L.polyline(cable.points, {
        color: cable.color,
        weight: 6,
        opacity: 0.95
    }).addTo(map);

    // Efek hover agar interaksi jelas
    poly.on('mouseover', function() {
        if (!editingCableId) this.setStyle({ weight: 9, opacity: 1 });
    });
    poly.on('mouseout', function() {
        if (!editingCableId) this.setStyle({ weight: 6, opacity: 0.95 });
    });

    // Klik jalur untuk hapus jika dalam mode delete (hanya Super Admin)
    poly.on('click', function(e) {
        if (currentMode === 'delete') {
            if (typeof hasWritePermission === 'function' && !hasWritePermission()) return;
            L.DomEvent.stopPropagation(e);
            deleteCable(cable.id);
        }
    });

    // Klik kanan langsung konfirmasi hapus jalur (hanya Super Admin)
    poly.on('contextmenu', function(e) {
        if (typeof hasWritePermission === 'function' && !hasWritePermission()) return;
        L.DomEvent.stopPropagation(e);
        deleteCable(cable.id);
    });

    poly.bindPopup(function() {
        return getCablePopupHtml(cable);
    });

    cablePolylines[cable.id] = poly;
}

function getCablePopupHtml(cable) {
    if (!cable) return '';
    const canWrite = typeof hasWritePermission === 'function' ? hasWritePermission() : false;
    const descHtml = cable.description ? `
        <div class="bg-slate-100 p-2 rounded-lg text-slate-700 text-[11px] leading-relaxed border border-slate-200">
            <b>Deskripsi:</b><br>${escapeHtml(cable.description).replace(/\n/g, '<br>')}
        </div>
    ` : '';

    const photoHtml = renderPhotoThumbnails(cable.photos, cable.name);

    const cableActionHtml = canWrite ? `
        <div class="pt-2 border-t border-slate-200 space-y-1.5">
            <button onclick="continueDrawingCable('${cable.id}')" class="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-2.5 py-1.5 rounded-lg text-xs flex items-center justify-center gap-1.5 shadow transition">
                <i class="fa-solid fa-plus-circle"></i> Sambung / Lanjutkan Jalur Ini
            </button>
            <button onclick="startEditingCableRoute('${cable.id}')" class="w-full bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold px-2.5 py-1.5 rounded-lg text-xs flex items-center justify-center gap-1.5 shadow transition">
                <i class="fa-solid fa-bezier-curve"></i> Edit Titik & Relokasi Rute
            </button>
            <button onclick="autoSnapCableEndpoints('${cable.id}')" title="Tempelkan kedua ujung kabel ke titik gedung terdekat (Auto-Connect)" class="w-full bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 font-bold px-2.5 py-1.5 rounded-lg text-xs flex items-center justify-center gap-1.5 shadow-sm transition">
                <i class="fa-solid fa-magnet text-indigo-600"></i> Sambungkan ke Gedung Terdekat
            </button>
            <div class="grid grid-cols-2 gap-1.5">
                <button onclick="openOtdrModal('${cable.id}')" title="Pencari titik kabel putus (OTDR)" class="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 py-1.5 px-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1 shadow-sm">
                    <i class="fa-solid fa-triangle-exclamation"></i> OTDR Fault
                </button>
                <button onclick="openCoreMatrixModal('${cable.id}')" title="Manajemen Tube & 12 Warna Core" class="bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 py-1.5 px-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1 shadow-sm">
                    <i class="fa-solid fa-palette"></i> 12 Core TIA
                </button>
            </div>
            <div class="flex items-center justify-between gap-1 pt-1 border-t border-slate-100">
                <button onclick="openEditCableModal('${cable.id}')" class="text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-1 text-xs">
                    <i class="fa-solid fa-pen-to-square"></i> Edit Info
                </button>
                <button onclick="deleteCable('${cable.id}')" class="text-red-600 hover:text-red-700 font-semibold flex items-center gap-1 text-xs">
                    <i class="fa-solid fa-trash"></i> Hapus Jalur
                </button>
            </div>
        </div>
    ` : `
        <div class="pt-2 border-t border-slate-200 space-y-1.5">
            <div class="grid grid-cols-2 gap-1.5">
                <button onclick="openOtdrModal('${cable.id}')" title="Pencari titik kabel putus (OTDR)" class="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 py-1.5 px-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1 shadow-sm">
                    <i class="fa-solid fa-triangle-exclamation"></i> OTDR Fault
                </button>
                <button onclick="openCoreMatrixModal('${cable.id}')" title="Manajemen Tube & 12 Warna Core" class="bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 py-1.5 px-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1 shadow-sm">
                    <i class="fa-solid fa-palette"></i> 12 Core TIA
                </button>
            </div>
            <div class="flex items-center justify-between pt-1 border-t border-slate-100 text-[10px] text-slate-500">
                <span><i class="fa-solid fa-lock mr-0.5"></i> Read-Only Mode</span>
                <span class="text-emerald-600 font-semibold"><i class="fa-solid fa-circle-check mr-0.5"></i> Monitoring Aktif</span>
            </div>
        </div>
    `;

    return `
        <div class="text-slate-800 text-xs space-y-2 min-w-[230px] max-w-[300px]">
            <div class="flex items-center justify-between border-b pb-1.5">
                <span class="font-bold text-sm text-slate-900">${escapeHtml(cable.name)}</span>
                <span class="px-2 py-0.5 rounded text-[10px] font-semibold text-white shadow-sm" style="background:${cable.color}">${cable.coreSpec}</span>
            </div>
            <div class="space-y-1 text-slate-600">
                <div><b>Jarak Peta:</b> ${cable.rawDistance} meter (${cable.points.length} titik sudut)</div>
                <div><b>Total + Slack (${cable.slackPercent}%):</b> <span class="font-bold text-emerald-700">${cable.totalDistance} meter</span></div>
            </div>
            <!-- Info Rute Gedung & Titik Power -->
            <div class="bg-amber-50 p-2 rounded-lg border border-amber-200 text-slate-800 space-y-1">
                <div class="font-bold text-xs text-amber-900 flex items-center gap-1.5">
                    <i class="fa-solid fa-building-circle-arrow-right text-amber-600"></i>
                    <span>${escapeHtml(cable.fromBuilding || 'Gedung A')} ➔ ${escapeHtml(cable.toBuilding || 'Gedung B')}</span>
                </div>
                <div class="text-[11px] text-slate-700 flex items-center justify-between">
                    <span><b>Titik Power:</b> ${escapeHtml(cable.powerSource || 'Belum diatur')}</span>
                </div>
                ${cable.powerNotes ? `<div class="text-[10px] text-slate-500 italic">Catatan Power: ${escapeHtml(cable.powerNotes)}</div>` : ''}
            </div>

            ${descHtml}
            ${photoHtml}
            
            ${cableActionHtml}
        </div>
    `;
}

function deleteCable(id, confirmAsk = true) {
    if (typeof hasWritePermission === 'function' && !hasWritePermission()) {
        alert('Akses Ditolak: Diperlukan hak akses Admin atau Super Admin untuk dapat menghapus jalur kabel.');
        return;
    }
    const cable = cables.find(c => c.id === id);
    if (!cable) return;
    if (confirmAsk && !confirm(`Yakin ingin menghapus jalur kabel FO "${cable.name}" (${cable.coreSpec}, ${cable.totalDistance}m)?`)) {
        return;
    }
    if (editingCableId === id) {
        finishEditingCableRoute(false);
    }
    cables = cables.filter(c => c.id !== id);
    if (cablePolylines[id]) {
        map.removeLayer(cablePolylines[id]);
        delete cablePolylines[id];
    }
    if (typeof logActivity === 'function') {
        logActivity('cable_delete', `Hapus Jalur Kabel: ${cable.name}`, `Panjang: ${cable.totalDistance}m • Kapasitas: ${cable.coreSpec || '24C'}`);
    }
    saveAndRefresh();
}

function connectAllClosures() {
    if (typeof hasWritePermission === 'function' && !hasWritePermission()) {
        alert('Akses Ditolak: Diperlukan hak akses Admin atau Super Admin untuk dapat menghubungkan titik.');
        return;
    }
    if (nodes.length < 2) {
        alert('Tambahkan minimal 2 titik terlebih dahulu untuk dihubungkan otomatis.');
        return;
    }
    activeCablePoints = nodes.map(n => [n.lat, n.lng]);
    finishDrawingCable();
}

// --- 6. MODAL EDIT DATA (TITIK & KABEL) ---
function openEditNodeModal(id) {
    if (typeof hasWritePermission === 'function' && !hasWritePermission()) {
        alert('Akses Ditolak: Diperlukan hak akses Admin atau Super Admin untuk dapat mengedit data titik.');
        return;
    }
    const node = nodes.find(n => n.id === id);
    if (!node) return;

    currentEditingType = 'node';
    currentEditingId = id;
    editingPhotos = [...(node.photos || [])];

    document.getElementById('modal-edit-icon').className = "w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white text-sm";
    document.getElementById('modal-edit-icon').innerHTML = '<i class="fa-solid fa-location-dot"></i>';
    document.getElementById('modal-edit-title').innerText = `Edit Titik: ${node.name}`;
    document.getElementById('modal-edit-subtitle').innerText = `Koordinat: ${node.lat.toFixed(6)}, ${node.lng.toFixed(6)}`;

    const body = document.getElementById('modal-edit-body');
    body.innerHTML = `
        <div>
            <label class="text-slate-300 block mb-1 font-semibold">Nama Titik / ID</label>
            <input id="edit-node-name" type="text" value="${escapeHtml(node.name)}" class="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-white focus:outline-none focus:border-blue-500">
        </div>
        <div class="grid grid-cols-2 gap-2">
            <div>
                <label class="text-slate-300 block mb-1 font-semibold">Jenis Titik</label>
                <select id="edit-node-type" class="w-full bg-slate-800 border border-slate-600 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-blue-500">
                    <option value="Gedung" ${node.type === 'Gedung' ? 'selected' : ''}>Gedung / Titik Power</option>
                    <option value="Closure" ${node.type === 'Closure' ? 'selected' : ''}>Joint Closure (JB)</option>
                    <option value="Handhole" ${node.type === 'Handhole' ? 'selected' : ''}>Handhole (HH) / Manhole</option>
                    <option value="ODP" ${node.type === 'ODP' ? 'selected' : ''}>ODP</option>
                    <option value="ODC" ${node.type === 'ODC' ? 'selected' : ''}>ODC</option>
                    <option value="POP" ${node.type === 'POP' ? 'selected' : ''}>POP / Server</option>
                    <option value="Tiang" ${node.type === 'Tiang' ? 'selected' : ''}>Tiang tumpu</option>
                </select>
            </div>
            <div>
                <label class="text-slate-300 block mb-1 font-semibold">Keterangan / Core</label>
                <input id="edit-node-note" type="text" value="${escapeHtml(node.note || '')}" placeholder="Misal: 24C / Splitter 1:8" class="w-full bg-slate-800 border border-slate-600 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-blue-500">
            </div>
        </div>
        <div>
            <label class="text-slate-300 block mb-1 font-semibold">Deskripsi & Catatan Lengkap</label>
            <textarea id="edit-node-desc" rows="3" placeholder="Posisi tiang, kondisi kabel, catatan teknis, redaman..." class="w-full bg-slate-800 border border-slate-600 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-blue-500">${escapeHtml(node.description || '')}</textarea>
        </div>
        <div>
            <div class="flex items-center justify-between mb-1">
                <label class="text-slate-300 font-semibold"><i class="fa-solid fa-camera mr-1 text-blue-400"></i> Dokumentasi Foto</label>
                <span id="edit-photo-count" class="text-slate-400 text-[11px]">${editingPhotos.length} foto</span>
            </div>
            <label class="block bg-slate-800 hover:bg-slate-750 border border-dashed border-slate-600 hover:border-blue-500 rounded-lg p-2.5 text-center cursor-pointer transition text-slate-300">
                <i class="fa-solid fa-cloud-arrow-up mr-1 text-blue-400"></i> Tambah Foto Dokumentasi
                <input type="file" accept="image/*" multiple onchange="handleEditPhotoUpload(event)" class="hidden">
            </label>
            <div id="edit-photo-gallery" class="flex flex-wrap gap-2 mt-2"></div>
        </div>
    `;

    renderEditPhotos();
    document.getElementById('modal-edit-save-btn').onclick = saveEditData;
    document.getElementById('modal-edit').classList.remove('hidden');
}

function openEditCableModal(id) {
    if (typeof hasWritePermission === 'function' && !hasWritePermission()) {
        alert('Akses Ditolak: Diperlukan hak akses Admin atau Super Admin untuk dapat mengedit data jalur kabel.');
        return;
    }
    const cable = cables.find(c => c.id === id);
    if (!cable) return;

    currentEditingType = 'cable';
    currentEditingId = id;
    editingPhotos = [...(cable.photos || [])];

    document.getElementById('modal-edit-icon').className = "w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center text-white text-sm";
    document.getElementById('modal-edit-icon').innerHTML = '<i class="fa-solid fa-route"></i>';
    document.getElementById('modal-edit-title').innerText = `Edit Info: ${cable.name}`;
    document.getElementById('modal-edit-subtitle').innerText = `Panjang: ${cable.rawDistance} m (Total + Slack: ${cable.totalDistance} m)`;

    const body = document.getElementById('modal-edit-body');
    body.innerHTML = `
        <div>
            <label class="text-slate-300 block mb-1 font-semibold">Nama Segmen Jalur</label>
            <input id="edit-cable-name" type="text" value="${escapeHtml(cable.name)}" class="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-white focus:outline-none focus:border-blue-500">
        </div>
        <div class="grid grid-cols-2 gap-2">
            <div>
                <label class="text-slate-300 block mb-1 font-semibold">Kapasitas Kabel</label>
                <select id="edit-cable-type" class="w-full bg-slate-800 border border-slate-600 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-blue-500">
                    <option value="12 Core|#3b82f6" ${cable.coreSpec.includes('12') ? 'selected' : ''}>12 Core (Biru)</option>
                    <option value="24 Core|#f97316" ${cable.coreSpec.includes('24') ? 'selected' : ''}>24 Core (Oranye)</option>
                    <option value="48 Core|#10b981" ${cable.coreSpec.includes('48') ? 'selected' : ''}>48 Core (Hijau)</option>
                    <option value="96 Core|#a855f7" ${cable.coreSpec.includes('96') ? 'selected' : ''}>96 Core (Ungu)</option>
                    <option value="Dropcore|#eab308" ${cable.coreSpec.includes('Drop') ? 'selected' : ''}>Dropcore (Kuning)</option>
                </select>
            </div>
            <div>
                <label class="text-slate-300 block mb-1 font-semibold">Cadangan / Slack (%)</label>
                <input id="edit-cable-slack" type="number" value="${cable.slackPercent}" min="0" max="100" class="w-full bg-slate-800 border border-slate-600 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-blue-500">
            </div>
        </div>
        <!-- Rute Antar Gedung & Titik Power -->
        <div class="bg-slate-850 p-2.5 rounded-lg border border-amber-500/30 space-y-2">
            <div class="text-[11px] font-bold text-amber-400 uppercase tracking-wider flex items-center justify-between">
                <span><i class="fa-solid fa-building-circle-bolt mr-1"></i> Rute Antar Gedung & Titik Power</span>
            </div>
            <div class="grid grid-cols-2 gap-2">
                <div>
                    <label class="text-slate-300 block mb-1 font-semibold">Dari Gedung (Titik A)</label>
                    <input id="edit-cable-from" type="text" value="${escapeHtml(cable.fromBuilding || '')}" placeholder="Misal: Gedung A" class="w-full bg-slate-800 border border-slate-600 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-amber-500">
                </div>
                <div>
                    <label class="text-slate-300 block mb-1 font-semibold">Ke Gedung (Titik B)</label>
                    <input id="edit-cable-to" type="text" value="${escapeHtml(cable.toBuilding || '')}" placeholder="Misal: Gedung B" class="w-full bg-slate-800 border border-slate-600 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-amber-500">
                </div>
            </div>
            <div class="grid grid-cols-2 gap-2">
                <div>
                    <label class="text-slate-300 block mb-1 font-semibold">Sumber Titik Power</label>
                    <select id="edit-cable-power" class="w-full bg-slate-800 border border-slate-600 rounded-lg px-2 py-1.5 text-white focus:outline-none focus:border-amber-500">
                        <option value="Power dari Gedung Asal" ${cable.powerSource === 'Power dari Gedung Asal' ? 'selected' : ''}>⚡ Power dari Gedung Asal</option>
                        <option value="Power dari Gedung Tujuan" ${cable.powerSource === 'Power dari Gedung Tujuan' ? 'selected' : ''}>⚡ Power dari Gedung Tujuan</option>
                        <option value="Dual Power (Gedung A & B)" ${cable.powerSource === 'Dual Power (Gedung A & B)' ? 'selected' : ''}>⚡ Dual Power (Kedua Gedung)</option>
                        <option value="Power Mandiri / Tiang" ${cable.powerSource === 'Power Mandiri / Tiang' ? 'selected' : ''}>⚡ Power Mandiri / Tiang</option>
                        <option value="Tanpa Power Aktif (Pasif)" ${cable.powerSource === 'Tanpa Power Aktif (Pasif)' ? 'selected' : ''}>⚪ Pasif (Kabel FO Saja)</option>
                    </select>
                </div>
                <div>
                    <label class="text-slate-300 block mb-1 font-semibold">Catatan / Kapasitas Power</label>
                    <input id="edit-cable-power-notes" type="text" value="${escapeHtml(cable.powerNotes || '')}" placeholder="Contoh: UPS 2KVA, Panel Lt 1" class="w-full bg-slate-800 border border-slate-600 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-amber-500">
                </div>
            </div>
        </div>
        <div>
            <label class="text-slate-300 block mb-1 font-semibold">Deskripsi Jalur & Rute</label>
            <textarea id="edit-cable-desc" rows="3" placeholder="Catatan bentangan kabel, nomor tiang, gorong-gorong..." class="w-full bg-slate-800 border border-slate-600 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-blue-500">${escapeHtml(cable.description || '')}</textarea>
        </div>
        <div>
            <div class="flex items-center justify-between mb-1">
                <label class="text-slate-300 font-semibold"><i class="fa-solid fa-camera mr-1 text-emerald-400"></i> Dokumentasi Foto Jalur</label>
                <span id="edit-photo-count" class="text-slate-400 text-[11px]">${editingPhotos.length} foto</span>
            </div>
            <label class="block bg-slate-800 hover:bg-slate-750 border border-dashed border-slate-600 hover:border-emerald-500 rounded-lg p-2.5 text-center cursor-pointer transition text-slate-300">
                <i class="fa-solid fa-cloud-arrow-up mr-1 text-emerald-400"></i> Tambah Foto Dokumentasi
                <input type="file" accept="image/*" multiple onchange="handleEditPhotoUpload(event)" class="hidden">
            </label>
            <div id="edit-photo-gallery" class="flex flex-wrap gap-2 mt-2"></div>
        </div>
    `;

    renderEditPhotos();
    document.getElementById('modal-edit-save-btn').onclick = saveEditData;
    document.getElementById('modal-edit').classList.remove('hidden');
}

async function handleEditPhotoUpload(event) {
    if (typeof hasWritePermission === 'function' && !hasWritePermission()) {
        alert('Akses Ditolak: Diperlukan hak akses Admin atau Super Admin untuk dapat mengunggah foto.');
        event.target.value = '';
        return;
    }
    const files = Array.from(event.target.files);
    for (const f of files) {
        if (!f.type.startsWith('image/')) continue;

        if (typeof extractExifGps === 'function' && currentEditingType === 'node') {
            const gps = await extractExifGps(f);
            if (gps) {
                displayPhotoGpsSuggestion(gps, 'edit-photo-gallery', 'edit-node-coords');
                showToast(`📍 GPS terdeteksi pada foto: ${gps.lat}, ${gps.lng}`);
            }
        }

        const compressed = await compressImage(f);
        editingPhotos.push({ dataUrl: compressed, uploaded: false, url: null });
    }
    renderEditPhotos();
    event.target.value = '';
}

function renderEditPhotos() {
    const countEl = document.getElementById('edit-photo-count');
    if (countEl) countEl.innerText = `${editingPhotos.length} foto`;
    const gallery = document.getElementById('edit-photo-gallery');
    if (!gallery) return;
    gallery.innerHTML = editingPhotos.map((photo, idx) => {
        const src = (typeof photo === 'string') ? photo : (photo.url || photo.dataUrl || '');
        return `
        <div class="relative group w-14 h-14 rounded-lg overflow-hidden border border-slate-700 bg-slate-800 shadow">
            <img src="${src}" class="w-full h-full object-cover cursor-pointer" onclick="openLightbox('${src}', 'Dokumentasi Foto ${idx+1}')" loading="lazy">
            <button onclick="removeEditPhoto(${idx})" title="Hapus Foto" class="absolute top-0.5 right-0.5 bg-red-600 hover:bg-red-500 text-white w-4 h-4 rounded-full flex items-center justify-center text-[10px] shadow">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>
    `;
    }).join('');
}

function removeEditPhoto(idx) {
    if (typeof hasWritePermission === 'function' && !hasWritePermission()) {
        alert('Akses Ditolak: Diperlukan hak akses Admin atau Super Admin untuk dapat menghapus foto.');
        return;
    }
    editingPhotos.splice(idx, 1);
    renderEditPhotos();
}

function saveEditData() {
    if (typeof hasWritePermission === 'function' && !hasWritePermission()) {
        alert('Akses Ditolak: Diperlukan hak akses Admin atau Super Admin untuk dapat menyimpan perubahan data.');
        closeEditModal();
        return;
    }

    // Photos currently already uploaded (strings) stay as is; new ones (objects with dataUrl) will be uploaded
    const newPhotos = editingPhotos.filter(p => typeof p === 'object' && p.dataUrl && !p.url);
    const existingPhotos = editingPhotos.filter(p => typeof p === 'string' || (typeof p === 'object' && p.url));

    if (currentEditingType === 'node') {
        const node = nodes.find(n => n.id === currentEditingId);
        if (node) {
            node.name = document.getElementById('edit-node-name').value.trim() || node.name;
            node.type = document.getElementById('edit-node-type').value;
            node.note = document.getElementById('edit-node-note').value.trim() || '-';
            node.description = document.getElementById('edit-node-desc').value.trim() || '';
            // Keep existing photos, new ones will be uploaded
            node.photos = existingPhotos.map(p => typeof p === 'string' ? p : p.url);
            renderNodeMarker(node);
            if (typeof logActivity === 'function') {
                logActivity('node_update', `Edit Titik: ${node.name}`, `Tipe: ${node.type} • Catatan: ${node.note}`);
            }
            // Upload new photos if any
            if (newPhotos.length > 0) {
                uploadPhotosAndSave(newPhotos, node, 'node');
            } else {
                saveAndRefresh();
            }
        }
    } else if (currentEditingType === 'cable') {
        const cable = cables.find(c => c.id === currentEditingId);
        if (cable) {
            const rawType = document.getElementById('edit-cable-type').value.split('|');
            cable.name = document.getElementById('edit-cable-name').value.trim() || cable.name;
            cable.coreSpec = rawType[0];
            cable.color = rawType[1];
            cable.slackPercent = parseFloat(document.getElementById('edit-cable-slack').value) || 0;
            cable.description = document.getElementById('edit-cable-desc').value.trim() || '';
            cable.fromBuilding = (document.getElementById('edit-cable-from')?.value || '').trim();
            cable.toBuilding = (document.getElementById('edit-cable-to')?.value || '').trim();
            cable.powerSource = (document.getElementById('edit-cable-power')?.value || '').trim();
            cable.powerNotes = (document.getElementById('edit-cable-power-notes')?.value || '').trim();
            cable.photos = existingPhotos.map(p => typeof p === 'string' ? p : p.url);
            cable.totalDistance = Math.round(cable.rawDistance * (1 + cable.slackPercent / 100));
            renderCablePolyline(cable);
            if (typeof logActivity === 'function') {
                logActivity('cable_update', `Edit Data Kabel: ${cable.name}`, `Kapasitas: ${cable.coreSpec} • Total Panjang: ${cable.totalDistance}m`);
            }
            if (newPhotos.length > 0) {
                uploadPhotosAndSave(newPhotos, cable, 'cable');
            } else {
                saveAndRefresh();
            }
        }
    }
}

function closeEditModal() {
    document.getElementById('modal-edit').classList.add('hidden');
    currentEditingType = null;
    currentEditingId = null;
    editingPhotos = [];
}

/**
 * uploadPhotosAndSave — Upload foto ke GitHub Repo (Opsi 1: 1–5 GB)
 * Foto-foto yang masih berupa base64 di-upload ke /uploads/photos/ di GitHub Repo.
 * Setelah upload selesai, URL foto digantikan ke titik/kabel lalu disimpan ke Cloud.
 * @param {Array} photosToUpload - Array foto baru [{dataUrl, uploaded, url}]
 * @param {Object} targetObj - Node atau Cable object yang akan di-update
 * @param {string} targetType - 'node' | 'cable'
 */
async function uploadPhotosAndSave(photosToUpload, targetObj, targetType) {
    if (!photosToUpload || photosToUpload.length === 0) {
        saveAndRefresh();
        if (currentEditingType) closeEditModal();
        return;
    }

    const UPLOAD_API = (typeof window !== 'undefined' && window.location && window.location.origin && !window.location.origin.includes('localhost'))
        ? `${window.location.origin}/api/upload`
        : 'https://fo-network-mapper.vercel.app/api/upload';

    if (typeof showToast === 'function') {
        showToast(`☁️ Mengunggah ${photosToUpload.length} foto ke server... Mohon tunggu.`);
    }

    const uploadedUrls = [];

    for (let i = 0; i < photosToUpload.length; i++) {
        const photo = photosToUpload[i];
        try {
            const imageData = (typeof photo === 'string') ? photo : (photo.dataUrl || photo);
            const ext = imageData.includes('data:image/png') ? 'png' : 'jpg';
            const ts = Date.now() + i;
            const rnd = Math.random().toString(36).substr(2, 5);
            const safeId = (targetObj.id || 'foto').replace(/[^a-zA-Z0-9_-]/g, '_').substr(0, 20);
            const filename = `foto_${safeId}_${ts}_${rnd}.${ext}`;

            const res = await fetch(UPLOAD_API, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-fo-app-key': (typeof FO_APP_KEY !== 'undefined' ? FO_APP_KEY : 'fo_sec_9x8k2m7q4p1w5v0z_2026')
                },
                body: JSON.stringify({
                    image: imageData,
                    filename: filename,
                    nodeId: targetObj.id
                })
            });

            if (res.ok) {
                const data = await res.json();
                uploadedUrls.push(data.url);
            } else {
                // Fallback: simpan dataUrl langsung jika upload gagal
                console.warn('[PhotoUpload] Upload gagal untuk foto', i + 1, '- menggunakan dataUrl lokal');
                uploadedUrls.push(imageData);
            }
        } catch (err) {
            console.warn('[PhotoUpload] Error upload foto:', err.message);
            const fallbackData = (typeof photo === 'string') ? photo : (photo.dataUrl || photo);
            uploadedUrls.push(fallbackData);
        }
    }

    // Gabungkan foto yang sudah diupload sebelumnya + foto baru yang baru di-upload
    const existingUrls = (targetObj.photos || []).filter(p => {
        if (typeof p === 'string') return true;
        if (typeof p === 'object' && p.url) return true;
        return false;
    }).map(p => (typeof p === 'string') ? p : p.url);

    targetObj.photos = [...existingUrls, ...uploadedUrls];

    if (typeof showToast === 'function') {
        showToast(`✅ ${uploadedUrls.length} foto berhasil tersimpan di Cloud Storage (1–5 GB)!`);
    }

    saveAndRefresh();
    if (currentEditingType) closeEditModal();
}


function saveAndRefresh() {
    window.nodes = nodes;
    window.cables = cables;
    if (typeof hasWritePermission === 'function' && !hasWritePermission()) {
        console.warn('Akses ditolak: User read-only tidak diizinkan mengubah data.');
        updateUI();
        return;
    }
    const now = new Date().toISOString();
    const currentLogs = (typeof getActivityLogs === 'function') ? getActivityLogs() : ((typeof activityLogs !== 'undefined') ? activityLogs : (window.activityLogs || []));
    localStorage.setItem('fo_mapper_data', JSON.stringify({ nodes, cables, activityLogs: currentLogs }));
    localStorage.setItem('fo_mapper_updated_at', now);
    updateUI();

    // Otomatis sinkronisasi ke Cloud Database real-time
    if (typeof pushDataToCloud === 'function') {
        pushDataToCloud({
            nodes,
            cables,
            activityLogs: currentLogs,
            updatedAt: now,
            updatedBy: (typeof getCurrentUser === 'function' && getCurrentUser()) ? getCurrentUser().name : 'Admin'
        });
    }

    // Auto-sync ke server jika online (divalidasi di sisi server)
    if (typeof currentAuthToken !== 'undefined' && currentAuthToken) {
        fetch('/api/projects', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentAuthToken}`,
                'x-auth-token': currentAuthToken
            },
            body: JSON.stringify({ nodes, cables })
        }).catch(() => {});
    }
}

function updateUI() {
    const canWrite = typeof hasWritePermission === 'function' ? hasWritePermission() : false;
    document.getElementById('count-badge').innerText = nodes.length + cables.length;
    document.getElementById('stat-nodes').innerText = nodes.length;

    const totalMeters = cables.reduce((acc, c) => acc + c.totalDistance, 0);
    document.getElementById('stat-length').innerText = totalMeters >= 1000
        ? (totalMeters / 1000).toFixed(2) + ' km'
        : totalMeters + ' m';

    // 1. List Titik pada Tab 2 (Grouped by Category / Type)
    const nodeContainer = document.getElementById('node-list');
    const nodeBadge = document.getElementById('node-count-badge');
    const filterPillsEl = document.getElementById('node-filter-pills');

    if (nodeBadge) nodeBadge.innerText = `${nodes.length} titik`;

    // Filter pills kategori titik
    if (filterPillsEl) {
        const distinctTypes = Array.from(new Set(nodes.map(n => n.type)));
        let pillsHtml = `
            <button onclick="filterNodeGroup('ALL')" class="px-2 py-0.5 rounded-full text-[10px] font-semibold transition ${nodeGroupFilter === 'ALL' ? 'bg-blue-600 text-white shadow' : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'}">
                Semua (${nodes.length})
            </button>
        `;
        distinctTypes.forEach(t => {
            const count = nodes.filter(n => n.type === t).length;
            const isSelected = nodeGroupFilter === t;
            pillsHtml += `
                <button onclick="filterNodeGroup('${t}')" class="px-2 py-0.5 rounded-full text-[10px] font-semibold transition ${isSelected ? 'bg-blue-600 text-white shadow' : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'}">
                    ${t} (${count})
                </button>
            `;
        });
        filterPillsEl.innerHTML = pillsHtml;
    }

    if (nodeContainer) {
        if (nodes.length === 0) {
            nodeContainer.innerHTML = `<p class="text-slate-500 text-[11px] italic">Belum ada titik ditambahkan.</p>`;
        } else {
            const filteredNodes = nodes.filter(n => {
                const matchesFilter = nodeGroupFilter === 'ALL' || n.type === nodeGroupFilter;
                const matchesSearch = !nodeGroupSearch ||
                    (n.name && n.name.toLowerCase().includes(nodeGroupSearch)) ||
                    (n.note && n.note.toLowerCase().includes(nodeGroupSearch)) ||
                    (n.type && n.type.toLowerCase().includes(nodeGroupSearch)) ||
                    (n.description && n.description.toLowerCase().includes(nodeGroupSearch));
                return matchesFilter && matchesSearch;
            });

            if (filteredNodes.length === 0) {
                nodeContainer.innerHTML = `<p class="text-slate-500 text-[11px] italic">Tidak ada titik yang sesuai pencarian / filter.</p>`;
            } else {
                const typeOrder = ['Gedung', 'Handhole', 'Closure', 'ODP', 'ODC', 'POP', 'Tiang'];
                const allTypes = Array.from(new Set([...typeOrder, ...filteredNodes.map(n => n.type)]));
                const groupCards = [];

                allTypes.forEach(t => {
                    const groupItems = filteredNodes.filter(n => n.type === t);
                    if (groupItems.length === 0) return;

                    const style = nodeStyleMap[t] || { bg: '#64748b', icon: 'fa-location-dot', label: t };
                    const isCollapsed = !!collapsedNodeGroups[t];
                    const chevronRotate = isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)';

                    const itemsHtml = groupItems.map(n => `
                        <div class="bg-slate-900/90 p-2.5 rounded-lg border border-slate-700/80 space-y-1.5 hover:border-slate-600 transition">
                            <div class="flex items-center justify-between">
                                <div class="font-semibold text-white flex items-center gap-1.5 truncate mr-1">
                                    <span class="w-2 h-2 rounded-full inline-block flex-shrink-0" style="background:${style.bg}"></span>
                                    <span class="text-xs truncate">${escapeHtml(n.name)}</span>
                                </div>
                                <div class="flex items-center gap-1 flex-shrink-0">
                                    <button onclick="openNodeSplicingModal('${n.id}')" title="Tabel Sambungan Core / Splicing (${(n.splices || []).length})" class="text-indigo-400 hover:text-indigo-300 p-1"><i class="fa-solid fa-arrows-split-up-and-left"></i></button>
                                    ${canWrite ? `
                                        <button onclick="startCableFromNode('${n.id}')" title="Tarik Jalur FO dari titik ini" class="text-emerald-400 hover:text-emerald-300 p-1"><i class="fa-solid fa-route"></i></button>
                                        <button onclick="openEditNodeModal('${n.id}')" title="Edit Deskripsi & Foto" class="text-amber-400 hover:text-amber-300 p-1"><i class="fa-solid fa-pen-to-square"></i></button>
                                    ` : ''}
                                    <button onclick="map.setView([${n.lat}, ${n.lng}], 19)" title="Pusatkan Peta" class="text-blue-400 hover:text-blue-300 p-1"><i class="fa-solid fa-crosshairs"></i></button>
                                    ${canWrite ? `
                                        <button onclick="deleteNode('${n.id}')" title="Hapus" class="text-red-400 hover:text-red-300 p-1"><i class="fa-solid fa-trash"></i></button>
                                    ` : ''}
                                </div>
                            </div>
                            <div class="text-[11px] text-slate-400 flex items-center justify-between">
                                <span>${n.lat.toFixed(5)}, ${n.lng.toFixed(5)} • ${escapeHtml(n.note || '-')}</span>
                                <div class="flex items-center gap-1.5 flex-shrink-0">
                                    ${n.splices && n.splices.length > 0 ? `<span class="text-indigo-400 text-[10px] font-semibold bg-indigo-950/60 px-1.5 py-0.2 rounded border border-indigo-800/40"><i class="fa-solid fa-link mr-0.5"></i>${n.splices.length} splice</span>` : ''}
                                    ${n.photos && n.photos.length > 0 ? `<span class="text-blue-400 text-[10px] font-semibold"><i class="fa-solid fa-camera mr-1"></i>${n.photos.length} foto</span>` : ''}
                                </div>
                            </div>
                            ${n.description ? `<p class="text-[11px] text-slate-300 bg-slate-800/80 p-1.5 rounded border border-slate-700/60 line-clamp-2">${escapeHtml(n.description)}</p>` : ''}
                        </div>
                    `).join('');

                    groupCards.push(`
                        <div class="bg-slate-950 rounded-xl border border-slate-800 overflow-hidden shadow-sm">
                            <div class="p-2.5 bg-slate-900/90 flex items-center justify-between cursor-pointer hover:bg-slate-850 transition select-none" onclick="toggleNodeGroup('${t}')">
                                <div class="flex items-center gap-2">
                                    <span class="w-6 h-6 rounded-lg flex items-center justify-center text-white text-xs shadow-sm" style="background:${style.bg}">
                                        <i class="fa-solid ${style.icon}"></i>
                                    </span>
                                    <span class="font-bold text-xs text-white">${escapeHtml(style.label || t)}</span>
                                </div>
                                <div class="flex items-center gap-1.5">
                                    <span class="text-[10px] px-2 py-0.5 rounded-full font-bold shadow-sm" style="background:${style.bg}22; color:${style.bg}">${groupItems.length} titik</span>
                                    <i class="fa-solid fa-chevron-down text-slate-400 text-xs transition-transform duration-200" style="transform:${chevronRotate}"></i>
                                </div>
                            </div>
                            <div class="${isCollapsed ? 'hidden' : 'p-2 space-y-1.5 bg-slate-950/60 border-t border-slate-800/80'}">
                                ${itemsHtml}
                            </div>
                        </div>
                    `);
                });

                nodeContainer.innerHTML = groupCards.join('');
            }
        }
    }

    // 2. Render Rekap Jalur per Gedung & Titik Power (Collapsible Cards)
    const buildingContainer = document.getElementById('building-grouped-list');
    const buildingBadge = document.getElementById('building-count-badge');
    const datalist = document.getElementById('building-suggestions');

    const allBuildingNames = new Set();
    nodes.filter(n => n.type === 'Gedung').forEach(n => allBuildingNames.add(n.name));
    cables.forEach(c => {
        if (c.fromBuilding) allBuildingNames.add(c.fromBuilding);
        if (c.toBuilding) allBuildingNames.add(c.toBuilding);
    });

    if (datalist) {
        datalist.innerHTML = Array.from(allBuildingNames).map(b => `<option value="${escapeHtml(b)}">`).join('');
    }

    if (buildingBadge) {
        buildingBadge.innerText = `${allBuildingNames.size} gedung`;
    }

    if (buildingContainer) {
        if (allBuildingNames.size === 0) {
            buildingContainer.innerHTML = `<p class="text-slate-500 text-[11px] italic">Belum ada rute gedung yang diatur. Isi form "Dari Gedung" & "Ke Gedung" pada jalur FO.</p>`;
        } else {
            const buildingCards = Array.from(allBuildingNames).map(bName => {
                const connectedCables = cables.filter(c => c.fromBuilding === bName || c.toBuilding === bName);
                const isBCollapsed = !!collapsedBuildingCards[bName];
                const bChevronRotate = isBCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
                return `
                    <div class="bg-slate-950 rounded-xl border border-slate-800 overflow-hidden shadow-sm">
                        <div class="p-2.5 bg-slate-900/90 flex items-center justify-between cursor-pointer hover:bg-slate-850 transition select-none" onclick="toggleBuildingCard('${escapeHtml(bName)}')">
                            <span class="font-bold text-xs text-amber-400 flex items-center gap-1.5">
                                <i class="fa-solid fa-building text-[11px]"></i> ${escapeHtml(bName)}
                            </span>
                            <div class="flex items-center gap-1.5">
                                <span class="text-[10px] text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded font-mono">${connectedCables.length} jalur FO</span>
                                <i class="fa-solid fa-chevron-down text-slate-400 text-xs transition-transform duration-200" style="transform:${bChevronRotate}"></i>
                            </div>
                        </div>
                        <div class="${isBCollapsed ? 'hidden' : 'p-2 space-y-1 bg-slate-950/60 border-t border-slate-800/80'}">
                            ${connectedCables.length === 0 ? '<div class="text-[10px] text-slate-500 italic p-1">Belum ada jalur terhubung.</div>' : connectedCables.map(c => {
                                const isOrigin = c.fromBuilding === bName;
                                const otherEnd = isOrigin ? (c.toBuilding || 'Tujuan') : (c.fromBuilding || 'Asal');
                                const directionIcon = isOrigin ? 'fa-arrow-right text-emerald-400' : 'fa-arrow-left text-blue-400';
                                return `
                                    <div class="flex items-center justify-between text-[11px] bg-slate-900/80 p-1.5 rounded border border-slate-800">
                                        <div class="flex items-center gap-1.5 overflow-hidden">
                                            <i class="fa-solid ${directionIcon} text-[10px]"></i>
                                            <span class="text-white font-medium truncate">${escapeHtml(otherEnd)}</span>
                                            <span class="text-[10px] text-slate-400 font-mono">(${c.totalDistance}m)</span>
                                        </div>
                                        <div class="flex items-center gap-1">
                                            <span class="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-semibold truncate max-w-[100px]" title="${escapeHtml(c.powerSource || 'Power')}">
                                                ⚡ ${escapeHtml(c.powerSource || 'Power')}
                                            </span>
                                            ${canWrite ? `
                                                <button onclick="continueDrawingCable('${c.id}')" title="Sambung / Teruskan Jalur Ini" class="text-emerald-400 hover:text-emerald-300 px-1">
                                                    <i class="fa-solid fa-plus-circle text-[10px]"></i>
                                                </button>
                                            ` : ''}
                                            <button onclick="map.fitBounds(cablePolylines['${c.id}'].getBounds())" title="Lihat di Peta" class="text-blue-400 hover:text-blue-300 px-1">
                                                <i class="fa-solid fa-eye text-[10px]"></i>
                                            </button>
                                        </div>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </div>
                `;
            }).join('');
            buildingContainer.innerHTML = buildingCards;
        }
    }

    // 3. List Kabel pada Tab 2 (Grouped by Kapasitas Core Spec)
    const cableContainer = document.getElementById('cable-list');
    const cableBadge = document.getElementById('cable-count-badge');
    if (cableBadge) cableBadge.innerText = `${cables.length} jalur`;

    if (cableContainer) {
        if (cables.length === 0) {
            cableContainer.innerHTML = `<p class="text-slate-500 text-[11px] italic">Belum ada jalur kabel FO.</p>`;
        } else {
            const filteredCables = cables.filter(c => {
                if (!cableGroupSearch) return true;
                const q = cableGroupSearch;
                return (c.name && c.name.toLowerCase().includes(q)) ||
                       (c.coreSpec && c.coreSpec.toLowerCase().includes(q)) ||
                       (c.fromBuilding && c.fromBuilding.toLowerCase().includes(q)) ||
                       (c.toBuilding && c.toBuilding.toLowerCase().includes(q)) ||
                       (c.powerSource && c.powerSource.toLowerCase().includes(q)) ||
                       (c.description && c.description.toLowerCase().includes(q));
            });

            if (filteredCables.length === 0) {
                cableContainer.innerHTML = `<p class="text-slate-500 text-[11px] italic">Tidak ada jalur FO yang sesuai pencarian.</p>`;
            } else {
                const specOrder = ['12 Core', '24 Core', '48 Core', '96 Core', 'Dropcore'];
                const existingSpecs = Array.from(new Set(filteredCables.map(c => c.coreSpec)));
                const allSpecs = Array.from(new Set([...specOrder.filter(s => existingSpecs.some(es => es.includes(s))), ...existingSpecs]));

                const cableGroupCards = [];

                allSpecs.forEach(spec => {
                    const groupCables = filteredCables.filter(c => c.coreSpec === spec || (spec !== 'Lainnya' && c.coreSpec.includes(spec)));
                    if (groupCables.length === 0) return;

                    const groupColor = groupCables[0].color || '#3b82f6';
                    const groupMeters = groupCables.reduce((acc, c) => acc + c.totalDistance, 0);
                    const isCollapsed = !!collapsedCableGroups[spec];
                    const chevronRotate = isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)';

                    const cablesHtml = groupCables.map(c => `
                        <div class="bg-slate-900 p-2.5 rounded-lg border border-slate-700 space-y-1.5 hover:border-slate-600 transition">
                            <div class="flex items-center justify-between">
                                <div class="font-semibold text-white flex items-center gap-1.5 truncate mr-1">
                                    <span class="w-2.5 h-2.5 rounded-full inline-block flex-shrink-0" style="background:${c.color}"></span>
                                    <span class="truncate text-xs">${escapeHtml(c.name)}</span>
                                </div>
                                <div class="flex items-center gap-1 flex-shrink-0">
                                    ${canWrite ? `
                                        <button onclick="continueDrawingCable('${c.id}')" title="Sambung / Lanjutkan Tarikan Jalur" class="text-emerald-400 hover:text-emerald-300 p-1"><i class="fa-solid fa-plus-circle"></i></button>
                                    ` : ''}
                                    <button onclick="openOtdrModal('${c.id}')" title="OTDR Titik Putus" class="text-red-400 hover:text-red-300 p-1"><i class="fa-solid fa-triangle-exclamation"></i></button>
                                    <button onclick="openCoreMatrixModal('${c.id}')" title="12 Core & Tube" class="text-purple-400 hover:text-purple-300 p-1"><i class="fa-solid fa-palette"></i></button>
                                    ${canWrite ? `
                                        <button onclick="startEditingCableRoute('${c.id}')" title="Edit Titik Rute & Relokasi" class="text-amber-400 hover:text-amber-300 p-1"><i class="fa-solid fa-bezier-curve"></i></button>
                                        <button onclick="openEditCableModal('${c.id}')" title="Edit Info & Foto" class="text-blue-400 hover:text-blue-300 p-1"><i class="fa-solid fa-pen-to-square"></i></button>
                                    ` : ''}
                                    <button onclick="map.fitBounds(cablePolylines['${c.id}'].getBounds())" title="Pusatkan Jalur" class="text-slate-400 hover:text-slate-200 p-1"><i class="fa-solid fa-expand"></i></button>
                                    ${canWrite ? `
                                        <button onclick="deleteCable('${c.id}')" title="Hapus" class="text-red-400 hover:text-red-300 p-1"><i class="fa-solid fa-trash"></i></button>
                                    ` : ''}
                                </div>
                            </div>

                            <!-- Rute Antar Gedung & Power -->
                            <div class="bg-slate-950 p-2 rounded border border-slate-800 flex items-center justify-between text-[11px]">
                                <div class="flex items-center gap-1 text-amber-300 font-semibold truncate mr-1">
                                    <i class="fa-solid fa-building-circle-arrow-right text-[10px] text-amber-400 flex-shrink-0"></i>
                                    <span class="truncate">${escapeHtml(c.fromBuilding || 'Gedung A')} ➔ ${escapeHtml(c.toBuilding || 'Gedung B')}</span>
                                </div>
                                <span class="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-medium whitespace-nowrap">
                                    ⚡ ${escapeHtml(c.powerSource || 'Power')}
                                </span>
                            </div>

                            <div class="text-[11px] text-slate-400 flex items-center justify-between">
                                <span>${c.coreSpec} • <b>${c.totalDistance} m</b> (Peta: ${c.rawDistance}m)</span>
                                ${c.photos && c.photos.length > 0 ? `<span class="text-emerald-400 text-[10px] font-semibold"><i class="fa-solid fa-camera mr-1"></i>${c.photos.length} foto</span>` : ''}
                            </div>
                            ${c.description ? `<p class="text-[11px] text-slate-300 bg-slate-800/80 p-1.5 rounded border border-slate-700/60 line-clamp-2">${escapeHtml(c.description)}</p>` : ''}
                        </div>
                    `).join('');

                    cableGroupCards.push(`
                        <div class="bg-slate-950 rounded-xl border border-slate-800 overflow-hidden shadow-sm">
                            <div class="p-2.5 bg-slate-900/90 flex items-center justify-between cursor-pointer hover:bg-slate-850 transition select-none" onclick="toggleCableGroup('${spec}')">
                                <div class="flex items-center gap-2">
                                    <span class="w-3 h-3 rounded-full flex-shrink-0" style="background:${groupColor}"></span>
                                    <span class="font-bold text-xs text-white">${escapeHtml(spec)}</span>
                                </div>
                                <div class="flex items-center gap-1.5">
                                    <span class="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-medium font-mono">${groupCables.length} jalur • ${groupMeters} m</span>
                                    <i class="fa-solid fa-chevron-down text-slate-400 text-xs transition-transform duration-200" style="transform:${chevronRotate}"></i>
                                </div>
                            </div>
                            <div class="${isCollapsed ? 'hidden' : 'p-2 space-y-1.5 bg-slate-950/60 border-t border-slate-800/80'}">
                                ${cablesHtml}
                            </div>
                        </div>
                    `);
                });

                cableContainer.innerHTML = cableGroupCards.join('');
            }
        }
    }

    // Quick Cable List pada Tab 1 (Sidebar Input)
    const quickCountEl = document.getElementById('quick-cable-count');
    if (quickCountEl) quickCountEl.innerText = `${cables.length} jalur`;
    const quickListEl = document.getElementById('quick-cable-list');
    if (quickListEl) {
        if (cables.length === 0) {
            quickListEl.innerHTML = `<p class="text-slate-500 text-[11px] italic">Belum ada jalur FO.</p>`;
        } else {
            quickListEl.innerHTML = cables.map(c => `
                <div class="bg-slate-900/90 p-1.5 rounded-lg border border-slate-700/80 flex items-center justify-between gap-1 text-[11px]">
                    <div class="flex items-center gap-1.5 overflow-hidden">
                        <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:${c.color}"></span>
                        <div class="truncate max-w-[105px]">
                            <div class="font-medium text-white truncate" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</div>
                            ${c.fromBuilding || c.toBuilding ? `<div class="text-[9px] text-amber-300 truncate">${escapeHtml(c.fromBuilding || '?')} ➔ ${escapeHtml(c.toBuilding || '?')}</div>` : ''}
                        </div>
                        <span class="text-[10px] text-slate-400 font-mono">(${c.totalDistance}m)</span>
                    </div>
                    <div class="flex items-center gap-1 flex-shrink-0">
                        ${canWrite ? `
                            <button onclick="continueDrawingCable('${c.id}')" title="Sambung / Lanjutkan Tarikan Jalur" class="text-emerald-400 hover:text-emerald-300 p-0.5"><i class="fa-solid fa-plus-circle"></i></button>
                            <button onclick="openOtdrModal('${c.id}')" title="OTDR Titik Putus" class="text-red-400 hover:text-red-300 p-0.5"><i class="fa-solid fa-triangle-exclamation"></i></button>
                            <button onclick="openCoreMatrixModal('${c.id}')" title="12 Core FO" class="text-purple-400 hover:text-purple-300 p-0.5"><i class="fa-solid fa-palette"></i></button>
                            <button onclick="startEditingCableRoute('${c.id}')" title="Edit Titik & Relokasi" class="text-amber-400 hover:text-amber-300 p-0.5"><i class="fa-solid fa-bezier-curve"></i></button>
                            <button onclick="openEditCableModal('${c.id}')" title="Edit Info" class="text-blue-400 hover:text-blue-300 p-0.5"><i class="fa-solid fa-pen-to-square"></i></button>
                            <button onclick="deleteCable('${c.id}')" title="Hapus Jalur Ini" class="text-red-400 hover:text-red-300 p-0.5"><i class="fa-solid fa-trash"></i></button>
                        ` : `
                            <button onclick="openOtdrModal('${c.id}')" title="OTDR Titik Putus" class="text-red-400 hover:text-red-300 p-0.5"><i class="fa-solid fa-triangle-exclamation"></i></button>
                            <button onclick="openCoreMatrixModal('${c.id}')" title="12 Core FO" class="text-purple-400 hover:text-purple-300 p-0.5"><i class="fa-solid fa-palette"></i></button>
                            <button onclick="map.fitBounds(cablePolylines['${c.id}'].getBounds())" title="Pusatkan Jalur" class="text-slate-400 hover:text-slate-200 p-0.5"><i class="fa-solid fa-expand"></i></button>
                        `}
                    </div>
                </div>
            `).join('');
        }
    }
}

function switchTab(tabId) {
    ['tab-input', 'tab-list', 'tab-export'].forEach(id => {
        document.getElementById(id).classList.add('hidden');
    });
    ['tab-btn-input', 'tab-btn-list', 'tab-btn-export'].forEach(id => {
        document.getElementById(id).className = "flex-1 py-2.5 border-b-2 border-transparent text-slate-400 hover:text-slate-200";
    });

    document.getElementById(tabId).classList.remove('hidden');
    const btnId = tabId.replace('tab-', 'tab-btn-');
    document.getElementById(btnId).className = "flex-1 py-2.5 border-b-2 border-blue-500 text-blue-400";
}

// --- 8. PENCARIAN LOKASI & EKSPOR ---
async function searchLocation() {
    const q = document.getElementById('search-box').value.trim();
    if (!q) return;
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&countrycodes=id&q=${encodeURIComponent(q)}`);
        const data = await res.json();
        if (data && data.length > 0) {
            map.setView([parseFloat(data[0].lat), parseFloat(data[0].lon)], 16);
        } else {
            alert('Lokasi tidak ditemukan.');
        }
    } catch (e) {
        alert('Gagal mencari lokasi. Pastikan koneksi internet aktif.');
    }
}

function generateKMLString() {
    let kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
<name>Jalur FO & Closure</name>
`;
    nodes.forEach(n => {
        const descText = [
            `Tipe: ${n.type}`,
            `Keterangan: ${n.note || '-'}`,
            n.description ? `Deskripsi: ${n.description}` : '',
            `Foto Dokumentasi: ${(n.photos && n.photos.length) || 0} foto`
        ].filter(Boolean).join('\n');

        kml += `<Placemark>
<name>${escapeHtml(n.name)} (${n.type})</name>
<description><![CDATA[${descText}]]></description>
<Point><coordinates>${n.lng},${n.lat},0</coordinates></Point>
</Placemark>
`;
    });
    cables.forEach(c => {
        const coordStr = c.points.map(p => `${p[1]},${p[0]},0`).join(' ');
        const descText = [
            `Rute: ${c.fromBuilding || '-'} ➔ ${c.toBuilding || '-'}`,
            `Titik Power: ${c.powerSource || '-'}`,
            c.powerNotes ? `Catatan Power: ${c.powerNotes}` : '',
            `Kapasitas: ${c.coreSpec}`,
            `Jarak Peta: ${c.rawDistance} m`,
            `Total + Slack: ${c.totalDistance} m`,
            c.description ? `Deskripsi: ${c.description}` : '',
            `Foto Dokumentasi: ${(c.photos && c.photos.length) || 0} foto`
        ].filter(Boolean).join('\n');

        kml += `<Placemark>
<name>${escapeHtml(c.name)} (${c.coreSpec} - ${c.totalDistance}m)</name>
<description><![CDATA[${descText}]]></description>
<LineString><coordinates>${coordStr}</coordinates></LineString>
</Placemark>
`;
    });
    kml += `</Document>
</kml>`;
    return kml;
}

function exportKML() {
    const kml = generateKMLString();
    downloadFile(kml, 'jalur_fo_closure.kml', 'application/vnd.google-earth.kml+xml');
}

const crc32Table = (function() {
    let c;
    const table = [];
    for (let n = 0; n < 256; n++) {
        c = n;
        for (let k = 0; k < 8; k++) {
            c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
        }
        table[n] = c;
    }
    return table;
})();

function calculateCrc32(bytes) {
    let crc = 0 ^ (-1);
    for (let i = 0; i < bytes.length; i++) {
        crc = (crc >>> 8) ^ crc32Table[(crc ^ bytes[i]) & 0xFF];
    }
    return (crc ^ (-1)) >>> 0;
}

function exportKMZ() {
    const kml = generateKMLString();
    try {
        const encoder = new TextEncoder();
        const fileBytes = encoder.encode(kml);
        const filename = 'doc.kml';
        const filenameBytes = encoder.encode(filename);
        const crc = calculateCrc32(fileBytes);
        const size = fileBytes.length;

        // 1. Local File Header (30 bytes + filename)
        const localHeader = new Uint8Array(30 + filenameBytes.length);
        const lView = new DataView(localHeader.buffer);
        lView.setUint32(0, 0x04034b50, true);
        lView.setUint16(4, 20, true);
        lView.setUint16(6, 0, true);
        lView.setUint16(8, 0, true);
        lView.setUint16(10, 0, true);
        lView.setUint16(12, 0, true);
        lView.setUint32(14, crc, true);
        lView.setUint32(18, size, true);
        lView.setUint32(22, size, true);
        lView.setUint16(26, filenameBytes.length, true);
        lView.setUint16(28, 0, true);
        localHeader.set(filenameBytes, 30);

        // 2. Central Directory Header (46 bytes + filename)
        const cdHeader = new Uint8Array(46 + filenameBytes.length);
        const cdView = new DataView(cdHeader.buffer);
        cdView.setUint32(0, 0x02014b50, true);
        cdView.setUint16(4, 20, true);
        cdView.setUint16(6, 20, true);
        cdView.setUint16(8, 0, true);
        cdView.setUint16(10, 0, true);
        cdView.setUint16(12, 0, true);
        cdView.setUint16(14, 0, true);
        cdView.setUint32(16, crc, true);
        cdView.setUint32(20, size, true);
        cdView.setUint32(24, size, true);
        cdView.setUint16(28, filenameBytes.length, true);
        cdView.setUint16(30, 0, true);
        cdView.setUint16(32, 0, true);
        cdView.setUint16(34, 0, true);
        cdView.setUint16(36, 0, true);
        cdView.setUint32(38, 0, true);
        cdView.setUint32(42, 0, true); // Local header offset
        cdHeader.set(filenameBytes, 46);

        const cdOffset = localHeader.length + fileBytes.length;
        const cdSize = cdHeader.length;

        // 3. End of Central Directory (22 bytes)
        const eocd = new Uint8Array(22);
        const eView = new DataView(eocd.buffer);
        eView.setUint32(0, 0x06054b50, true);
        eView.setUint16(4, 0, true);
        eView.setUint16(6, 0, true);
        eView.setUint16(8, 1, true);
        eView.setUint16(10, 1, true);
        eView.setUint32(12, cdSize, true);
        eView.setUint32(16, cdOffset, true);
        eView.setUint16(20, 0, true);

        const blob = new Blob([localHeader, fileBytes, cdHeader, eocd], { type: 'application/vnd.google-earth.kmz' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'jalur_fo_network.kmz';
        a.click();
        URL.revokeObjectURL(url);

        if (typeof showToast === 'function') {
            showToast('🌍 Berhasil mengunduh file KMZ (Google Earth).');
        }
    } catch (err) {
        console.error('Fallback ke KML:', err);
        exportKML();
    }
}

function exportCSV() {
    let csv = "Kategori,Nama,Tipe/Core,Gedung Asal,Gedung Tujuan,Titik Power,Catatan Power,Koordinat/Rute,Jarak Peta (m),Total + Slack (m),Keterangan,Deskripsi Lengkap,Jumlah Foto\n";
    nodes.forEach(n => {
        const safeDesc = (n.description || '').replace(/"/g, '""').replace(/\n/g, ' ');
        const safeNote = (n.note || '').replace(/"/g, '""');
        csv += `TITIK,"${n.name}","${n.type}","-","-","-","-","${n.lat}, ${n.lng}",0,0,"${safeNote}","${safeDesc}",${(n.photos && n.photos.length) || 0}\n`;
    });
    cables.forEach(c => {
        const safeDesc = (c.description || '').replace(/"/g, '""').replace(/\n/g, ' ');
        const safePowerNote = (c.powerNotes || '').replace(/"/g, '""');
        csv += `JALUR FO,"${c.name}","${c.coreSpec}","${c.fromBuilding || '-'}","${c.toBuilding || '-'}","${c.powerSource || '-'}","${safePowerNote}","${c.points.length} titik",${c.rawDistance},${c.totalDistance},"Slack ${c.slackPercent}%","${safeDesc}",${(c.photos && c.photos.length) || 0}\n`;
    });
    downloadFile(csv, 'laporan_jalur_fo.csv', 'text/csv');
}

function exportJSON() {
    const dataStr = JSON.stringify({ nodes, cables }, null, 2);
    downloadFile(dataStr, 'project_jalur_fo.json', 'application/json');
}

function importJSON(event) {
    if (typeof hasWritePermission === 'function' && !hasWritePermission()) {
        alert('Akses Ditolak: Diperlukan hak akses Admin atau Super Admin untuk dapat memuat project JSON.');
        event.target.value = '';
        return;
    }
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const parsed = JSON.parse(e.target.result);
            clearAllData(false);
            nodes = parsed.nodes || [];
            cables = parsed.cables || [];
            nodes.forEach(renderNodeMarker);
            cables.forEach(renderCablePolyline);
            saveAndRefresh();
            if (nodes.length > 0) map.setView([nodes[0].lat, nodes[0].lng], 16);
        } catch (err) {
            alert('File JSON tidak valid.');
        }
    };
    reader.readAsText(file);
}

function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

function clearAllData(confirmAsk = true) {
    if (confirmAsk) {
        if (typeof isSuperAdmin === 'function' && !isSuperAdmin()) {
            alert('Akses Ditolak: Hanya SUPER ADMIN (jaffier) yang berwenang mereset seluruh database jaringan.');
            return;
        }
        if (!confirm('PERINGATAN SUPER ADMIN:\n\nApakah Anda yakin ingin menghapus SEMUA titik tiang/closure dan seluruh jalur kabel FO dari peta & database? Tindakan ini tidak dapat dibatalkan.')) return;
    } else {
        if (typeof hasWritePermission === 'function' && !hasWritePermission()) {
            alert('Akses Ditolak: Diperlukan hak akses Admin untuk memuat ulang data.');
            return;
        }
    }
    if (typeof finishEditingCableRoute === 'function') finishEditingCableRoute(false);
    Object.values(nodeMarkers).forEach(m => map.removeLayer(m));
    Object.values(cablePolylines).forEach(p => map.removeLayer(p));
    nodeMarkers = {};
    cablePolylines = {};
    nodes = [];
    cables = [];
    resetTempCable();
    if (typeof logActivity === 'function') {
        logActivity('reset', 'Reset Seluruh Database Peta FO', 'Semua titik dan rute kabel dibersihkan.');
    }
    saveAndRefresh();
    if (typeof showToast === 'function') {
        showToast('Database peta jalur FO telah dibersihkan.');
    }
}

function setNetworkData(newNodes, newCables, newLogs = null, shouldFitBounds = true) {
    // 1. Bersihkan seluruh layer Leaflet yang ada saat ini
    if (typeof nodeMarkers !== 'undefined' && nodeMarkers) {
        Object.values(nodeMarkers).forEach(m => {
            try { if (map && map.hasLayer(m)) map.removeLayer(m); } catch (e) {}
        });
    }
    if (typeof cablePolylines !== 'undefined' && cablePolylines) {
        Object.values(cablePolylines).forEach(p => {
            try { if (map && map.hasLayer(p)) map.removeLayer(p); } catch (e) {}
        });
    }
    nodeMarkers = {};
    cablePolylines = {};

    // 2. Pasang data baru
    nodes = Array.isArray(newNodes) ? newNodes : [];
    cables = Array.isArray(newCables) ? newCables : [];
    if (newLogs && Array.isArray(newLogs)) {
        if (typeof setActivityLogs === 'function') {
            setActivityLogs(newLogs);
        } else {
            activityLogs = newLogs;
            window.activityLogs = activityLogs;
            if (typeof renderActivityLogList === 'function') renderActivityLogList();
        }
    }

    window.nodes = nodes;
    window.cables = cables;
    window.nodeMarkers = nodeMarkers;
    window.cablePolylines = cablePolylines;

    // 3. Render marker & kabel baru
    nodes.forEach(renderNodeMarker);
    cables.forEach(renderCablePolyline);
    updateUI();

    // 4. Perbarui cache lokal
    try {
        const currentLogs = (typeof getActivityLogs === 'function') ? getActivityLogs() : ((typeof activityLogs !== 'undefined') ? activityLogs : (window.activityLogs || []));
        localStorage.setItem('fo_mapper_data', JSON.stringify({ nodes, cables, activityLogs: currentLogs }));
    } catch (e) {}

    // 5. Geser & zoom kamera peta agar langsung mengarah ke titik / kabel yang ada
    if (shouldFitBounds && map) {
        const allPoints = [];
        nodes.forEach(n => {
            if (!isNaN(n.lat) && !isNaN(n.lng)) allPoints.push([n.lat, n.lng]);
        });
        cables.forEach(c => {
            if (Array.isArray(c.points)) {
                c.points.forEach(pt => {
                    if (Array.isArray(pt) && !isNaN(pt[0]) && !isNaN(pt[1])) allPoints.push(pt);
                });
            }
        });
        if (allPoints.length > 0) {
            try {
                const bounds = L.latLngBounds(allPoints);
                if (bounds.isValid()) {
                    map.fitBounds(bounds.pad(0.25), { maxZoom: 17, animate: true });
                }
            } catch (e) {}
        }
    }
}
window.setNetworkData = setNetworkData;

// Load saved data on startup
(function init() {
    window.nodes = nodes;
    window.cables = cables;
    window.nodeMarkers = nodeMarkers;
    window.cablePolylines = cablePolylines;
    window.renderNodeMarker = renderNodeMarker;
    window.renderCablePolyline = renderCablePolyline;
    window.getNodePopupHtml = getNodePopupHtml;
    window.getCablePopupHtml = getCablePopupHtml;
    window.updateUI = updateUI;
    window.exportKMZ = exportKMZ;
    window.exportKML = exportKML;
    window.openTutorialModal = openTutorialModal;
    window.closeTutorialModal = closeTutorialModal;
    window.switchTutorialTab = switchTutorialTab;

    // Inisialisasi Auth & terapkan hak akses UI sebelum render data awal
    if (typeof initAuth === 'function') {
        initAuth();
    }

    const saved = localStorage.getItem('fo_mapper_data');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            nodes = parsed.nodes || [];
            cables = parsed.cables || [];
            if (Array.isArray(parsed.activityLogs)) {
                if (typeof setActivityLogs === 'function') {
                    setActivityLogs(parsed.activityLogs);
                } else {
                    activityLogs = parsed.activityLogs;
                    window.activityLogs = activityLogs;
                }
            }
            window.nodes = nodes;
            window.cables = cables;
            nodes.forEach(renderNodeMarker);
            cables.forEach(renderCablePolyline);
            updateUI();
            if (nodes.length > 0) map.setView([nodes[0].lat, nodes[0].lng], 15);
        } catch (e) {}
    }

    // Auto-tampilkan tutorial pada kunjungan pertama jika belum pernah ditutup permanen
    if (!localStorage.getItem('fo_tutorial_seen')) {
        setTimeout(() => {
            const loginModal = document.getElementById('modal-auth-login');
            if (!loginModal || loginModal.classList.contains('hidden')) {
                openTutorialModal();
            }
        }, 1200);
    }

    // Sinkronisasi data dari server jika data lokal masih kosong
    fetch('/api/projects')
        .then(r => r.ok ? r.json() : null)
        .then(data => {
            if (data && (data.nodes || data.cables)) {
                if (!saved || (nodes.length === 0 && cables.length === 0)) {
                    nodes = data.nodes || [];
                    cables = data.cables || [];
                    window.nodes = nodes;
                    window.cables = cables;
                    nodes.forEach(renderNodeMarker);
                    cables.forEach(renderCablePolyline);
                    localStorage.setItem('fo_mapper_data', JSON.stringify({ nodes, cables }));
                    updateUI();
                    if (nodes.length > 0) map.setView([nodes[0].lat, nodes[0].lng], 15);
                }
            }
        })
        .catch(() => {});

    // Inisialisasi Cloud Sync Otomatis Real-Time Antar-Device
    if (typeof initCloudSync === 'function') {
        initCloudSync();
    }
})();

// --- 8. PANDUAN & TUTORIAL TOOLS MODAL ---
function openTutorialModal() {
    const modal = document.getElementById('modal-tutorial');
    if (modal) {
        switchTutorialTab('quick');
        modal.classList.remove('hidden');
    }
}

function closeTutorialModal(savePreference = false) {
    const modal = document.getElementById('modal-tutorial');
    if (modal) {
        modal.classList.add('hidden');
    }
    const checkEl = document.getElementById('check-dont-show-tutorial');
    if (savePreference && checkEl && checkEl.checked) {
        localStorage.setItem('fo_tutorial_seen', 'true');
    }
}

function switchTutorialTab(tabName) {
    const panels = {
        quick: document.getElementById('tut-panel-quick'),
        tools: document.getElementById('tut-panel-tools'),
        roles: document.getElementById('tut-panel-roles')
    };
    const buttons = {
        quick: document.getElementById('tut-tab-btn-quick'),
        tools: document.getElementById('tut-tab-btn-tools'),
        roles: document.getElementById('tut-tab-btn-roles')
    };

    Object.keys(panels).forEach(key => {
        if (panels[key]) {
            if (key === tabName) panels[key].classList.remove('hidden');
            else panels[key].classList.add('hidden');
        }
        if (buttons[key]) {
            if (key === tabName) {
                buttons[key].className = 'px-3 py-1.5 rounded-lg bg-blue-600 text-white shadow transition flex items-center gap-1.5 whitespace-nowrap';
            } else {
                buttons[key].className = 'px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition flex items-center gap-1.5 whitespace-nowrap';
            }
        }
    });
}

