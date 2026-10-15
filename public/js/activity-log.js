/**
 * FO Network Mapper - Activity Log & Audit Trail Module
 * Mencatat riwayat perubahan data jaringan: Siapa, Kapan, Apa yang diubah (Titik, Kabel, Splicing)
 */

let activityLogs = [];
let currentLogFilter = 'ALL';
let currentLogSearch = '';

// Inisialisasi awal log dari local storage browser
try {
    const savedInitial = localStorage.getItem('fo_mapper_data');
    if (savedInitial) {
        const parsedInitial = JSON.parse(savedInitial);
        if (Array.isArray(parsedInitial.activityLogs)) {
            activityLogs = parsedInitial.activityLogs;
        }
    }
} catch (e) {}
if (typeof window !== 'undefined') {
    window.activityLogs = activityLogs;
}

/**
 * Setter terpusat untuk memperbarui riwayat log dari cloud/storage
 */
function setActivityLogs(newLogs) {
    if (!Array.isArray(newLogs)) return;
    activityLogs = [...newLogs];
    window.activityLogs = activityLogs;
    renderActivityLogList();
}

/**
 * Getter terpusat untuk mengambil data log terbaru
 */
function getActivityLogs() {
    if (window.activityLogs && Array.isArray(window.activityLogs) && window.activityLogs.length > activityLogs.length) {
        activityLogs = window.activityLogs;
    }
    return activityLogs;
}

/**
 * Catat aktivitas baru ke dalam log
 * @param {string} actionType - 'node_create'|'node_update'|'node_delete'|'cable_create'|'cable_update'|'cable_delete'|'splice_create'|'splice_delete'|'reset'
 * @param {string} title - Judul ringkas aktivitas
 * @param {string} details - Detail perubahan (koordinat, nama kabel, nomor core, dll)
 */
function logActivity(actionType, title, details = '') {
    const user = (typeof getCurrentUser === 'function') ? getCurrentUser() : (window.currentAuthUser || null);

    const role = user ? (user.role || 'GUEST') : 'GUEST';
    const name = user ? (user.name || user.username || 'Pengunjung') : 'Pengunjung';
    const username = user ? (user.username || 'guest') : 'guest';
    const avatar = user ? (user.avatar || (role === 'SUPER_ADMIN' ? 'fa-user-shield' : (role === 'ADMIN' ? 'fa-user-gear' : 'fa-hard-hat'))) : 'fa-user';

    const entry = {
        id: 'log_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        timestamp: new Date().toISOString(),
        user: {
            id: user ? user.id : 'usr_anon',
            name: name,
            username: username,
            role: role,
            avatar: avatar
        },
        actionType: actionType,
        title: title,
        details: details
    };

    if (!Array.isArray(activityLogs)) activityLogs = [];
    activityLogs.unshift(entry);

    // Batasi log maksimal 150 item terakhir agar hemat memori & cepat
    if (activityLogs.length > 150) {
        activityLogs = activityLogs.slice(0, 150);
    }

    window.activityLogs = activityLogs;

    // Simpan ke local storage
    try {
        const saved = localStorage.getItem('fo_mapper_data');
        if (saved) {
            const parsed = JSON.parse(saved);
            parsed.activityLogs = activityLogs;
            localStorage.setItem('fo_mapper_data', JSON.stringify(parsed));
        }
    } catch (e) {}

    // Perbarui counter badge jika modal sedang terbuka
    const modal = document.getElementById('modal-activity-log');
    if (modal && !modal.classList.contains('hidden')) {
        renderActivityLogList();
    }
}

/**
 * Format timestamp ke format lokal Indonesia dan waktu relatif
 */
function formatLogTime(isoStr) {
    if (!isoStr) return '-';
    try {
        const date = new Date(isoStr);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMins / 60);

        let relative = '';
        if (diffMins < 1) relative = 'Baru saja';
        else if (diffMins < 60) relative = `${diffMins} mnt lalu`;
        else if (diffHours < 24) relative = `${diffHours} jam lalu`;
        else relative = `${Math.floor(diffHours / 24)} hari lalu`;

        const dateStr = date.toLocaleDateString('id-ID', {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
        });
        const timeStr = date.toLocaleTimeString('id-ID', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        return {
            full: `${dateStr}, ${timeStr}`,
            relative: relative
        };
    } catch (e) {
        return { full: isoStr, relative: '' };
    }
}

