/**
 * FO Network Mapper - OTDR Fault Locator & TIA/EIA-598 Core Management
 * Modul untuk pelacakan titik putus kabel (OTDR) dan manajemen warna 12 core/tube standar internasional
 */

let otdrFaultMarker = null;

// Standar 12 Warna Fiber Optic Internasional (TIA/EIA-598)
const TIA598_COLORS = [
    { id: 1,  name: 'Biru',    hex: '#2563eb', text: '#ffffff', border: '#1d4ed8' },
    { id: 2,  name: 'Oranye',  hex: '#f97316', text: '#ffffff', border: '#c2410c' },
    { id: 3,  name: 'Hijau',   hex: '#16a34a', text: '#ffffff', border: '#15803d' },
    { id: 4,  name: 'Cokelat', hex: '#854d0e', text: '#ffffff', border: '#713f12' },
    { id: 5,  name: 'Abu-abu', hex: '#64748b', text: '#ffffff', border: '#475569' },
    { id: 6,  name: 'Putih',   hex: '#f8fafc', text: '#0f172a', border: '#94a3b8' },
    { id: 7,  name: 'Merah',   hex: '#dc2626', text: '#ffffff', border: '#b91c1c' },
    { id: 8,  name: 'Hitam',   hex: '#0f172a', text: '#ffffff', border: '#334155' },
    { id: 9,  name: 'Kuning',  hex: '#eab308', text: '#0f172a', border: '#ca8a04' },
    { id: 10, name: 'Ungu',    hex: '#9333ea', text: '#ffffff', border: '#7e22ce' },
    { id: 11, name: 'Pink',    hex: '#ec4899', text: '#ffffff', border: '#db2777' },
    { id: 12, name: 'Toska',   hex: '#06b6d4', text: '#0f172a', border: '#0891b2' }
];

// --- 1. FITUR OTDR FAULT LOCATOR (PELACAK TITIK PUTUS) ---
function openOtdrModal(cableId) {
    const cable = cables.find(c => c.id === cableId);
    if (!cable) {
        alert('Data jalur kabel tidak ditemukan.');
        return;
    }

    const modal = document.getElementById('modal-otdr');
    if (!modal) return;

    document.getElementById('otdr-cable-id').value = cable.id;
    document.getElementById('otdr-cable-title').innerText = cable.name;
    document.getElementById('otdr-cable-spec').innerText = `${cable.coreSpec} | Jarak Fisik: ${cable.rawDistance} m (Total + Slack ${cable.slackPercent}%: ${cable.totalDistance} m)`;
    document.getElementById('otdr-distance-input').value = Math.round(cable.totalDistance / 2);
    document.getElementById('otdr-distance-input').max = cable.totalDistance;

    modal.classList.remove('hidden');
}

function closeOtdrModal() {
    const modal = document.getElementById('modal-otdr');
    if (modal) modal.classList.add('hidden');
}

function executeOtdrLocator() {
    const cableId = document.getElementById('otdr-cable-id').value;
    const cable = cables.find(c => c.id === cableId);
    if (!cable) return;

    const otdrMeter = parseFloat(document.getElementById('otdr-distance-input').value);
    const direction = document.querySelector('input[name="otdr-dir"]:checked').value; // 'start' | 'end'
    const accountSlack = document.getElementById('otdr-slack-check').checked;

    if (isNaN(otdrMeter) || otdrMeter < 0) {
        alert('Masukkan jarak meter hasil ukur OTDR yang valid.');
        return;
    }

    // Koreksi slack kabel:
    // Jika kabel punya cadangan/slack (misal 10%), panjang kaca serat optik = Rute Peta * 1.1.
    // Maka jarak di atas peta = Jarak OTDR / 1.1
    const slackFactor = accountSlack ? (1 + (cable.slackPercent || 0) / 100) : 1;
    const geoTargetDistance = otdrMeter / slackFactor;

    if (geoTargetDistance > cable.rawDistance) {
        alert(`Jarak hasil ukur (${otdrMeter} m) melebihi panjang total kabel (${cable.totalDistance} m). Periksa kembali angka OTDR.`);
        return;
    }

    // Urutkan titik sesuai arah ukur
    let points = [...cable.points];
    if (direction === 'end') {
        points.reverse();
    }

    // Cari koordinat titik putus secara interpolasi linear di sepanjang rute polylines
    let accumulated = 0;
    let faultCoord = null;

    for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];
        const segDist = calculateHaversineDistance(p1[0], p1[1], p2[0], p2[1]);

        if (accumulated + segDist >= geoTargetDistance) {
            const remain = geoTargetDistance - accumulated;
            const ratio = segDist > 0 ? (remain / segDist) : 0;
            const lat = p1[0] + ratio * (p2[0] - p1[0]);
            const lng = p1[1] + ratio * (p2[1] - p1[1]);
            faultCoord = [lat, lng];
            break;
        }
        accumulated += segDist;
    }

    if (!faultCoord) {
        faultCoord = points[points.length - 1];
    }

    closeOtdrModal();
    renderOtdrFaultMarker(faultCoord, cable, otdrMeter, direction, accountSlack);
}

