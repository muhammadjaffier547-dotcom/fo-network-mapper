/**
 * FO Network Mapper - Cloud Synchronization Module
 * Sinkronisasi Real-Time Otomatis Antar-Device (HP, Laptop, PC, Beda Akun)
 * Menggunakan Cloud Key-Value Store dengan zero-configuration.
 */

const CLOUD_SYNC_DATA_URL = 'https://kvdb.io/4dWtqHRCz5KWSBo5JMehvh/fo_network_data';
const CLOUD_SYNC_USERS_URL = 'https://kvdb.io/4dWtqHRCz5KWSBo5JMehvh/fo_users_data';

let isCloudSyncInProgress = false;
let cloudSyncTimer = null;
let lastKnownCloudUpdatedAt = null;

/**
 * Render Pill Indikator Cloud Sync di Floating Map Pill
 */
function renderCloudSyncPill(status = 'synced', text = 'Cloud: Otomatis') {
    const container = document.getElementById('cloud-sync-pill-container');
    if (!container) return;

    let badgeHtml = '';
    if (status === 'syncing') {
        badgeHtml = `
            <button onclick="triggerManualCloudSync()" title="Sedang menyinkronkan data dengan Cloud Server..." class="px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-indigo-900/80 hover:bg-indigo-800 text-indigo-200 border border-indigo-500/50 shadow-lg backdrop-blur flex items-center gap-1.5 transition">
                <i class="fa-solid fa-arrows-rotate fa-spin text-indigo-300"></i>
                <span class="hidden sm:inline">${text}</span>
            </button>
        `;
    } else if (status === 'synced') {
        badgeHtml = `
            <button onclick="triggerManualCloudSync()" title="Data tersinkron otomatis ke Cloud. Klik untuk refresh paksa." class="px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-800/90 hover:bg-slate-750 text-slate-200 border border-emerald-500/50 shadow-lg backdrop-blur flex items-center gap-1.5 transition">
                <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <i class="fa-solid fa-cloud text-emerald-400 text-xs"></i>
                <span class="hidden sm:inline text-emerald-300 font-medium">Cloud Sinkron</span>
            </button>
        `;
    } else if (status === 'offline') {
        badgeHtml = `
            <button onclick="triggerManualCloudSync()" title="Koneksi Cloud terputus / offline. Data tersimpan di memori lokal browser. Klik untuk coba lagi." class="px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-800/90 hover:bg-slate-750 text-amber-300 border border-amber-500/50 shadow-lg backdrop-blur flex items-center gap-1.5 transition">
                <span class="w-2 h-2 rounded-full bg-amber-400"></span>
                <i class="fa-solid fa-cloud-arrow-down text-amber-400 text-xs"></i>
                <span class="hidden sm:inline">Offline (Lokal)</span>
            </button>
        `;
    }

    container.innerHTML = badgeHtml;
}

/**
 * Kirim data perubahan lokal ke Cloud (Auto-Upload)
 */
async function pushDataToCloud(payload) {
    if (typeof hasWritePermission === 'function' && !hasWritePermission()) {
        console.warn('[CloudSync] Upload dilewati: Hak akses Read-Only / Guest.');
        return;
    }

    if (!payload || !payload.nodes || !payload.cables) {
        payload = {
            nodes: (typeof nodes !== 'undefined') ? nodes : (window.nodes || []),
            cables: (typeof cables !== 'undefined') ? cables : (window.cables || []),
            activityLogs: (typeof activityLogs !== 'undefined') ? activityLogs : (window.activityLogs || []),
            updatedAt: new Date().toISOString(),
            updatedBy: (typeof getCurrentUser === 'function' && getCurrentUser()) ? getCurrentUser().name : 'Admin'
        };
    } else if (!payload.activityLogs) {
        payload.activityLogs = (typeof activityLogs !== 'undefined') ? activityLogs : (window.activityLogs || []);
    }

    renderCloudSyncPill('syncing', 'Menyimpan ke Cloud...');

    try {
        const res = await fetch(CLOUD_SYNC_DATA_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            lastKnownCloudUpdatedAt = payload.updatedAt;
            localStorage.setItem('fo_mapper_updated_at', payload.updatedAt);
            renderCloudSyncPill('synced', 'Cloud: Tersinkron');
            console.log(`[CloudSync] Berhasil upload ${payload.nodes.length} titik & ${payload.cables.length} kabel ke Cloud.`);
        } else {
            console.warn('[CloudSync] Server Cloud merespon status:', res.status);
            renderCloudSyncPill('offline', 'Offline');
        }
    } catch (err) {
        console.warn('[CloudSync] Gagal upload ke Cloud (Offline):', err.message);
        renderCloudSyncPill('offline', 'Offline');
    }
}