/**
 * Ambil badge tampilan role pengguna
 */
function getRoleBadgeHtml(role) {
    if (role === 'SUPER_ADMIN') {
        return `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1">
            <i class="fa-solid fa-user-shield text-[9px]"></i> Super Admin
        </span>`;
    } else if (role === 'ADMIN' || role === 'admin') {
        return `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1">
            <i class="fa-solid fa-user-gear text-[9px]"></i> Admin
        </span>`;
    } else {
        return `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/40 flex items-center gap-1">
            <i class="fa-solid fa-hard-hat text-[9px]"></i> Teknisi
        </span>`;
    }
}

/**
 * Ambil style dan ikon berdasarkan actionType
 */
function getActionMeta(actionType) {
    switch (actionType) {
        case 'node_create':
            return {
                icon: 'fa-location-dot',
                color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
                label: 'Titik Baru',
                category: 'node'
            };
        case 'node_update':
            return {
                icon: 'fa-pen-to-square',
                color: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
                label: 'Edit Titik',
                category: 'node'
            };
        case 'node_delete':
            return {
                icon: 'fa-trash-can',
                color: 'text-red-400 bg-red-500/10 border-red-500/30',
                label: 'Hapus Titik',
                category: 'delete'
            };
        case 'cable_create':
            return {
                icon: 'fa-draw-polygon',
                color: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
                label: 'Kabel Baru',
                category: 'cable'
            };
        case 'cable_update':
            return {
                icon: 'fa-bezier-curve',
                color: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/30',
                label: 'Edit Rute Kabel',
                category: 'cable'
            };
        case 'cable_delete':
            return {
                icon: 'fa-trash-can',
                color: 'text-red-400 bg-red-500/10 border-red-500/30',
                label: 'Hapus Kabel',
                category: 'delete'
            };
        case 'splice_create':
            return {
                icon: 'fa-arrows-split-up-and-left',
                color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30',
                label: 'Sambung Core',
                category: 'splice'
            };
        case 'splice_delete':
            return {
                icon: 'fa-link-slash',
                color: 'text-rose-400 bg-rose-500/10 border-rose-500/30',
                label: 'Hapus Sambungan',
                category: 'splice'
            };
        case 'reset':
            return {
                icon: 'fa-triangle-exclamation',
                color: 'text-red-400 bg-red-500/20 border-red-500/50',
                label: 'Reset Database',
                category: 'delete'
            };
        default:
            return {
                icon: 'fa-circle-info',
                color: 'text-slate-400 bg-slate-800 border-slate-700',
                label: 'Aktivitas',
                category: 'other'
            };
    }
}

/**
 * Filter log berdasarkan kategori
 */
function setLogFilter(cat) {
    currentLogFilter = cat;
    renderActivityLogList();
}

/**
 * Filter log berdasarkan kata kunci pencarian
 */
function onLogSearchChange(val) {
    currentLogSearch = val || '';
    renderActivityLogList();
}

/**
 * Buka modal Log Aktivitas
 */
function openActivityLogModal() {
    const modal = document.getElementById('modal-activity-log');
    if (!modal) return;
    currentLogFilter = 'ALL';
    currentLogSearch = '';
    const searchInput = document.getElementById('log-search-input');
    if (searchInput) searchInput.value = '';
    renderActivityLogList();
    modal.classList.remove('hidden');
}

/**
 * Tutup modal Log Aktivitas
 */
function closeActivityLogModal() {
    const modal = document.getElementById('modal-activity-log');
    if (modal) modal.classList.add('hidden');
}

/**
 * Render daftar riwayat aktivitas ke dalam modal
 */