function renderOtdrFaultMarker(coord, cable, otdrMeter, direction, accountSlack) {
    if (!map) return;

    if (otdrFaultMarker) {
        map.removeLayer(otdrFaultMarker);
    }

    const faultIcon = L.divIcon({
        className: 'otdr-fault-container',
        html: `
            <div class="relative flex items-center justify-center">
                <div class="otdr-fault-marker">
                    <i class="fa-solid fa-triangle-exclamation"></i>
                </div>
            </div>
        `,
        iconSize: [34, 34],
        iconAnchor: [17, 17]
    });

    otdrFaultMarker = L.marker(coord, { icon: faultIcon, zIndexOffset: 2000 }).addTo(map);

    const dirText = direction === 'start' ? 'dari Titik Pangkal Awal' : 'dari Titik Ujung Akhir';
    const gmapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${coord[0]},${coord[1]}`;

    otdrFaultMarker.bindPopup(`
        <div class="text-xs text-slate-800 space-y-2 min-w-[230px]">
            <div class="flex items-center gap-1.5 pb-1 border-b text-red-600 font-bold">
                <i class="fa-solid fa-burst text-base"></i>
                <span>INDIKASI KABEL PUTUS (OTDR)</span>
            </div>
            <div class="space-y-1">
                <div><b>Kabel:</b> ${escapeHtml(cable.name)}</div>
                <div><b>Jarak OTDR:</b> <span class="text-red-600 font-bold">${otdrMeter} m</span> (${dirText})</div>
                <div><b>Koordinat Peta:</b> ${coord[0].toFixed(6)}, ${coord[1].toFixed(6)}</div>
                <div class="text-[10px] text-slate-500 italic">
                    ${accountSlack ? `*Memperhitungkan cadangan/slack ${cable.slackPercent}%` : '*Jarak geometris langsung (tanpa slack)'}
                </div>
            </div>
            <div class="pt-2 flex flex-col gap-1.5">
                <a href="${gmapsUrl}" target="_blank" class="bg-blue-600 hover:bg-blue-500 text-white text-center py-1.5 px-2 rounded-lg font-bold flex items-center justify-center gap-1 text-[11px] shadow">
                    <i class="fa-solid fa-diamond-turn-right"></i> Navigasi Google Maps
                </a>
                <button onclick="clearOtdrFaultMarker()" class="bg-slate-200 hover:bg-slate-300 text-slate-700 py-1 px-2 rounded text-[10px] font-semibold">
                    Hapus Tanda Bahaya Ini
                </button>
            </div>
        </div>
    `).openPopup();

    map.setView(coord, 17);
    showToast(`🚨 Titik putus OTDR (${otdrMeter}m) berhasil ditandai di peta!`);
}

function clearOtdrFaultMarker() {
    if (otdrFaultMarker && map) {
        map.removeLayer(otdrFaultMarker);
        otdrFaultMarker = null;
        showToast('Tanda titik putus OTDR dibersihkan.');
    }
}

// --- 2. FITUR TIA/EIA-598 12 CORE & TUBE COLOR MANAGEMENT ---
function parseCoreCount(spec) {
    if (!spec) return 24;
    const match = spec.match(/(\d+)\s*Core/i);
    if (match) return parseInt(match[1]);
    if (spec.toLowerCase().includes('drop')) return 2;
    return 24;
}

function openCoreMatrixModal(cableId) {
    const cable = cables.find(c => c.id === cableId);
    if (!cable) return;

    const modal = document.getElementById('modal-core-matrix');
    if (!modal) return;

    document.getElementById('core-matrix-cable-id').value = cable.id;
    document.getElementById('core-matrix-title').innerText = `Manajemen Tube & Core: ${cable.name}`;
    const cpt = (typeof currentCoresPerTube === 'number') ? currentCoresPerTube : 6;
    document.getElementById('core-matrix-subtitle').innerText = `Kapasitas: ${cable.coreSpec} | Standar ${cpt} Core per Tube`;

    const totalCores = parseCoreCount(cable.coreSpec);
    const numTubes = Math.max(1, Math.ceil(totalCores / cpt));

    // Inisialisasi struktur core data jika belum ada atau konfigurasi cpt berubah
    if (!cable.cores || cable.cores.length !== totalCores || cable.coresPerTube !== cpt) {
        cable.cores = [];
        cable.coresPerTube = cpt;
        for (let i = 1; i <= totalCores; i++) {
            const colorIdx = (i - 1) % cpt;
            const tubeIdx = Math.floor((i - 1) / cpt);
            cable.cores.push({
                coreNum: i,
                tubeNum: tubeIdx + 1,
                colorIdx: colorIdx,
                status: 'idle', // 'aktif' | 'idle' | 'putus' | 'cadangan'
                target: ''
            });
        }
    }

    const container = document.getElementById('core-matrix-container');
    container.innerHTML = '';

    for (let t = 0; t < numTubes; t++) {
        const tubeColor = TIA598_COLORS[t % 12];
        const tubeSection = document.createElement('div');
        tubeSection.className = 'bg-slate-900/90 border border-slate-700/80 rounded-xl p-3.5 space-y-2.5';

        tubeSection.innerHTML = `
            <div class="flex items-center justify-between border-b border-slate-800 pb-2">
                <div class="flex items-center gap-2">
                    <span class="w-4 h-4 rounded-full border shadow-sm" style="background:${tubeColor.hex}; border-color:${tubeColor.border}"></span>
                    <span class="font-bold text-xs text-white">Tube ${t + 1} (${tubeColor.name})</span>
                </div>
                <span class="text-[10px] text-slate-400">Core ${(t * cpt) + 1} - ${Math.min((t + 1) * cpt, totalCores)}</span>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-2" id="tube-${t + 1}-cores"></div>
        `;

        container.appendChild(tubeSection);

        const coresContainer = tubeSection.querySelector(`#tube-${t + 1}-cores`);
        const tubeCores = cable.cores.filter(c => c.tubeNum === t + 1);

        tubeCores.forEach(c => {
            const color = TIA598_COLORS[c.colorIdx];
            const coreCard = document.createElement('div');
            coreCard.className = 'bg-slate-800/80 border border-slate-700 rounded-lg p-2 flex items-center justify-between gap-2 text-xs';

            const statusColors = {
                'aktif': 'text-emerald-400 bg-emerald-500/20 border-emerald-500/30',
                'idle': 'text-slate-400 bg-slate-700/50 border-slate-600',
                'putus': 'text-red-400 bg-red-500/20 border-red-500/30',
                'cadangan': 'text-amber-400 bg-amber-500/20 border-amber-500/30'
            };

            coreCard.innerHTML = `
                <div class="flex items-center gap-2 min-w-0">
                    <div class="w-6 h-6 rounded-full flex items-center justify-center font-bold text-[10px] shadow-sm flex-shrink-0" 
                         style="background:${color.hex}; color:${color.text}; border: 1.5px solid ${color.border}">
                        ${c.coreNum}
                    </div>
                    <div class="truncate">
                        <div class="font-semibold text-white truncate text-[11px]">${color.name}</div>
                        <input type="text" data-core="${c.coreNum}" value="${escapeHtml(c.target || '')}" placeholder="Keterangan / Splicing..." 
                               class="core-target-input bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] text-slate-200 w-28 focus:outline-none focus:border-blue-500">
                    </div>
                </div>
                <select data-core="${c.coreNum}" class="core-status-select bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-[11px] font-semibold text-slate-200 focus:outline-none">
                    <option value="idle" ${c.status === 'idle' ? 'selected' : ''}>🟡 Idle</option>
                    <option value="aktif" ${c.status === 'aktif' ? 'selected' : ''}>🟢 Aktif</option>
                    <option value="cadangan" ${c.status === 'cadangan' ? 'selected' : ''}>🔵 Spare</option>
                    <option value="putus" ${c.status === 'putus' ? 'selected' : ''}>🔴 Putus</option>
                </select>
            `;

            coresContainer.appendChild(coreCard);
        });
    }

    // Role-based visibility tombol simpan core & input disable
    const btnSaveCore = document.querySelector('#modal-core-matrix button[onclick="saveCoreMatrixData()"]');
    const isWrite = typeof hasWritePermission === 'function' ? hasWritePermission() : true;
    if (btnSaveCore) {
        if (!isWrite) {
            btnSaveCore.classList.add('hidden');
        } else {
            btnSaveCore.classList.remove('hidden');
        }
    }
    if (!isWrite) {
        modal.querySelectorAll('.core-target-input').forEach(el => el.disabled = true);
        modal.querySelectorAll('.core-status-select').forEach(el => el.disabled = true);
    }

    modal.classList.remove('hidden');
}

