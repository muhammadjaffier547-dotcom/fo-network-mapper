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
    document.getElementById('core-matrix-subtitle').innerText = `Kapasitas: ${cable.coreSpec} | Standar Kode Warna TIA/EIA-598`;

    const totalCores = parseCoreCount(cable.coreSpec);
    const numTubes = Math.max(1, Math.ceil(totalCores / 12));

    // Inisialisasi struktur core data jika belum ada
    if (!cable.cores || cable.cores.length !== totalCores) {
        cable.cores = [];
        for (let i = 1; i <= totalCores; i++) {
            const colorIdx = (i - 1) % 12;
            const tubeIdx = Math.floor((i - 1) / 12);
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
                <span class="text-[10px] text-slate-400">Core ${(t * 12) + 1} - ${Math.min((t + 1) * 12, totalCores)}</span>
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

    modal.classList.remove('hidden');
}

function closeCoreMatrixModal() {
    const modal = document.getElementById('modal-core-matrix');
    if (modal) modal.classList.add('hidden');
}

function saveCoreMatrixData() {
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