function renderActivityLogList() {
    const container = document.getElementById('activity-log-feed');
    const badgeCount = document.getElementById('log-total-count-badge');
    const filterPills = document.getElementById('log-filter-pills');

    const logs = (typeof getActivityLogs === 'function') ? getActivityLogs() : (window.activityLogs || activityLogs || []);
    if (badgeCount) badgeCount.innerText = `${logs.length} Aktivitas Tercatat`;

    // Render filter pills
    if (filterPills) {
        const countAll = logs.length;
        const countSplice = logs.filter(l => getActionMeta(l.actionType).category === 'splice').length;
        const countNode = logs.filter(l => getActionMeta(l.actionType).category === 'node').length;
        const countCable = logs.filter(l => getActionMeta(l.actionType).category === 'cable').length;
        const countDelete = logs.filter(l => getActionMeta(l.actionType).category === 'delete').length;

        filterPills.innerHTML = `
            <button onclick="setLogFilter('ALL')" class="px-2.5 py-1 rounded-lg text-xs font-semibold transition whitespace-nowrap ${currentLogFilter === 'ALL' ? 'bg-indigo-600 text-white shadow' : 'bg-slate-800 text-slate-300 hover:bg-slate-750'}">
                Semua (${countAll})
            </button>
            <button onclick="setLogFilter('splice')" class="px-2.5 py-1 rounded-lg text-xs font-semibold transition whitespace-nowrap ${currentLogFilter === 'splice' ? 'bg-cyan-600 text-white shadow' : 'bg-slate-800 text-cyan-300 hover:bg-slate-750'}">
                <i class="fa-solid fa-arrows-split-up-and-left text-[11px] mr-1"></i> Splicing (${countSplice})
            </button>
            <button onclick="setLogFilter('node')" class="px-2.5 py-1 rounded-lg text-xs font-semibold transition whitespace-nowrap ${currentLogFilter === 'node' ? 'bg-emerald-600 text-white shadow' : 'bg-slate-800 text-emerald-300 hover:bg-slate-750'}">
                <i class="fa-solid fa-location-dot text-[11px] mr-1"></i> Titik (${countNode})
            </button>
            <button onclick="setLogFilter('cable')" class="px-2.5 py-1 rounded-lg text-xs font-semibold transition whitespace-nowrap ${currentLogFilter === 'cable' ? 'bg-blue-600 text-white shadow' : 'bg-slate-800 text-blue-300 hover:bg-slate-750'}">
                <i class="fa-solid fa-draw-polygon text-[11px] mr-1"></i> Kabel (${countCable})
            </button>
            ${countDelete > 0 ? `
                <button onclick="setLogFilter('delete')" class="px-2.5 py-1 rounded-lg text-xs font-semibold transition whitespace-nowrap ${currentLogFilter === 'delete' ? 'bg-rose-600 text-white shadow' : 'bg-slate-800 text-rose-300 hover:bg-slate-750'}">
                    <i class="fa-solid fa-trash-can text-[11px] mr-1"></i> Hapus (${countDelete})
                </button>
            ` : ''}
        `;
    }

    if (!container) return;

    // Filter data
    const filtered = logs.filter(log => {
        const meta = getActionMeta(log.actionType);
        const matchesFilter = (currentLogFilter === 'ALL') || (meta.category === currentLogFilter);
        const q = currentLogSearch.toLowerCase().trim();
        const matchesSearch = !q ||
            (log.title && log.title.toLowerCase().includes(q)) ||
            (log.details && log.details.toLowerCase().includes(q)) ||
            (log.user && log.user.name && log.user.name.toLowerCase().includes(q)) ||
            (log.user && log.user.username && log.user.username.toLowerCase().includes(q)) ||
            (meta.label && meta.label.toLowerCase().includes(q));

        return matchesFilter && matchesSearch;
    });

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="py-12 text-center text-slate-400 space-y-3 bg-slate-900/40 rounded-2xl border border-dashed border-slate-800 p-6">
                <div class="w-12 h-12 rounded-2xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 flex items-center justify-center mx-auto text-xl shadow">
                    <i class="fa-solid fa-clock-rotate-left"></i>
                </div>
                <h4 class="font-bold text-white text-sm">Belum Ada Riwayat Aktivitas</h4>
                <p class="text-xs text-slate-500 max-w-sm mx-auto">
                    ${currentLogSearch ? 'Tidak ditemukan aktivitas yang cocok dengan pencarian Anda.' : 'Setiap penambahan titik, penarikan kabel, atau penyambungan core oleh teknisi & admin akan otomatis tercatat di sini secara real-time.'}
                </p>
            </div>
        `;
        return;
    }

    container.innerHTML = filtered.map(log => {
        const meta = getActionMeta(log.actionType);
        const time = formatLogTime(log.timestamp);
        const user = log.user || { name: 'Anonim', role: 'GUEST', avatar: 'fa-user' };

        return `
            <div class="bg-slate-900/90 border border-slate-800 rounded-xl p-3 hover:border-slate-700 transition space-y-2 text-xs shadow-sm">
                <!-- Header Card: User Info & Timestamp -->
                <div class="flex items-center justify-between gap-2 border-b border-slate-800 pb-2">
                    <div class="flex items-center gap-2 min-w-0">
                        <div class="w-7 h-7 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 text-xs flex-shrink-0 shadow">
                            <i class="fa-solid ${user.avatar || 'fa-user'}"></i>
                        </div>
                        <div class="truncate leading-tight">
                            <div class="font-bold text-white text-xs truncate">${escapeHtml(user.name)}</div>
                            <div class="text-[10px] text-slate-400 font-mono">@${escapeHtml(user.username || 'user')}</div>
                        </div>
                        ${getRoleBadgeHtml(user.role)}
                    </div>
                    <div class="text-right flex-shrink-0">
                        <span class="text-[10px] text-indigo-400 font-semibold font-mono bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
                            ${time.relative}
                        </span>
                        <div class="text-[9px] text-slate-500 font-mono mt-0.5">${time.full}</div>
                    </div>
                </div>

                <!-- Body Card: Action Badge & Title -->
                <div class="flex items-start gap-2.5 pt-0.5">
                    <span class="w-7 h-7 rounded-lg border flex items-center justify-center text-xs flex-shrink-0 shadow-sm ${meta.color}">
                        <i class="fa-solid ${meta.icon}"></i>
                    </span>
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-1.5 flex-wrap">
                            <span class="text-[10px] font-bold px-1.5 py-0.5 rounded border ${meta.color}">
                                ${meta.label}
                            </span>
                            <span class="font-bold text-slate-100 text-xs">${escapeHtml(log.title)}</span>
                        </div>
                        ${log.details ? `
                            <div class="mt-1.5 p-2 rounded-lg bg-slate-950/80 border border-slate-800/80 text-[11px] text-slate-300 font-mono leading-relaxed break-words">
                                ${escapeHtml(log.details)}
                            </div>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Ekspor log aktivitas ke format CSV untuk laporan audit
 */
function exportActivityLogsCSV() {
    const logs = (typeof getActivityLogs === 'function') ? getActivityLogs() : (window.activityLogs || activityLogs || []);
    if (logs.length === 0) {
        alert('Belum ada data riwayat aktivitas untuk diekspor.');
        return;
    }

    let csv = 'No,Waktu,Pengguna,Username,Role,Tipe_Aksi,Judul,Keterangan\n';
    logs.forEach((log, idx) => {
        const meta = getActionMeta(log.actionType);
        const time = formatLogTime(log.timestamp).full;
        const u = log.user || {};
        const cleanTitle = (log.title || '').replace(/"/g, '""');
        const cleanDetails = (log.details || '').replace(/"/g, '""');
        csv += `${idx + 1},"${time}","${u.name || ''}","${u.username || ''}","${u.role || ''}","${meta.label}","${cleanTitle}","${cleanDetails}"\n`;
    });

    const filename = `Audit_Log_FO_${new Date().toISOString().slice(0, 10)}.csv`;
    if (typeof downloadFile === 'function') {
        downloadFile(csv, filename, 'text/csv');
    } else {
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }
}

/**
 * Bersihkan seluruh log aktivitas (Hanya Super Admin)
 */
function clearAllActivityLogs() {
    if (typeof isSuperAdmin === 'function' && !isSuperAdmin()) {
        alert('Akses Ditolak: Hanya Super Admin (jaffier) yang dapat membersihkan riwayat log.');
        return;
    }
    if (!confirm('Apakah Anda yakin ingin menghapus seluruh catatan riwayat aktivitas? Tindakan ini tidak dapat dibatalkan.')) return;

    activityLogs = [];
    window.activityLogs = [];
    renderActivityLogList();

    if (typeof saveAndRefresh === 'function') {
        saveAndRefresh();
    }

    if (typeof showToast === 'function') {
        showToast('Catatan riwayat aktivitas telah dibersihkan.');
    }
}

// Window exports
if (typeof window !== 'undefined') {
    window.activityLogs = activityLogs;
    window.logActivity = logActivity;
    window.setActivityLogs = setActivityLogs;
    window.getActivityLogs = getActivityLogs;
    window.openActivityLogModal = openActivityLogModal;
    window.closeActivityLogModal = closeActivityLogModal;
    window.renderActivityLogList = renderActivityLogList;
    window.setLogFilter = setLogFilter;
    window.onLogSearchChange = onLogSearchChange;
    window.exportActivityLogsCSV = exportActivityLogsCSV;
    window.clearAllActivityLogs = clearAllActivityLogs;
}