function closeCoreMatrixModal() {
    const modal = document.getElementById('modal-core-matrix');
    if (modal) modal.classList.add('hidden');
}

function saveCoreMatrixData() {
    if (typeof hasWritePermission === 'function' && !hasWritePermission()) {
        alert('Akses Ditolak: Hanya SUPER ADMIN yang dapat mengubah data core kabel.');
        return;
    }
    const cableId = document.getElementById('core-matrix-cable-id').value;
    const cable = cables.find(c => c.id === cableId);
    if (!cable) return;

    const targetInputs = document.querySelectorAll('.core-target-input');
    const statusSelects = document.querySelectorAll('.core-status-select');

    targetInputs.forEach(input => {
        const coreNum = parseInt(input.getAttribute('data-core'));
        const core = cable.cores.find(c => c.coreNum === coreNum);
        if (core) core.target = input.value.trim();
    });

    statusSelects.forEach(select => {
        const coreNum = parseInt(select.getAttribute('data-core'));
        const core = cable.cores.find(c => c.coreNum === coreNum);
        if (core) core.status = select.value;
    });

    saveAndRefresh();
    closeCoreMatrixModal();
    showToast(`✅ Data 12 Core & Tube untuk kabel "${cable.name}" berhasil disimpan!`);
}

// --- 3. FITUR MANAJEMEN SAMBUNGAN CORE DI JOINT CLOSURE & ODP (SPLICING MATRIX) ---

let currentSpliceNodeId = null;
let spliceSearchQuery = '';
let currentCoresPerTube = 6;
try {
    const savedCpt = localStorage.getItem('fo_cores_per_tube');
    if (savedCpt === '12' || savedCpt === '6') {
        currentCoresPerTube = parseInt(savedCpt);
    } else {
        currentCoresPerTube = 6;
    }
} catch (e) {
    currentCoresPerTube = 6;
}

let spliceActiveTubeA = 1;
let spliceActiveTubeB = 1;
let spliceCapacityA = 24;
let spliceCapacityB = 24;

function getCableTotalCores(cableName) {
    if (!cableName) return 24;
    const cList = (typeof cables !== 'undefined' && Array.isArray(cables)) ? cables : (window.cables || []);
    const cable = cList.find(c => c.name && c.name.toLowerCase().trim() === cableName.toLowerCase().trim());
    if (cable && cable.coreSpec) {
        return parseCoreCount(cable.coreSpec);
    }
    return 24;
}

function getUsedCoreInfo(nodeId, cableName, coreNum, side) {
    const nList = (typeof nodes !== 'undefined' && Array.isArray(nodes)) ? nodes : (window.nodes || []);
    const node = nList.find(n => n.id === nodeId);
    if (!node || !Array.isArray(node.splices) || !cableName) return null;

    const cName = cableName.toLowerCase().trim();
    const cNum = parseInt(coreNum);

    for (const s of node.splices) {
        if (side === 'a' && s.cableA && s.cableA.toLowerCase().trim() === cName && parseInt(s.coreA) === cNum) {
            return {
                spliceId: s.id,
                partnerCable: s.cableB || 'Kabel Keluar',
                partnerCore: s.coreB,
                status: s.status,
                note: s.note
            };
        }
        if (side === 'b' && s.cableB && s.cableB.toLowerCase().trim() === cName && parseInt(s.coreB) === cNum) {
            return {
                spliceId: s.id,
                partnerCable: s.cableA || 'Kabel Masuk',
                partnerCore: s.coreA,
                status: s.status,
                note: s.note
            };
        }
    }
    return null;
}

function setCoresPerTube(val) {
    currentCoresPerTube = parseInt(val) === 12 ? 12 : 6;
    try {
        localStorage.setItem('fo_cores_per_tube', currentCoresPerTube);
    } catch (e) {}

    const sel = document.getElementById('splice-cores-per-tube-select');
    if (sel) sel.value = String(currentCoresPerTube);

    const footerInfo = document.getElementById('splice-footer-info');
    if (footerInfo) {
        if (currentCoresPerTube === 6) {
            footerInfo.innerText = 'Standar 6 Core per Tube (Biru, Oranye, Hijau, Cokelat, Abu, Putih berulang tiap tube)';
        } else {
            footerInfo.innerText = 'Standar 12 Core per Tube (TIA/EIA-598: Biru s/d Toska per tube)';
        }
    }

    updateSplicePreviewColors();
    renderSpliceTubeAndCorePicker('a');
    renderSpliceTubeAndCorePicker('b');

    const nList = (typeof nodes !== 'undefined' && Array.isArray(nodes)) ? nodes : (window.nodes || []);
    const node = nList.find(n => n.id === currentSpliceNodeId);
    if (node) renderNodeSpliceList(node);

    if (typeof showToast === 'function') {
        showToast(`Standar disetel ke ${currentCoresPerTube} Core per Tube`);
    }
}

function getCoreColorInfo(coreNum, perTube = currentCoresPerTube) {
    const num = Math.max(1, parseInt(coreNum) || 1);
    const cpt = parseInt(perTube) === 12 ? 12 : 6;

    // Tube index (0-indexed) & color
    const tubeIdx = Math.floor((num - 1) / cpt);
    const tubeNum = tubeIdx + 1;
    const tubeColor = TIA598_COLORS[tubeIdx % 12] || TIA598_COLORS[0];

    // Core color index within tube (0 to cpt-1)
    const coreColorIdx = (num - 1) % cpt;
    const coreColor = TIA598_COLORS[coreColorIdx] || TIA598_COLORS[0];

    return {
        coreNum: num,
        name: coreColor.name,
        hex: coreColor.hex,
        text: coreColor.text,
        border: coreColor.border,
        tubeNum: tubeNum,
        tubeName: tubeColor.name,
        tubeHex: tubeColor.hex,
        tubeBorder: tubeColor.border,
        coresPerTube: cpt
    };
}

function updateSplicePreviewColors() {
    const coreAInput = document.getElementById('splice-input-core-a');
    const coreBInput = document.getElementById('splice-input-core-b');
    const previewA = document.getElementById('splice-preview-color-a');
    const previewB = document.getElementById('splice-preview-color-b');

    if (coreAInput && previewA) {
        const infoA = getCoreColorInfo(coreAInput.value);
        previewA.innerHTML = `
            <span class="w-3.5 h-3.5 rounded-full border shadow-sm flex-shrink-0" style="background:${infoA.hex}; border-color:${infoA.border}"></span>
            <span class="truncate font-semibold text-white">Core ${infoA.coreNum} • ${infoA.name}</span>
            <span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-750 text-amber-300 font-semibold ml-auto border border-amber-500/30 whitespace-nowrap">Tube ${infoA.tubeName}</span>
        `;
    }
    if (coreBInput && previewB) {
        const infoB = getCoreColorInfo(coreBInput.value);
        previewB.innerHTML = `
            <span class="w-3.5 h-3.5 rounded-full border shadow-sm flex-shrink-0" style="background:${infoB.hex}; border-color:${infoB.border}"></span>
            <span class="truncate font-semibold text-white">Core ${infoB.coreNum} • ${infoB.name}</span>
            <span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-750 text-amber-300 font-semibold ml-auto border border-amber-500/30 whitespace-nowrap">Tube ${infoB.tubeName}</span>
        `;
    }
}