/**
 * Tarik data terbaru dari Cloud (Auto-Download / Sync)
 */
async function pullDataFromCloud(isManual = false) {
    if (isCloudSyncInProgress) return;
    
    // Jangan overwrite jika sedang menggambar kabel di peta agar tidak mengganggu teknisi
    if (typeof isDrawingCable !== 'undefined' && isDrawingCable) return;
    if (typeof currentEditingCableId !== 'undefined' && currentEditingCableId) return;

    isCloudSyncInProgress = true;
    if (isManual) renderCloudSyncPill('syncing', 'Memeriksa Cloud...');

    try {
        const res = await fetch(CLOUD_SYNC_DATA_URL, {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        });

        if (!res.ok) {
            renderCloudSyncPill('offline', 'Offline');
            isCloudSyncInProgress = false;
            return;
        }

        const cloudData = await res.json();
        const localUpdatedAt = localStorage.getItem('fo_mapper_updated_at') || '';
        const currentNodes = (typeof nodes !== 'undefined') ? nodes : (window.nodes || []);
        const currentCables = (typeof cables !== 'undefined') ? cables : (window.cables || []);

        const cloudHasData = cloudData && ((cloudData.nodes && cloudData.nodes.length > 0) || (cloudData.cables && cloudData.cables.length > 0));
        const localHasData = (currentNodes.length > 0 || currentCables.length > 0);

        // SKENARIO 1: Cloud masih kosong tapi Local ada data -> Upload data lokal ke Cloud sekarang juga!
        if (!cloudHasData && localHasData) {
            console.log('[CloudSync] Cloud masih kosong, mengunggah data lokal yang sudah ada ke Cloud...');
            await pushDataToCloud({
                nodes: currentNodes,
                cables: currentCables,
                updatedAt: new Date().toISOString(),
                updatedBy: (typeof getCurrentUser === 'function' && getCurrentUser()) ? getCurrentUser().name : 'Admin'
            });
            isCloudSyncInProgress = false;
            return;
        }

        // SKENARIO 2: Cloud memiliki data dan berbeda dari lokal atau lebih baru -> Terapkan ke Peta!
        if (cloudHasData) {
            const isDifferent = (cloudData.updatedAt && cloudData.updatedAt !== localUpdatedAt) ||
                                (currentNodes.length !== cloudData.nodes.length) ||
                                (currentCables.length !== cloudData.cables.length) ||
                                isManual;

            if (isDifferent) {
                console.log(`[CloudSync] Data baru terdeteksi dari Cloud (${cloudData.nodes.length} titik, ${cloudData.cables.length} kabel). Memperbarui tampilan peta...`);
                
                // Hapus layer lama di Leaflet
                if (typeof nodeMarkers !== 'undefined' && typeof map !== 'undefined' && map) {
                    Object.values(nodeMarkers).forEach(m => map.removeLayer(m));
                    nodeMarkers = {};
                }
                if (typeof cablePolylines !== 'undefined' && typeof map !== 'undefined' && map) {
                    Object.values(cablePolylines).forEach(p => map.removeLayer(p));
                    cablePolylines = {};
                }

                // Perbarui array data
                nodes = Array.isArray(cloudData.nodes) ? cloudData.nodes : [];
                cables = Array.isArray(cloudData.cables) ? cloudData.cables : [];
                if (Array.isArray(cloudData.activityLogs)) {
                    activityLogs = cloudData.activityLogs;
                    window.activityLogs = activityLogs;
                    if (typeof renderActivityLogList === 'function') renderActivityLogList();
                }
                window.nodes = nodes;
                window.cables = cables;

                // Render ulang marker dan polyline
                if (typeof renderNodeMarker === 'function') nodes.forEach(renderNodeMarker);
                if (typeof renderCablePolyline === 'function') cables.forEach(renderCablePolyline);

                // Perbarui localStorage cache lokal
                const currentLogs = (typeof activityLogs !== 'undefined') ? activityLogs : [];
                localStorage.setItem('fo_mapper_data', JSON.stringify({ nodes, cables, activityLogs: currentLogs }));
                lastKnownCloudUpdatedAt = cloudData.updatedAt || new Date().toISOString();
                localStorage.setItem('fo_mapper_updated_at', lastKnownCloudUpdatedAt);

                if (typeof updateUI === 'function') updateUI();

                if (isManual && typeof showToast === 'function') {
                    showToast(`☁️ Sinkronisasi berhasil! ${nodes.length} Titik & ${cables.length} Jalur Kabel aktif.`);
                }
            }
        }

        renderCloudSyncPill('synced', 'Cloud: Tersinkron');
    } catch (err) {
        console.warn('[CloudSync] Gagal menarik data dari Cloud:', err.message);
        renderCloudSyncPill('offline', 'Offline');
        if (isManual && typeof showToast === 'function') {
            showToast('⚠️ Gagal terhubung ke Cloud. Pastikan koneksi internet aktif.');
        }
    } finally {
        isCloudSyncInProgress = false;
    }
}

