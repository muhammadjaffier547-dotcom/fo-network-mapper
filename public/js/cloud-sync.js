/**
 * FO Network Mapper - Cloud Synchronization Module
 * Sinkronisasi Real-Time Otomatis Antar-Device (HP, Laptop, PC, Beda Akun)
 * Menggunakan Cloud Key-Value Store dengan zero-configuration.
 */

// Endpoint Sinkronisasi Cloud:
// 1. Primary API: Vercel Serverless Function (/api/sync)
// 2. Direct Gist API Fallback: GitHub Gist (80d7fe9d65a6e2b114c38475bd746b37) berkapasitas besar (100MB) tanpa batas 16KB!
const PRIMARY_SYNC_API = (typeof window !== 'undefined' && window.location && window.location.origin && window.location.origin.startsWith('http') && !window.location.origin.includes('localhost'))
    ? `${window.location.origin}/api/sync`
    : 'https://fo-network-mapper.vercel.app/api/sync';

// Kunci Otentikasi Sah Aplikasi untuk akses API Server
const FO_APP_KEY = 'fo_sec_9x8k2m7q4p1w5v0z_2026';
const GIST_API_FALLBACK = 'https://api.github.com/gists/80d7fe9d65a6e2b114c38475bd746b37';

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

    const currentLogs = (typeof getActivityLogs === 'function') ? getActivityLogs() : ((typeof window.activityLogs !== 'undefined' && Array.isArray(window.activityLogs)) ? window.activityLogs : (window.activityLogs || []));

    if (!payload || !payload.nodes || !payload.cables) {
        payload = {
            nodes: (typeof nodes !== 'undefined') ? nodes : (window.nodes || []),
            cables: (typeof cables !== 'undefined') ? cables : (window.cables || []),
            activityLogs: currentLogs,
            updatedAt: new Date().toISOString(),
            updatedBy: (typeof getCurrentUser === 'function' && getCurrentUser()) ? (getCurrentUser().name || getCurrentUser().username) : 'Admin'
        };
    } else if (!payload.activityLogs || payload.activityLogs.length === 0) {
        payload.activityLogs = currentLogs;
    }

    renderCloudSyncPill('syncing', 'Menyimpan ke Cloud...');

    let uploadSuccess = false;

    // Upload via Vercel Serverless API dengan Header Otentikasi Sah
    try {
        const res = await fetch(`${PRIMARY_SYNC_API}?type=network`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-fo-app-key': FO_APP_KEY
            },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            uploadSuccess = true;
        } else {
            console.warn('[CloudSync] Server Cloud merespon status:', res.status);
        }
    } catch (err) {
        console.warn('[CloudSync] Primary API POST gagal:', err.message);
    }

    if (uploadSuccess) {
        lastKnownCloudUpdatedAt = payload.updatedAt;
        localStorage.setItem('fo_mapper_updated_at', payload.updatedAt);
        renderCloudSyncPill('synced', 'Cloud: Tersinkron');
        console.log(`[CloudSync] Berhasil upload ${payload.nodes.length} titik, ${payload.cables.length} kabel & ${(payload.activityLogs || []).length} log ke Cloud.`);
    } else {
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

    let cloudData = null;

    // 1. Coba ambil dari Primary API
    // 1. Coba ambil dari Primary API dengan Kunci Otentikasi
    try {
        const fetchUrl = `${PRIMARY_SYNC_API}?type=network&_cb=${Date.now()}`;
        const res = await fetch(fetchUrl, {
            method: 'GET',
            cache: 'no-store',
            headers: {
                'Accept': 'application/json',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'x-fo-app-key': FO_APP_KEY
            }
        });
        if (res.ok) {
            cloudData = await res.json();
        }
    } catch (err) {
        console.warn('[CloudSync] Primary API GET gagal, mencoba direct Gist fallback...', err.message);
    }

    // 2. Direct Gist API Fallback (Public Read - Zero Token Required)
    if (!cloudData) {
        try {
            const fetchUrl = `${GIST_API_FALLBACK}?_cb=${Date.now()}`;
            const res = await fetch(fetchUrl, {
                method: 'GET',
                cache: 'no-store',
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'Cache-Control': 'no-cache, no-store, must-revalidate'
                }
            });
            if (res.ok) {
                const gist = await res.json();
                const file = gist.files && gist.files['fo_network_data.json'];
                if (file) {
                    if (file.truncated && file.raw_url) {
                        const rawRes = await fetch(file.raw_url);
                        cloudData = await rawRes.json();
                    } else if (file.content) {
                        cloudData = JSON.parse(file.content);
                    }
                }
            }
        } catch (err) {
            console.warn('[CloudSync] Direct Gist GET fallback gagal:', err.message);
        }
    }

    if (!cloudData) {
        renderCloudSyncPill('offline', 'Offline');
        isCloudSyncInProgress = false;
        if (isManual && typeof showToast === 'function') {
            showToast('⚠️ Gagal terhubung ke Cloud. Pastikan koneksi internet aktif.');
        }
        return;
    }

    try {
        const localUpdatedAt = localStorage.getItem('fo_mapper_updated_at') || '';
        const currentNodes = (typeof window.nodes !== 'undefined' && Array.isArray(window.nodes)) ? window.nodes : [];
        const currentCables = (typeof window.cables !== 'undefined' && Array.isArray(window.cables)) ? window.cables : [];
        const currentLogs = (typeof getActivityLogs === 'function') ? getActivityLogs() : ((typeof window.activityLogs !== 'undefined' && Array.isArray(window.activityLogs)) ? window.activityLogs : []);

        const cloudHasData = cloudData && ((cloudData.nodes && cloudData.nodes.length > 0) || (cloudData.cables && cloudData.cables.length > 0));
        const localHasData = (currentNodes.length > 0 || currentCables.length > 0);

        // SKENARIO 1: Cloud masih kosong tapi Local ada data -> Upload data lokal ke Cloud sekarang juga!
        if (!cloudHasData && localHasData) {
            console.log('[CloudSync] Cloud masih kosong, mengunggah data lokal yang sudah ada ke Cloud...');
            await pushDataToCloud({
                nodes: currentNodes,
                cables: currentCables,
                activityLogs: currentLogs,
                updatedAt: new Date().toISOString(),
                updatedBy: (typeof getCurrentUser === 'function' && getCurrentUser()) ? getCurrentUser().name : 'Admin'
            });
            isCloudSyncInProgress = false;
            return;
        }

        // SKENARIO 2: Cloud memiliki data dan berbeda dari lokal atau sinkronisasi manual -> Terapkan ke Peta!
        if (cloudHasData) {
            const cloudLogsCount = (cloudData.activityLogs && Array.isArray(cloudData.activityLogs)) ? cloudData.activityLogs.length : 0;
            const isDifferent = (cloudData.updatedAt && cloudData.updatedAt !== localUpdatedAt) ||
                                (currentNodes.length !== cloudData.nodes.length) ||
                                (currentCables.length !== cloudData.cables.length) ||
                                (cloudLogsCount !== currentLogs.length) ||
                                isManual;

            if (isDifferent) {
                console.log(`[CloudSync] Data baru diterima dari Cloud (${cloudData.nodes.length} titik, ${cloudData.cables.length} kabel, ${cloudLogsCount} log). Memperbarui tampilan peta...`);
                
                // Gunakan setter terpusat di app.js yang terhubung langsung ke Leaflet & internal arrays
                if (typeof window.setNetworkData === 'function') {
                    // Geser kamera jika pemuatan awal atau jumlah titik bertambah atau tombol manual ditekan
                    const shouldFit = isManual || (currentNodes.length === 0) || (currentNodes.length < cloudData.nodes.length);
                    window.setNetworkData(cloudData.nodes, cloudData.cables, cloudData.activityLogs, shouldFit);
                }

                lastKnownCloudUpdatedAt = cloudData.updatedAt || new Date().toISOString();
                localStorage.setItem('fo_mapper_updated_at', lastKnownCloudUpdatedAt);

                if (isManual && typeof showToast === 'function') {
                    showToast(`☁️ Sinkronisasi berhasil! ${cloudData.nodes.length} Titik, ${cloudData.cables.length} Jalur & ${cloudLogsCount} Log aktif.`);
                } else if (typeof showToast === 'function' && isDifferent && (currentNodes.length !== cloudData.nodes.length || currentCables.length !== cloudData.cables.length)) {
                    showToast(`☁️ Update Cloud diterima: ${cloudData.nodes.length} Titik & ${cloudData.cables.length} Jalur Kabel.`);
                }
            }
        }

        renderCloudSyncPill('synced', 'Cloud: Tersinkron');
    } catch (err) {
        console.warn('[CloudSync] Error memproses data Cloud:', err.message);
        renderCloudSyncPill('offline', 'Offline');
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
        let cloudUsers = null;
        try {
            const res = await fetch(`${PRIMARY_SYNC_API}?type=users&_cb=${Date.now()}`, {
                headers: {
                    'x-fo-app-key': FO_APP_KEY
                }
            });
            if (res.ok) cloudUsers = await res.json();
        } catch (e) {}

        if (!cloudUsers) {
            try {
                const res = await fetch(`${GIST_API_FALLBACK}?_cb=${Date.now()}`, {
                    headers: { 'Accept': 'application/vnd.github.v3+json' }
                });
                if (res.ok) {
                    const gist = await res.json();
                    if (gist.files && gist.files['fo_users_data.json']) {
                        cloudUsers = JSON.parse(gist.files['fo_users_data.json'].content || '[]');
                    }
                }
            } catch (e) {}
        }

        if (Array.isArray(cloudUsers) && cloudUsers.length > 0) {
            const localUsers = (typeof getStoredLocalUsers === 'function') ? getStoredLocalUsers() : [];
            const mergedMap = new Map();
            localUsers.forEach(u => mergedMap.set(u.username.toLowerCase(), u));
            cloudUsers.forEach(u => mergedMap.set(u.username.toLowerCase(), u));
            const merged = Array.from(mergedMap.values());
            if (typeof saveStoredLocalUsers === 'function') {
                saveStoredLocalUsers(merged);
            }
        }
    } catch (e) {}
}

async function pushUsersToCloud(users) {
    try {
        const res = await fetch(`${PRIMARY_SYNC_API}?type=users`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-fo-app-key': FO_APP_KEY
            },
            body: JSON.stringify(users)
        });
        if (!res.ok) {
            console.warn('[CloudSync] Server Cloud gagal menyimpan akun pengguna, status:', res.status);
        }
    } catch (e) {
        console.warn('[CloudSync] pushUsersToCloud error:', e.message);
    }
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
    }, 100);

    // Polling otomatis setiap 8 detik saat jendela browser aktif
    if (cloudSyncTimer) clearInterval(cloudSyncTimer);
    cloudSyncTimer = setInterval(() => {
        if (!document.hidden && navigator.onLine) {
            pullDataFromCloud(false);
        }
    }, 8000);

    // Auto-sync saat kembali ke tab atau layar HP dibuka kembali
    window.addEventListener('focus', () => {
        pullDataFromCloud(false);
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            pullDataFromCloud(false);
        }
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