function onSpliceCableInputChange(side) {
    const isA = (side === 'a');
    const input = document.getElementById(isA ? 'splice-input-cable-a' : 'splice-input-cable-b');
    const cableName = (input?.value || '').trim();
    const total = getCableTotalCores(cableName);
    if (isA) spliceCapacityA = total;
    else spliceCapacityB = total;
    renderSpliceTubeAndCorePicker(side);
}

function onSpliceCapacityChange(side, cap) {
    const capacity = parseInt(cap) || 24;
    const cpt = currentCoresPerTube || 6;
    if (side === 'a') {
        spliceCapacityA = capacity;
        const maxTube = Math.max(1, Math.ceil(capacity / cpt));
        if (spliceActiveTubeA > maxTube) spliceActiveTubeA = 1;
    } else {
        spliceCapacityB = capacity;
        const maxTube = Math.max(1, Math.ceil(capacity / cpt));
        if (spliceActiveTubeB > maxTube) spliceActiveTubeB = 1;
    }
    renderSpliceTubeAndCorePicker(side);
}

function selectSpliceTube(side, tubeNum) {
    if (side === 'a') spliceActiveTubeA = tubeNum;
    else spliceActiveTubeB = tubeNum;
    renderSpliceTubeAndCorePicker(side);
}

function selectSpliceCore(side, coreNum) {
    const isA = (side === 'a');
    const coreInput = document.getElementById(isA ? 'splice-input-core-a' : 'splice-input-core-b');
    if (coreInput) {
        coreInput.value = coreNum;
    }
    updateSplicePreviewColors();
    renderSpliceTubeAndCorePicker(side);
}

function onSpliceCoreInputType(side) {
    const isA = (side === 'a');
    const coreInput = document.getElementById(isA ? 'splice-input-core-a' : 'splice-input-core-b');
    const val = Math.max(1, parseInt(coreInput?.value) || 1);
    const cpt = currentCoresPerTube || 6;
    const targetTube = Math.floor((val - 1) / cpt) + 1;
    if (isA) spliceActiveTubeA = targetTube;
    else spliceActiveTubeB = targetTube;
    updateSplicePreviewColors();
    renderSpliceTubeAndCorePicker(side);
}

function syncCoreBWithA() {
    const coreA = parseInt(document.getElementById('splice-input-core-a')?.value) || 1;
    const inputB = document.getElementById('splice-input-core-b');
    if (inputB) {
        inputB.value = coreA;
        const cpt = currentCoresPerTube || 6;
        spliceActiveTubeB = Math.floor((coreA - 1) / cpt) + 1;
        updateSplicePreviewColors();
        renderSpliceTubeAndCorePicker('b');
        if (typeof showToast === 'function') {
            showToast(`Nomor core Sisi B disamakan ke Core ${coreA}`);
        }
    }
}