/**
 * Pemicu sinkronisasi manual saat tombol Cloud di-klik
 */
function triggerManualCloudSync() {
    pullDataFromCloud(true);
}

/**
 * Sinkronisasi daftar akun pengguna (Users) ke Cloud agar Super Admin bisa buat akun dan langsung aktif di semua HP
 */
async function syncUsersWithCloud() {
    try {
        const res = await fetch(CLOUD_SYNC_USERS_URL);
        if (res.ok) {
            const cloudUsers = await res.json();
            if (Array.isArray(cloudUsers) && cloudUsers.length > 0) {
                const localUsers = (typeof getStoredLocalUsers === 'function') ? getStoredLocalUsers() : [];
                // Merge users
                const mergedMap = new Map();
                localUsers.forEach(u => mergedMap.set(u.username.toLowerCase(), u));
                cloudUsers.forEach(u => mergedMap.set(u.username.toLowerCase(), u));
                const merged = Array.from(mergedMap.values());
                if (typeof saveStoredLocalUsers === 'function') {
                    saveStoredLocalUsers(merged);
                }
            }
        }
    } catch (e) {}
}

async function pushUsersToCloud(users) {
    try {
        await fetch(CLOUD_SYNC_USERS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(users)
        });
    } catch (e) {}
}

/**
 * Inisialisasi Cloud Sync saat peta selesai dimuat
 */
function initCloudSync() {
    renderCloudSyncPill('syncing', 'Menghubungkan ke Cloud...');
    
    // Tarik data saat pertama kali aplikasi dibuka
    setTimeout(() => {
        pullDataFromCloud(false);
        syncUsersWithCloud();
    }, 600);

    // Polling otomatis setiap 12 detik saat jendela browser aktif
    if (cloudSyncTimer) clearInterval(cloudSyncTimer);
    cloudSyncTimer = setInterval(() => {
        if (!document.hidden && navigator.onLine) {
            pullDataFromCloud(false);
        }
    }, 12000);

    // Auto-sync saat kembali ke tab atau saat internet kembali menyala
    window.addEventListener('focus', () => {
        pullDataFromCloud(false);
    });
    window.addEventListener('online', () => {
        pullDataFromCloud(false);
    });
}

// Export ke window
if (typeof window !== 'undefined') {
    window.initCloudSync = initCloudSync;
    window.pushDataToCloud = pushDataToCloud;
    window.pullDataFromCloud = pullDataFromCloud;
    window.triggerManualCloudSync = triggerManualCloudSync;
    window.renderCloudSyncPill = renderCloudSyncPill;
    window.pushUsersToCloud = pushUsersToCloud;
    window.syncUsersWithCloud = syncUsersWithCloud;
}