function renderSpliceTubeAndCorePicker(side) {
    const isA = (side === 'a');
    const cableInput = document.getElementById(isA ? 'splice-input-cable-a' : 'splice-input-cable-b');
    const coreInput = document.getElementById(isA ? 'splice-input-core-a' : 'splice-input-core-b');
    const container = document.getElementById(isA ? 'splice-tube-core-picker-a' : 'splice-tube-core-picker-b');
    if (!container) return;

    const cableName = (cableInput?.value || '').trim();
    const capacity = isA ? spliceCapacityA : spliceCapacityB;
    const activeTube = isA ? spliceActiveTubeA : spliceActiveTubeB;
    const cpt = currentCoresPerTube || 6;
    const numTubes = Math.max(1, Math.ceil(capacity / cpt));
    const selectedCore = parseInt(coreInput?.value) || 1;

    // Hitung total terpakai di kabel ini pada node ini
    let usedCount = 0;
    for (let c = 1; c <= capacity; c++) {
        if (getUsedCoreInfo(currentSpliceNodeId, cableName, c, side)) usedCount++;
    }

    let html = `
        <div class="space-y-2 pt-1 border-t border-slate-800">
            <!-- Header Ringkasan & Pilihan Kapasitas -->
            <div class="flex items-center justify-between text-[11px] text-slate-400 bg-slate-850/80 p-2 rounded-lg border border-slate-800">
                <span class="flex items-center gap-1.5 font-medium">
                    <i class="fa-solid fa-chart-pie text-indigo-400"></i>
                    <span>Status: <b class="text-amber-300 font-mono">${usedCount}</b> dari <b class="text-white font-mono">${capacity} Core</b> terpakai (<b class="text-emerald-400 font-mono">${Math.max(0, capacity - usedCount)} kosong</b>)</span>
                </span>
                <div class="flex items-center gap-1">
                    <span class="text-[10px] text-slate-400">Kapasitas:</span>
                    <select onchange="onSpliceCapacityChange('${side}', this.value)" class="bg-slate-800 border border-slate-700 text-slate-200 text-[10px] rounded px-1.5 py-0.5 focus:outline-none focus:border-indigo-500 font-semibold cursor-pointer">
                        <option value="6" ${capacity === 6 ? 'selected' : ''}>6 Core</option>
                        <option value="12" ${capacity === 12 ? 'selected' : ''}>12 Core</option>
                        <option value="24" ${capacity === 24 ? 'selected' : ''}>24 Core</option>
                        <option value="48" ${capacity === 48 ? 'selected' : ''}>48 Core</option>
                        <option value="96" ${capacity === 96 ? 'selected' : ''}>96 Core</option>
                        <option value="144" ${capacity === 144 ? 'selected' : ''}>144 Core</option>
                    </select>
                </div>
            </div>

            <!-- TUBE TABS (STEP 1: BUKA TUBE DULU) -->
            <div>
                <div class="text-[10px] text-slate-400 font-semibold mb-1 flex items-center justify-between">
                    <span class="flex items-center gap-1 text-slate-300">
                        <span class="w-4 h-4 rounded-full bg-slate-700 flex items-center justify-center text-[10px] text-white">1</span>
                        <span>PILIH TUBE (Tabung Kabel):</span>
                    </span>
                    <span class="text-[10px] text-indigo-400 font-normal">Klik tube untuk melihat core di dalamnya</span>
                </div>
                <div class="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px]">
    `;

    for (let t = 1; t <= numTubes; t++) {
        const tubeColor = TIA598_COLORS[(t - 1) % 12] || TIA598_COLORS[0];
        const isActive = (t === activeTube);

        // Cek berapa core terpakai di tube ini
        let tubeUsed = 0;
        const startC = (t - 1) * cpt + 1;
        const endC = Math.min(t * cpt, capacity);
        const tubeCoreCount = Math.max(0, endC - startC + 1);
        for (let c = startC; c <= endC; c++) {
            if (getUsedCoreInfo(currentSpliceNodeId, cableName, c, side)) tubeUsed++;
        }

        const isFull = (tubeUsed >= tubeCoreCount && tubeCoreCount > 0);

        html += `
            <button type="button" onclick="selectSpliceTube('${side}', ${t})" 
                    class="px-2.5 py-1.5 rounded-lg border flex items-center gap-1.5 font-semibold transition whitespace-nowrap text-xs shadow-sm ${
                        isActive 
                        ? (isA ? 'bg-blue-600/30 border-blue-500 text-white ring-1 ring-blue-500' : 'bg-emerald-600/30 border-emerald-500 text-white ring-1 ring-emerald-500')
                        : 'bg-slate-800/90 border-slate-750 text-slate-300 hover:bg-slate-750 hover:text-white'
                    }">
                <span class="w-3.5 h-3.5 rounded-full border shadow-sm flex-shrink-0" style="background:${tubeColor.hex}; border-color:${tubeColor.border}"></span>
                <span>Tube ${t} (${tubeColor.name})</span>
                <span class="text-[9px] px-1.5 py-0.2 rounded font-mono ${isFull ? 'bg-red-500/20 text-red-300 border border-red-500/30' : (tubeUsed > 0 ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'bg-slate-700 text-slate-400')}">
                    ${tubeUsed}/${tubeCoreCount}
                </span>
            </button>
        `;
    }

    html += `
                </div>
            </div>

            <!-- CORE BUTTONS (STEP 2: PILIH CORE DI DALAM TUBE INI) -->
            <div>
                <div class="text-[10px] text-slate-400 font-semibold mb-1 flex items-center justify-between">
                    <span class="flex items-center gap-1 text-slate-300">
                        <span class="w-4 h-4 rounded-full bg-slate-700 flex items-center justify-center text-[10px] text-white">2</span>
                        <span>PILIH CORE DI TUBE ${activeTube}:</span>
                    </span>
                    <span class="text-[10px] text-slate-500">Klik core yang ingin disambung</span>
                </div>
                <div class="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
    `;

    const startCore = (activeTube - 1) * cpt + 1;
    const endCore = Math.min(activeTube * cpt, capacity);

    for (let c = startCore; c <= endCore; c++) {
        const info = getCoreColorInfo(c);
        const isSelected = (c === selectedCore);
        const usedInfo = getUsedCoreInfo(currentSpliceNodeId, cableName, c, side);

        html += `
            <button type="button" onclick="selectSpliceCore('${side}', ${c})"
                    class="p-2 rounded-lg border flex items-center justify-between gap-1 text-left transition ${
                        isSelected 
                        ? (isA ? 'bg-blue-600/30 border-blue-500 text-white ring-2 ring-blue-500' : 'bg-emerald-600/30 border-emerald-500 text-white ring-2 ring-emerald-500')
                        : (usedInfo ? 'bg-slate-900/90 border-slate-800 text-slate-300 hover:border-slate-700' : 'bg-slate-800/80 border-slate-700 text-white hover:border-slate-500')
                    }">
                <div class="flex items-center gap-2 min-w-0">
                    <span class="w-6 h-6 rounded-md flex items-center justify-center font-bold text-xs shadow-sm flex-shrink-0" 
                          style="background:${info.hex}; color:${info.text}; border: 1.5px solid ${info.border}">
                        ${c}
                    </span>
                    <div class="truncate leading-tight">
                        <div class="text-[11px] font-bold truncate">${info.name}</div>
                        <div class="text-[10px] text-slate-400 truncate">Core ${c}</div>
                    </div>
                </div>
                <div class="flex-shrink-0">
                    ${usedInfo ? `
                        <span title="Sudah disambung ke ${escapeHtml(usedInfo.partnerCable)} (Core ${usedInfo.partnerCore})" class="text-[9px] px-1.5 py-0.5 rounded font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-0.5">
                            <i class="fa-solid fa-link text-[8px]"></i> Terpakai
                        </span>
                    ` : `
                        <span class="text-[9px] px-1.5 py-0.5 rounded font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                            🟢 Kosong
                        </span>
                    `}
                </div>
            </button>
        `;
    }

    html += `
                </div>
            </div>
        </div>
    `;

    container.innerHTML = html;
}

function openNodeSplicingModal(nodeId) {
    const nList = (typeof nodes !== 'undefined' && Array.isArray(nodes)) ? nodes : (window.nodes || []);
    const node = nList.find(n => n.id === nodeId);
    if (!node) {
        alert('Data titik tidak ditemukan.');
        return;
    }

    currentSpliceNodeId = nodeId;
    spliceSearchQuery = '';
    spliceFilterStatus = 'ALL';

    const modal = document.getElementById('modal-node-splicing');
    if (!modal) return;

    if (!Array.isArray(node.splices)) {
        node.splices = [];
    }

    document.getElementById('splice-current-node-id').value = node.id;
    document.getElementById('splice-modal-node-name').innerText = `${node.name} (${node.type || 'Titik'})`;
    document.getElementById('splice-modal-node-subtitle').innerText = `Koordinat: ${node.lat.toFixed(5)}, ${node.lng.toFixed(5)} • Catatan: ${node.note || '-'}`;

    const searchInput = document.getElementById('splice-search-input');
    if (searchInput) searchInput.value = '';

    // Sinkronkan dropdown standar 6 core / 12 core per tube
    const sel = document.getElementById('splice-cores-per-tube-select');
    if (sel) sel.value = String(currentCoresPerTube);

    // Populate Datalist Autocomplete Kabel dari kabel aktif
    const datalist = document.getElementById('splice-cable-suggestions');
    if (datalist) {
        const cList = (typeof cables !== 'undefined' && Array.isArray(cables)) ? cables : (window.cables || []);
        const cableNames = Array.from(new Set(cList.map(c => c.name))).filter(Boolean);
        datalist.innerHTML = cableNames.map(name => `<option value="${escapeHtml(name)}">`).join('');
    }

    // Role-based visibility
    const canWrite = typeof hasWritePermission === 'function' ? hasWritePermission() : false;
    const btnToggle = document.getElementById('btn-toggle-splice-form');
    if (btnToggle) btnToggle.classList.toggle('hidden', !canWrite);

    toggleSpliceInputForm(false);
    updateSplicePreviewColors();
    renderNodeSpliceList(node);

    modal.classList.remove('hidden');
}

function closeNodeSplicingModal() {
    const modal = document.getElementById('modal-node-splicing');
    if (modal) modal.classList.add('hidden');
    currentSpliceNodeId = null;
}

function toggleSpliceInputForm(forceState) {
    const drawer = document.getElementById('splice-input-form-drawer');
    if (!drawer) return;
    if (typeof forceState === 'boolean') {
        drawer.classList.toggle('hidden', !forceState);
    } else {
        drawer.classList.toggle('hidden');
    }
    if (!drawer.classList.contains('hidden')) {
        const inputA = document.getElementById('splice-input-cable-a');
        const inputB = document.getElementById('splice-input-cable-b');
        const cList = (typeof cables !== 'undefined' && Array.isArray(cables)) ? cables : (window.cables || []);
        if (inputA && !inputA.value && cList.length > 0) {
            inputA.value = cList[0].name;
        }
        if (inputB && !inputB.value) {
            if (cList.length > 1) inputB.value = cList[1].name;
            else if (cList.length === 1) inputB.value = cList[0].name;
        }

        if (inputA && inputA.value) {
            spliceCapacityA = getCableTotalCores(inputA.value);
        }
        if (inputB && inputB.value) {
            spliceCapacityB = getCableTotalCores(inputB.value);
        }

        updateSplicePreviewColors();
        renderSpliceTubeAndCorePicker('a');
        renderSpliceTubeAndCorePicker('b');
    }
}

function setSpliceFilter(status) {
    spliceFilterStatus = status;
    const nList = (typeof nodes !== 'undefined' && Array.isArray(nodes)) ? nodes : (window.nodes || []);
    const node = nList.find(n => n.id === currentSpliceNodeId);
    if (node) renderNodeSpliceList(node);
}

function onSpliceSearchChange(val) {
    spliceSearchQuery = val || '';
    const nList = (typeof nodes !== 'undefined' && Array.isArray(nodes)) ? nodes : (window.nodes || []);
    const node = nList.find(n => n.id === currentSpliceNodeId);
    if (node) renderNodeSpliceList(node);
}

function renderNodeSpliceList(node) {
    if (!node) {
        const nList = (typeof nodes !== 'undefined' && Array.isArray(nodes)) ? nodes : (window.nodes || []);
        node = nList.find(n => n.id === currentSpliceNodeId);
    }
    if (!node) return;

    const container = document.getElementById('splice-list-container');
    const pillsContainer = document.getElementById('splice-filter-pills');
    const totalBadge = document.getElementById('splice-total-badge');
    const splices = Array.isArray(node.splices) ? node.splices : [];
    const canWrite = typeof hasWritePermission === 'function' ? hasWritePermission() : false;

    const countTotal = splices.length;
    const countAktif = splices.filter(s => s.status === 'aktif').length;
    const countSpare = splices.filter(s => s.status === 'cadangan').length;
    const countLoss = splices.filter(s => s.status === 'loss').length;
    const countCut = splices.filter(s => s.status === 'putus').length;

    if (totalBadge) totalBadge.innerText = `${countTotal} sambungan (${countAktif} aktif)`;

    if (pillsContainer) {
        pillsContainer.innerHTML = `
            <button onclick="setSpliceFilter('ALL')" class="px-2.5 py-0.5 rounded-full text-[10px] font-semibold transition whitespace-nowrap ${spliceFilterStatus === 'ALL' ? 'bg-indigo-600 text-white shadow' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}">
                Semua (${countTotal})
            </button>
            <button onclick="setSpliceFilter('aktif')" class="px-2.5 py-0.5 rounded-full text-[10px] font-semibold transition whitespace-nowrap ${spliceFilterStatus === 'aktif' ? 'bg-emerald-600 text-white shadow' : 'bg-slate-800 text-emerald-400 hover:bg-slate-700'}">
                🟢 Aktif (${countAktif})
            </button>
            <button onclick="setSpliceFilter('cadangan')" class="px-2.5 py-0.5 rounded-full text-[10px] font-semibold transition whitespace-nowrap ${spliceFilterStatus === 'cadangan' ? 'bg-blue-600 text-white shadow' : 'bg-slate-800 text-blue-400 hover:bg-slate-700'}">
                🔵 Spare (${countSpare})
            </button>
            ${countLoss > 0 ? `
                <button onclick="setSpliceFilter('loss')" class="px-2.5 py-0.5 rounded-full text-[10px] font-semibold transition whitespace-nowrap ${spliceFilterStatus === 'loss' ? 'bg-amber-600 text-white shadow' : 'bg-slate-800 text-amber-400 hover:bg-slate-700'}">
                    🟠 High Loss (${countLoss})
                </button>
            ` : ''}
            ${countCut > 0 ? `
                <button onclick="setSpliceFilter('putus')" class="px-2.5 py-0.5 rounded-full text-[10px] font-semibold transition whitespace-nowrap ${spliceFilterStatus === 'putus' ? 'bg-red-600 text-white shadow' : 'bg-slate-800 text-red-400 hover:bg-slate-700'}">
                    🔴 Putus (${countCut})
                </button>
            ` : ''}
        `;
    }

    if (!container) return;

    const filtered = splices.filter(s => {
        const matchesStatus = (spliceFilterStatus === 'ALL') || (s.status === spliceFilterStatus);
        const q = spliceSearchQuery.toLowerCase().trim();
        const matchesQuery = !q ||
            (s.cableA && s.cableA.toLowerCase().includes(q)) ||
            (s.cableB && s.cableB.toLowerCase().includes(q)) ||
            (String(s.coreA) === q) ||
            (String(s.coreB) === q) ||
            (s.note && s.note.toLowerCase().includes(q));
        return matchesStatus && matchesQuery;
    });

    if (filtered.length === 0) {
        if (splices.length === 0) {
            container.innerHTML = `
                <div class="py-8 text-center text-slate-400 space-y-3 bg-slate-900/50 rounded-2xl border border-dashed border-slate-800 p-6">
                    <div class="w-12 h-12 rounded-2xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 flex items-center justify-center mx-auto text-xl shadow">
                        <i class="fa-solid fa-arrows-split-up-and-left"></i>
                    </div>
                    <div>
                        <h4 class="font-bold text-white text-sm">Belum Ada Sambungan Core di Titik Ini</h4>
                        <p class="text-xs text-slate-400 max-w-md mx-auto mt-1 leading-relaxed">
                            Catat pasangan kabel masuk (arah sumber/POP) ke kabel keluar (arah distribusi/ODP) agar teknisi mudah melacak core saat troubleshooting.
                        </p>
                    </div>
                    ${canWrite ? `
                        <div class="flex flex-wrap items-center justify-center gap-2 pt-1">
                            <button onclick="toggleSpliceInputForm(true)" class="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-xs font-bold shadow flex items-center gap-1.5 transition">
                                <i class="fa-solid fa-plus"></i> Tambah Sambungan Core
                            </button>
                        </div>
                    ` : ''}
                </div>
            `;
        } else {
            container.innerHTML = `
                <div class="py-6 text-center text-slate-400 text-xs italic bg-slate-900/40 rounded-xl p-4 border border-slate-800">
                    Tidak ada sambungan yang sesuai dengan filter atau kata kunci pencarian "${escapeHtml(spliceSearchQuery)}".
                </div>
            `;
        }
        return;
    }

    container.innerHTML = filtered.map(s => {
        const infoA = getCoreColorInfo(s.coreA);
        const infoB = getCoreColorInfo(s.coreB);

        const statusBadges = {
            'aktif': `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1"><i class="fa-solid fa-link text-[9px]"></i> Aktif</span>`,
            'cadangan': `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30 flex items-center gap-1"><i class="fa-solid fa-shield text-[9px]"></i> Spare</span>`,
            'loss': `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1"><i class="fa-solid fa-triangle-exclamation text-[9px]"></i> High Loss</span>`,
            'putus': `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/20 text-red-300 border border-red-500/30 flex items-center gap-1"><i class="fa-solid fa-xmark text-[9px]"></i> Putus</span>`
        };
        const badge = statusBadges[s.status] || statusBadges['aktif'];

        return `
            <div class="bg-slate-850 hover:bg-slate-800/90 border border-slate-750 hover:border-slate-700 rounded-xl p-3 shadow transition flex flex-col gap-2">
                <div class="flex flex-col sm:flex-row items-center justify-between gap-2.5">
                    <!-- SISI A (Kabel Masuk) -->
                    <div class="flex items-center gap-2.5 min-w-0 flex-1 w-full sm:w-auto">
                        <div class="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs shadow flex-shrink-0" 
                             style="background:${infoA.hex}; color:${infoA.text}; border: 1.5px solid ${infoA.border}">
                            ${infoA.coreNum}
                        </div>
                        <div class="truncate">
                            <div class="font-bold text-white text-xs truncate flex items-center gap-1.5">
                                <span>Core ${infoA.coreNum} (${infoA.name})</span>
                                <span class="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-amber-300 border border-slate-700 font-medium">Tube ${infoA.tubeName}</span>
                            </div>
                            <div class="text-[11px] text-blue-400 font-medium truncate" title="${escapeHtml(s.cableA || 'Kabel Masuk')}">
                                <i class="fa-solid fa-arrow-right-to-bracket text-[9px] mr-0.5"></i> ${escapeHtml(s.cableA || 'Kabel Masuk')}
                            </div>
                        </div>
                    </div>

                    <!-- Center: Status & Parameter Loss -->
                    <div class="flex flex-row sm:flex-col items-center justify-between sm:justify-center px-2 py-1 sm:py-0 w-full sm:w-auto border-y sm:border-y-0 sm:border-x border-slate-750 my-0.5 sm:my-0 flex-shrink-0 gap-1">
                        <div>${badge}</div>
                        ${s.lossDb ? `<div class="text-[10px] text-slate-400 font-mono">${s.lossDb} dB</div>` : ''}
                    </div>

                    <!-- SISI B (Kabel Keluar) -->
                    <div class="flex items-center gap-2.5 min-w-0 flex-1 w-full sm:w-auto justify-end text-right">
                        <div class="truncate">
                            <div class="font-bold text-white text-xs truncate flex items-center justify-end gap-1.5">
                                <span class="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-amber-300 border border-slate-700 font-medium">Tube ${infoB.tubeName}</span>
                                <span>Core ${infoB.coreNum} (${infoB.name})</span>
                            </div>
                            <div class="text-[11px] text-emerald-400 font-medium truncate" title="${escapeHtml(s.cableB || 'Kabel Keluar')}">
                                ${escapeHtml(s.cableB || 'Kabel Keluar')} <i class="fa-solid fa-arrow-right-from-bracket text-[9px] ml-0.5"></i>
                            </div>
                        </div>
                        <div class="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs shadow flex-shrink-0" 
                             style="background:${infoB.hex}; color:${infoB.text}; border: 1.5px solid ${infoB.border}">
                            ${infoB.coreNum}
                        </div>
                    </div>

                    <!-- Delete Action (Admin / Super Admin Only) -->
                    ${canWrite ? `
                        <div class="flex items-center justify-end w-full sm:w-auto pt-1 sm:pt-0 sm:pl-1 border-t sm:border-t-0 sm:border-l border-slate-750 flex-shrink-0">
                            <button onclick="deleteNodeSplice('${node.id}', '${s.id}')" title="Hapus sambungan ini" class="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-slate-750 transition text-xs">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        </div>
                    ` : ''}
                </div>

                <!-- Prominent Deskripsi / Catatan Lapangan -->
                ${s.note ? `
                    <div class="pt-2 border-t border-slate-800 flex items-start gap-2 text-xs bg-slate-900/60 px-2.5 py-1.5 rounded-lg border border-amber-500/20">
                        <i class="fa-solid fa-note-sticky text-amber-400 text-xs mt-0.5 flex-shrink-0"></i>
                        <div class="flex-1 min-w-0">
                            <span class="text-[10px] text-amber-300 font-bold uppercase tracking-wider block">Catatan / Note:</span>
                            <span class="text-slate-100 font-medium break-words">${escapeHtml(s.note)}</span>
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');
}

function saveNewNodeSplice() {
    if (typeof hasWritePermission === 'function' && !hasWritePermission()) {
        alert('Akses Ditolak: Diperlukan hak akses Admin untuk mengubah data sambungan core.');
        return;
    }
    const nList = (typeof nodes !== 'undefined' && Array.isArray(nodes)) ? nodes : (window.nodes || []);
    const node = nList.find(n => n.id === currentSpliceNodeId);
    if (!node) return;

    const cableA = (document.getElementById('splice-input-cable-a')?.value || '').trim() || 'Kabel Masuk';
    const coreA = parseInt(document.getElementById('splice-input-core-a')?.value) || 1;
    const cableB = (document.getElementById('splice-input-cable-b')?.value || '').trim() || 'Kabel Keluar';
    const coreB = parseInt(document.getElementById('splice-input-core-b')?.value) || 1;
    const status = document.getElementById('splice-input-status')?.value || 'aktif';
    const lossDb = (document.getElementById('splice-input-loss')?.value || '').trim();
    const note = (document.getElementById('splice-input-note')?.value || '').trim();

    if (!Array.isArray(node.splices)) node.splices = [];

    const newSplice = {
        id: 'spl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        cableA,
        coreA,
        cableB,
        coreB,
        status,
        lossDb: lossDb || '0.02',
        note,
        updatedAt: new Date().toISOString()
    };

    node.splices.push(newSplice);

    if (typeof logActivity === 'function') {
        const infoA = getCoreColorInfo(coreA);
        const infoB = getCoreColorInfo(coreB);
        logActivity('splice_create', `Sambung Core di ${node.name}`, `Kabel "${cableA}" (Core ${coreA} - ${infoA.name}) ➔ "${cableB}" (Core ${coreB} - ${infoB.name}) [Status: ${status}, Loss: ${lossDb || '0.02'} dB]`);
    }

    // Kosongkan kolom note agar siap untuk sambungan berikutnya jika mau
    const noteInput = document.getElementById('splice-input-note');
    if (noteInput) noteInput.value = '';

    if (typeof saveAndRefresh === 'function') saveAndRefresh();
    renderNodeSpliceList(node);
    renderSpliceTubeAndCorePicker('a');
    renderSpliceTubeAndCorePicker('b');

    if (typeof showToast === 'function') {
        const infoA = getCoreColorInfo(coreA);
        const infoB = getCoreColorInfo(coreB);
        showToast(`✅ Sambungan Core ${coreA} (${infoA.name} - Tube ${infoA.tubeName}) ➔ Core ${coreB} (${infoB.name} - Tube ${infoB.tubeName}) disimpan!`);
    }
}

function quickAutoSplice12() {
    if (typeof hasWritePermission === 'function' && !hasWritePermission()) {
        alert('Akses Ditolak: Diperlukan hak akses Admin.');
        return;
    }
    const nList = (typeof nodes !== 'undefined' && Array.isArray(nodes)) ? nodes : (window.nodes || []);
    const node = nList.find(n => n.id === currentSpliceNodeId);
    if (!node) return;

    const defaultCableA = document.getElementById('splice-input-cable-a')?.value || 'Kabel Masuk';
    const defaultCableB = document.getElementById('splice-input-cable-b')?.value || 'Kabel Keluar';

    const cableA = prompt('Masukkan nama Kabel A (Kabel Masuk):', defaultCableA);
    if (!cableA) return;
    const cableB = prompt('Masukkan nama Kabel B (Kabel Keluar):', defaultCableB);
    if (!cableB) return;

    const count = currentCoresPerTube || 6;
    if (!confirm(`Buat otomatis ${count} sambungan lurus (Core 1–${count} "${cableA}" ➔ Core 1–${count} "${cableB}")?`)) return;

    if (!Array.isArray(node.splices)) node.splices = [];

    for (let i = 1; i <= count; i++) {
        const existing = node.splices.find(s => s.cableA === cableA && s.coreA === i && s.cableB === cableB && s.coreB === i);
        if (!existing) {
            node.splices.push({
                id: 'spl_' + Date.now() + '_' + i + '_' + Math.random().toString(36).substr(2, 3),
                cableA,
                coreA: i,
                cableB,
                coreB: i,
                status: 'aktif',
                lossDb: '0.02',
                note: `Tube 1 (1:1)`,
                updatedAt: new Date().toISOString()
            });
        }
    }

    if (typeof logActivity === 'function') {
        logActivity('splice_create', `Auto-Splice ${count} Core di ${node.name}`, `Sambung lurus 1:1 Kabel "${cableA}" (Core 1–${count}) ➔ "${cableB}"`);
    }

    if (typeof saveAndRefresh === 'function') saveAndRefresh();
    renderNodeSpliceList(node);
    renderSpliceTubeAndCorePicker('a');
    renderSpliceTubeAndCorePicker('b');

    if (typeof showToast === 'function') {
        showToast(`⚡ ${count} Sambungan Core (1:1) berhasil dibuat otomatis!`);
    }
}

function deleteNodeSplice(nodeId, spliceId) {
    if (typeof hasWritePermission === 'function' && !hasWritePermission()) {
        alert('Akses Ditolak: Diperlukan hak akses Admin.');
        return;
    }
    const nList = (typeof nodes !== 'undefined' && Array.isArray(nodes)) ? nodes : (window.nodes || []);
    const node = nList.find(n => n.id === nodeId);
    if (!node || !Array.isArray(node.splices)) return;

    if (!confirm('Hapus baris sambungan core ini?')) return;

    const targetSplice = node.splices.find(s => s.id === spliceId);
    node.splices = node.splices.filter(s => s.id !== spliceId);

    if (typeof logActivity === 'function' && targetSplice) {
        logActivity('splice_delete', `Hapus Sambungan Core di ${node.name}`, `Sambungan Kabel "${targetSplice.cableA}" (Core ${targetSplice.coreA}) ➔ "${targetSplice.cableB}" (Core ${targetSplice.coreB}) dihapus`);
    }

    if (typeof saveAndRefresh === 'function') saveAndRefresh();
    renderNodeSpliceList(node);
    renderSpliceTubeAndCorePicker('a');
    renderSpliceTubeAndCorePicker('b');

    if (typeof showToast === 'function') {
        showToast('Sambungan core telah dihapus.');
    }
}

function exportNodeSplicesCSV() {
    const nList = (typeof nodes !== 'undefined' && Array.isArray(nodes)) ? nodes : (window.nodes || []);
    const node = nList.find(n => n.id === currentSpliceNodeId);
    if (!node || !Array.isArray(node.splices) || node.splices.length === 0) {
        alert('Belum ada data sambungan core untuk diekspor pada titik ini.');
        return;
    }

    let csvContent = 'No,Titik,Kabel_A,Core_A,Warna_A,Tube_A,Status,Loss_dB,Kabel_B,Core_B,Warna_B,Tube_B,Catatan_Note\n';
    node.splices.forEach((s, idx) => {
        const infoA = getCoreColorInfo(s.coreA);
        const infoB = getCoreColorInfo(s.coreB);
        const cleanNote = (s.note || '').replace(/"/g, '""');
        csvContent += `${idx + 1},"${node.name}","${s.cableA}",${s.coreA},"${infoA.name}","Tube ${infoA.tubeName}","${s.status}","${s.lossDb || '0.02'}","${s.cableB}",${s.coreB},"${infoB.name}","Tube ${infoB.tubeName}","${cleanNote}"\n`;
    });

    const filename = `Splicing_${(node.name || 'Titik').replace(/[^a-zA-Z0-9_-]/g, '_')}.csv`;
    if (typeof downloadFile === 'function') {
        downloadFile(csvContent, filename, 'text/csv');
    } else {
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }
}

if (typeof window !== 'undefined') {
    window.openNodeSplicingModal = openNodeSplicingModal;
    window.closeNodeSplicingModal = closeNodeSplicingModal;
    window.toggleSpliceInputForm = toggleSpliceInputForm;
    window.updateSplicePreviewColors = updateSplicePreviewColors;
    window.setQuickCore = setQuickCore;
    window.syncCoreBWithA = syncCoreBWithA;
    window.setCoresPerTube = setCoresPerTube;
    window.saveNewNodeSplice = saveNewNodeSplice;
    window.quickAutoSplice12 = quickAutoSplice12;
    window.deleteNodeSplice = deleteNodeSplice;
    window.exportNodeSplicesCSV = exportNodeSplicesCSV;
    window.setSpliceFilter = setSpliceFilter;
    window.onSpliceSearchChange = onSpliceSearchChange;
    window.renderSpliceTubeAndCorePicker = renderSpliceTubeAndCorePicker;
    window.selectSpliceTube = selectSpliceTube;
    window.selectSpliceCore = selectSpliceCore;
    window.onSpliceCableInputChange = onSpliceCableInputChange;
    window.onSpliceCapacityChange = onSpliceCapacityChange;
    window.onSpliceCoreInputType = onSpliceCoreInputType;
}

