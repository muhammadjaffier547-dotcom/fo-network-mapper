/**
 * FO Network Mapper - Authentication & RBAC Module
 * Role-Based Access Control: SUPER_ADMIN vs USER (Read-Only) vs GUEST
 */

// State Auth (Gunakan sessionStorage agar setiap sesi baru selalu meminta login terlebih dahulu)
let currentAuthUser = null;
let currentAuthToken = sessionStorage.getItem('fo_auth_token') || null;

// Bersihkan residual cache login lama di localStorage jika ada
try {
    localStorage.removeItem('fo_auth_token');
    localStorage.removeItem('fo_auth_user');
} catch (e) {}

// Offline fallback users untuk mode standalone tanpa koneksi server
const OFFLINE_FALLBACK_USERS = [
    {
        id: 'usr_superadmin_01',
        username: 'jaffier',
        password: 'jaff0808',
        name: 'Jaffier (Super Admin)',
        role: 'SUPER_ADMIN',
        avatar: 'fa-user-shield'
    },
    {
        id: 'usr_admin_01',
        username: 'admin',
        password: 'admin123',
        name: 'Admin Jaringan',
        role: 'ADMIN',
        avatar: 'fa-user-gear'
    },
    {
        id: 'usr_teknisi_01',
        username: 'teknisi',
        password: 'teknisi123',
        name: 'Teknisi Lapangan',
        role: 'USER',
        avatar: 'fa-hard-hat'
    }
];

function getStoredLocalUsers() {
    try {
        const version = localStorage.getItem('fo_users_version');
        const saved = localStorage.getItem('fo_local_users');
        if (version === 'v2' && saved) {
            const list = JSON.parse(saved);
            if (Array.isArray(list) && list.some(u => u.username.toLowerCase() === 'jaffier')) {
                return list;
            }
        }
    } catch (e) {}
    localStorage.setItem('fo_users_version', 'v2');
    localStorage.setItem('fo_local_users', JSON.stringify(OFFLINE_FALLBACK_USERS));
    return OFFLINE_FALLBACK_USERS;
}

function saveStoredLocalUsers(users) {
    localStorage.setItem('fo_local_users', JSON.stringify(users));
}

/**
 * Inisialisasi Auth saat aplikasi pertama kali dimuat
 * Default adalah GUEST (Publik) sampai pengguna memasukkan username & password
 */
async function initAuth() {
    // Coba cek token aktif di sesi saat ini
    if (currentAuthToken) {
        try {
            const res = await fetch('/api/auth/me', {
                headers: {
                    'Authorization': `Bearer ${currentAuthToken}`,
                    'x-auth-token': currentAuthToken
                }
            });
            if (res.ok) {
                const data = await res.json();
                if (data.authenticated && data.user) {
                    currentAuthUser = data.user;
                    sessionStorage.setItem('fo_auth_user', JSON.stringify(currentAuthUser));
                    applyRoleUI();
                    return;
                }
            }
        } catch (err) {
            console.log('Koneksi server API offline, memeriksa sesi lokal...');
        }
    }

    // Ambil sesi user dari sessionStorage jika ada
    const savedUserStr = sessionStorage.getItem('fo_auth_user');
    if (savedUserStr && currentAuthToken) {
        try {
            currentAuthUser = JSON.parse(savedUserStr);
        } catch (e) {
            currentAuthUser = null;
        }
    }

    // WAJIB: Jika belum login, status default SELALU GUEST (Publik Read-Only)
    if (!currentAuthUser) {
        currentAuthUser = {
            id: 'usr_guest',
            username: 'guest',
            name: 'Pengunjung Publik',
            role: 'GUEST',
            avatar: 'fa-user'
        };
    }

    applyRoleUI();

    // Jika belum login, tampilkan modal login secara otomatis agar pengguna login terlebih dahulu
    if (isGuest()) {
        setTimeout(() => {
            openLoginModal();
        }, 400);
    }
}

function getCurrentUser() {
    try {
        const s = sessionStorage.getItem('fo_auth_user');
        if (s) {
            const parsed = JSON.parse(s);
            if (parsed && parsed.role) {
                currentAuthUser = parsed;
                if (typeof window !== 'undefined') window.currentAuthUser = currentAuthUser;
                return currentAuthUser;
            }
        }
    } catch (e) {}
    if (typeof window !== 'undefined' && window.currentAuthUser) {
        currentAuthUser = window.currentAuthUser;
        return currentAuthUser;
    }
    if (currentAuthUser) return currentAuthUser;
    return null;
}

/**
 * Cek apakah user memiliki hak akses menulis / edit data (SUPER ADMIN atau ADMIN)
 */
function hasWritePermission() {
    const user = getCurrentUser();
    return !!(user && (user.role === 'SUPER_ADMIN' || user.role === 'ADMIN' || user.role === 'admin'));
}

/**
 * Super Admin (jaffier) memiliki hak akses tertinggi, termasuk mereset database dan mengelola akun
 */
function isSuperAdmin() {
    const user = getCurrentUser();
    return !!(user && user.role === 'SUPER_ADMIN');
}

/**
 * Admin Biasa: Dapat mengedit peta/data/foto, TETAPI TIDAK MEMILIKI AKSES TOMBOL RESET
 */
function isAdmin() {
    const user = getCurrentUser();
    return !!(user && (user.role === 'ADMIN' || user.role === 'admin'));
}

function isUserRole() {
    const user = getCurrentUser();
    return !!(user && (user.role === 'USER' || user.role === 'user'));
}

function isGuest() {
    const user = getCurrentUser();
    return !user || user.role === 'GUEST';
}

if (typeof window !== 'undefined') {
    window.getCurrentUser = getCurrentUser;
    window.hasWritePermission = hasWritePermission;
    window.isSuperAdmin = isSuperAdmin;
    window.isAdmin = isAdmin;
    window.isUserRole = isUserRole;
    window.isGuest = isGuest;
}

/**
 * Buka modal login
 */
function openLoginModal() {
    const modal = document.getElementById('modal-auth-login');
    if (modal) {
        document.getElementById('login-username').value = '';
        document.getElementById('login-password').value = '';
        const errEl = document.getElementById('login-error-msg');
        if (errEl) errEl.classList.add('hidden');
        modal.classList.remove('hidden');
        setTimeout(() => {
            const uInput = document.getElementById('login-username');
            if (uInput) uInput.focus();
        }, 150);
    }
}

function closeLoginModal() {
    const modal = document.getElementById('modal-auth-login');
    if (modal) modal.classList.add('hidden');
}

/**
 * Eksekusi Login
 */
async function submitLogin() {
    const usernameInput = document.getElementById('login-username');
    const passwordInput = document.getElementById('login-password');
    const errEl = document.getElementById('login-error-msg');
    const btnSubmit = document.getElementById('btn-submit-login');

    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();

    if (!username || !password) {
        if (errEl) {
            errEl.innerText = 'Mohon masukkan username dan password.';
            errEl.classList.remove('hidden');
        }
        return;
    }

    if (btnSubmit) {
        btnSubmit.disabled = true;
        btnSubmit.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Masuk...';
    }

    // Coba login via server
    let loginSuccess = false;
    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (res.ok && data.success) {
            currentAuthToken = data.token;
            currentAuthUser = data.user;
            sessionStorage.setItem('fo_auth_token', currentAuthToken);
            sessionStorage.setItem('fo_auth_user', JSON.stringify(currentAuthUser));
            loginSuccess = true;
        } else if (res.status === 401) {
            if (errEl) {
                errEl.innerText = data.error || 'Username atau password salah.';
                errEl.classList.remove('hidden');
            }
            if (btnSubmit) {
                btnSubmit.disabled = false;
                btnSubmit.innerHTML = '<i class="fa-solid fa-right-to-bracket mr-1"></i> Masuk ke Sistem';
            }
            return;
        }
    } catch (err) {
        // Fallback login offline
        const localUsers = getStoredLocalUsers();
        const found = localUsers.find(u => u.username.toLowerCase() === username.toLowerCase() && u.password === password);
        if (found) {
            const role = found.role;
            const defAvatar = role === 'SUPER_ADMIN' ? 'fa-user-shield' : (role === 'ADMIN' ? 'fa-user-gear' : 'fa-hard-hat');
            currentAuthUser = {
                id: found.id,
                username: found.username,
                name: found.name,
                role: role,
                avatar: found.avatar || defAvatar
            };
            currentAuthToken = 'local_tok_' + Date.now();
            sessionStorage.setItem('fo_auth_token', currentAuthToken);
            sessionStorage.setItem('fo_auth_user', JSON.stringify(currentAuthUser));
            loginSuccess = true;
        }
    }

    if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = '<i class="fa-solid fa-right-to-bracket mr-1"></i> Masuk ke Sistem';
    }

    if (loginSuccess) {
        closeLoginModal();
        applyRoleUI();
        if (typeof showToast === 'function') {
            const roleLabel = currentAuthUser.role === 'SUPER_ADMIN' ? 'Super Admin' : (currentAuthUser.role === 'ADMIN' ? 'Admin Biasa' : 'User Read-Only');
            showToast(`👋 Berhasil masuk! Selamat datang, ${currentAuthUser.name} (${roleLabel}).`);
        }
    } else {
        if (errEl) {
            errEl.innerText = 'Username atau password tidak sesuai. Silakan periksa kembali.';
            errEl.classList.remove('hidden');
        }
    }
}

/**
 * Eksekusi Logout
 */
async function executeLogout() {
    if (confirm('Yakin ingin keluar dari akun ini?')) {
        try {
            if (currentAuthToken) {
                await fetch('/api/auth/logout', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${currentAuthToken}` }
                });
            }
        } catch (e) {}

        currentAuthToken = null;
        currentAuthUser = {
            id: 'usr_guest',
            username: 'guest',
            name: 'Pengunjung Publik',
            role: 'GUEST',
            avatar: 'fa-user'
        };
        sessionStorage.removeItem('fo_auth_token');
        sessionStorage.removeItem('fo_auth_user');
        try {
            localStorage.removeItem('fo_auth_token');
            localStorage.removeItem('fo_auth_user');
        } catch (e) {}

        applyRoleUI();
        if (typeof showToast === 'function') {
            showToast('Anda telah keluar. Sekarang dalam mode Publik (Read-Only).');
        }
        setTimeout(() => {
            openLoginModal();
        }, 300);
    }
}

/**
 * Terapkan hak akses dan perapian UI berdasarkan Role
 */
function applyRoleUI() {
    if (typeof window !== 'undefined') {
        window.currentAuthUser = currentAuthUser;
        window.currentAuthToken = currentAuthToken;
    }
    const role = currentAuthUser ? currentAuthUser.role : 'GUEST';
    const isSuper = role === 'SUPER_ADMIN';
    const isAdminRole = role === 'ADMIN' || role === 'admin';
    const isUser = role === 'USER' || role === 'user';
    const canWrite = isSuper || isAdminRole;

    // 1. Update Header User Profile Strip
    const profileContainer = document.getElementById('user-header-profile');
    if (profileContainer) {
        if (isSuper) {
            profileContainer.innerHTML = `
                <div class="flex items-center gap-2">
                    <div class="text-right leading-tight hidden sm:block">
                        <div class="text-xs font-bold text-white flex items-center justify-end gap-1">
                            <span>${escapeHtml(currentAuthUser.name || currentAuthUser.username)}</span>
                        </div>
                        <span class="text-[10px] text-amber-400 font-semibold bg-amber-500/10 px-1.5 py-0.2 rounded border border-amber-500/30">
                            <i class="fa-solid fa-crown text-[9px] mr-0.5"></i> SUPER ADMIN
                        </span>
                    </div>
                    <div class="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 text-sm shadow">
                        <i class="fa-solid ${currentAuthUser.avatar || 'fa-user-shield'}"></i>
                    </div>
                    <button onclick="openUserManagementModal()" title="Kelola Akun & Hak Akses Pengguna (Super Admin Only)" class="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-400 border border-slate-700 text-xs shadow transition">
                        <i class="fa-solid fa-users-gear"></i>
                    </button>
                    <button onclick="executeLogout()" title="Logout" class="p-1.5 rounded-lg bg-slate-800 hover:bg-red-950/60 text-slate-400 hover:text-red-400 border border-slate-700 text-xs shadow transition">
                        <i class="fa-solid fa-arrow-right-from-bracket"></i>
                    </button>
                </div>
            `;
        } else if (isAdminRole) {
            profileContainer.innerHTML = `
                <div class="flex items-center gap-2">
                    <div class="text-right leading-tight hidden sm:block">
                        <div class="text-xs font-bold text-white flex items-center justify-end gap-1">
                            <span>${escapeHtml(currentAuthUser.name || currentAuthUser.username)}</span>
                        </div>
                        <span class="text-[10px] text-emerald-400 font-semibold bg-emerald-500/10 px-1.5 py-0.2 rounded border border-emerald-500/30">
                            <i class="fa-solid fa-user-gear text-[9px] mr-0.5"></i> ADMIN (EDITOR)
                        </span>
                    </div>
                    <div class="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 text-sm shadow">
                        <i class="fa-solid ${currentAuthUser.avatar || 'fa-user-gear'}"></i>
                    </div>
                    <button onclick="executeLogout()" title="Logout" class="p-1.5 rounded-lg bg-slate-800 hover:bg-red-950/60 text-slate-400 hover:text-red-400 border border-slate-700 text-xs shadow transition">
                        <i class="fa-solid fa-arrow-right-from-bracket"></i>
                    </button>
                </div>
            `;
        } else if (isUser) {
            profileContainer.innerHTML = `
                <div class="flex items-center gap-2">
                    <div class="text-right leading-tight hidden sm:block">
                        <div class="text-xs font-bold text-white">${escapeHtml(currentAuthUser.name || currentAuthUser.username)}</div>
                        <span class="text-[10px] text-blue-400 font-semibold bg-blue-500/10 px-1.5 py-0.2 rounded border border-blue-500/30">
                            <i class="fa-solid fa-eye text-[9px] mr-0.5"></i> USER (READ-ONLY)
                        </span>
                    </div>
                    <div class="w-8 h-8 rounded-lg bg-blue-500/20 border border-blue-500/40 flex items-center justify-center text-blue-400 text-sm shadow">
                        <i class="fa-solid ${currentAuthUser.avatar || 'fa-hard-hat'}"></i>
                    </div>
                    <button onclick="executeLogout()" title="Logout" class="p-1.5 rounded-lg bg-slate-800 hover:bg-red-950/60 text-slate-400 hover:text-red-400 border border-slate-700 text-xs shadow transition">
                        <i class="fa-solid fa-arrow-right-from-bracket"></i>
                    </button>
                </div>
            `;
        } else {
            profileContainer.innerHTML = `
                <button onclick="openLoginModal()" class="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold shadow flex items-center gap-1.5 transition">
                    <i class="fa-solid fa-right-to-bracket"></i> Masuk / Login
                </button>
            `;
        }
    }

    // 2. Floating Map Auth Pill di Pojok Kanan Atas Peta
    const mapAuthPill = document.getElementById('map-auth-pill');
    if (mapAuthPill) {
        if (isSuper) {
            mapAuthPill.innerHTML = `
                <div class="px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-900/90 text-amber-300 border border-amber-500/40 shadow-lg backdrop-blur flex items-center gap-1.5">
                    <i class="fa-solid fa-shield-halved text-amber-400"></i>
                    <span>Super Admin</span>
                </div>
            `;
        } else if (isAdminRole) {
            mapAuthPill.innerHTML = `
                <div class="px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-900/90 text-emerald-300 border border-emerald-500/40 shadow-lg backdrop-blur flex items-center gap-1.5">
                    <i class="fa-solid fa-user-gear text-emerald-400"></i>
                    <span>Admin Biasa</span>
                </div>
            `;
        } else if (isUser) {
            mapAuthPill.innerHTML = `
                <div class="px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-900/90 text-blue-300 border border-blue-500/40 shadow-lg backdrop-blur flex items-center gap-1.5">
                    <i class="fa-solid fa-eye text-blue-400"></i>
                    <span>Read-Only</span>
                </div>
            `;
        } else {
            mapAuthPill.innerHTML = `
                <button onclick="openLoginModal()" class="px-3 py-1.5 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-lg flex items-center gap-1.5 transition">
                    <i class="fa-solid fa-key"></i> Login
                </button>
            `;
        }
    }

    // 3. Mode Selector Buttons & Kontrol Editing
    const modeBtnContainer = document.getElementById('mode-selector-grid');
    const readOnlyNotice = document.getElementById('mode-readonly-notice');
    const resetBtn = document.getElementById('btn-reset-database');
    const tabBtnInput = document.getElementById('tab-btn-input');

    // TOMBOL RESET DATABASE: HANYA SUPER ADMIN YANG BISA MELIHAT & MEMAKAI
    if (resetBtn) {
        if (isSuper) {
            resetBtn.classList.remove('hidden');
        } else {
            resetBtn.classList.add('hidden');
        }
    }

    // Mode Interaksi Peta & Input Titik (SUPER ADMIN & ADMIN BIASA)
    if (canWrite) {
        if (modeBtnContainer) modeBtnContainer.classList.remove('hidden');
        if (readOnlyNotice) readOnlyNotice.classList.add('hidden');
        if (tabBtnInput) tabBtnInput.classList.remove('hidden');
    } else {
        // Mode Read-Only untuk USER dan GUEST
        if (typeof setMode === 'function') setMode('pan');
        if (modeBtnContainer) modeBtnContainer.classList.add('hidden');
        if (readOnlyNotice) readOnlyNotice.classList.remove('hidden');
        if (tabBtnInput) tabBtnInput.classList.add('hidden');
        if (typeof switchTab === 'function') switchTab('tab-list');
    }

    // 4. Perbarui rendering data list dan marker peta agar menyesuaikan role
    if (typeof updateUI === 'function') updateUI();
    if (typeof refreshAllMarkersForRole === 'function') refreshAllMarkersForRole();
}

/**
 * Refresh semua marker titik dan garis jalur FO di peta berdasarkan hak akses role
 */
function refreshAllMarkersForRole() {
    const canWrite = typeof hasWritePermission === 'function' ? hasWritePermission() : false;
    const nList = (typeof nodes !== 'undefined' && Array.isArray(nodes)) ? nodes : (window.nodes || []);
    const cList = (typeof cables !== 'undefined' && Array.isArray(cables)) ? cables : (window.cables || []);

    const marks = window.nodeMarkers || (typeof nodeMarkers !== 'undefined' ? nodeMarkers : {});
    Object.values(marks).forEach(m => {
        if (m && m.dragging) {
            if (canWrite) m.dragging.enable();
            else m.dragging.disable();
        }
    });

    nList.forEach(n => {
        if (typeof renderNodeMarker === 'function') renderNodeMarker(n);
        else if (typeof window.renderNodeMarker === 'function') window.renderNodeMarker(n);
    });
    cList.forEach(c => {
        if (typeof renderCablePolyline === 'function') renderCablePolyline(c);
        else if (typeof window.renderCablePolyline === 'function') window.renderCablePolyline(c);
    });

    // Jika ada popup yang sedang terbuka di peta, perbarui kontennya langsung
    if (typeof map !== 'undefined' && map && map._popup && map._popup.isOpen()) {
        const sourceLayer = map._popup._source;
        if (sourceLayer) {
            const cPolys = window.cablePolylines || (typeof cablePolylines !== 'undefined' ? cablePolylines : {});
            const cEntry = Object.entries(cPolys).find(([id, poly]) => poly === sourceLayer);
            if (cEntry) {
                const cObj = cList.find(c => c.id === cEntry[0]);
                if (cObj && typeof getCablePopupHtml === 'function') {
                    map._popup.setContent(getCablePopupHtml(cObj));
                } else if (cObj && typeof window.getCablePopupHtml === 'function') {
                    map._popup.setContent(window.getCablePopupHtml(cObj));
                }
            }
            const nEntry = Object.entries(marks).find(([id, marker]) => marker === sourceLayer);
            if (nEntry) {
                const nObj = nList.find(n => n.id === nEntry[0]);
                if (nObj && typeof getNodePopupHtml === 'function') {
                    map._popup.setContent(getNodePopupHtml(nObj));
                } else if (nObj && typeof window.getNodePopupHtml === 'function') {
                    map._popup.setContent(window.getNodePopupHtml(nObj));
                }
            }
        }
    }
}

// --- MODAL MANAJEMEN AKUN (SUPER ADMIN ONLY) ---

async function openUserManagementModal() {
    if (!isSuperAdmin()) {
        alert('Akses Ditolak: Hanya SUPER ADMIN yang dapat membuka menu ini.');
        return;
    }
    const modal = document.getElementById('modal-user-management');
    if (!modal) return;

    modal.classList.remove('hidden');
    await loadUsersList();
}

function closeUserManagementModal() {
    const modal = document.getElementById('modal-user-management');
    if (modal) modal.classList.add('hidden');
}

async function loadUsersList() {
    const listContainer = document.getElementById('user-mgmt-list');
    if (!listContainer) return;
    listContainer.innerHTML = `<div class="p-4 text-center text-slate-400 text-xs"><i class="fa-solid fa-circle-notch fa-spin mr-1"></i> Memuat daftar akun...</div>`;

    let users = [];
    try {
        const res = await fetch('/api/users', {
            headers: {
                'Authorization': `Bearer ${currentAuthToken}`,
                'x-auth-token': currentAuthToken
            }
        });
        if (res.ok) {
            const data = await res.json();
            users = data.users || [];
        } else {
            users = getStoredLocalUsers();
        }
    } catch (e) {
        users = getStoredLocalUsers();
    }

    if (users.length === 0) {
        listContainer.innerHTML = `<p class="text-slate-400 text-xs italic">Belum ada data pengguna.</p>`;
        return;
    }

    listContainer.innerHTML = users.map(u => {
        const isSelf = currentAuthUser && currentAuthUser.id === u.id;
        const isSuper = u.role === 'SUPER_ADMIN';
        const isAdminU = u.role === 'ADMIN' || u.role === 'admin';
        let roleBadge = '';
        let avatarBg = 'bg-blue-600';
        let userAvatar = u.avatar;

        if (isSuper) {
            roleBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1"><i class="fa-solid fa-crown text-[9px]"></i> SUPER ADMIN</span>`;
            avatarBg = 'bg-amber-600';
            if (!userAvatar) userAvatar = 'fa-user-shield';
        } else if (isAdminU) {
            roleBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1"><i class="fa-solid fa-user-gear text-[9px]"></i> ADMIN BIASA</span>`;
            avatarBg = 'bg-emerald-600';
            if (!userAvatar) userAvatar = 'fa-user-gear';
        } else {
            roleBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30 flex items-center gap-1"><i class="fa-solid fa-user text-[9px]"></i> USER</span>`;
            avatarBg = 'bg-blue-600';
            if (!userAvatar) userAvatar = 'fa-hard-hat';
        }

        return `
            <div class="bg-slate-900 p-2.5 rounded-xl border border-slate-700/80 flex items-center justify-between gap-2">
                <div class="flex items-center gap-2.5 overflow-hidden">
                    <div class="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs flex-shrink-0 shadow ${avatarBg}">
                        <i class="fa-solid ${userAvatar}"></i>
                    </div>
                    <div class="truncate">
                        <div class="font-bold text-white text-xs truncate flex items-center gap-1.5">
                            <span>${escapeHtml(u.name || u.username)}</span>
                            ${isSelf ? '<span class="text-[9px] bg-slate-800 text-slate-300 px-1 rounded">(Anda)</span>' : ''}
                        </div>
                        <div class="text-[11px] text-slate-400 flex items-center gap-1">
                            <span>@${escapeHtml(u.username)}</span>
                        </div>
                    </div>
                </div>

                <div class="flex items-center gap-2 flex-shrink-0">
                    <div>${roleBadge}</div>
                    ${!isSelf ? `
                        <div class="flex items-center gap-1 border-l border-slate-700 pl-2">
                            <button onclick="toggleUserRole('${u.id}', '${u.role}')" title="Ubah Role (User -> Admin -> Super Admin)" class="p-1 rounded bg-slate-800 hover:bg-slate-700 text-amber-400 text-xs">
                                <i class="fa-solid fa-arrows-rotate"></i>
                            </button>
                            <button onclick="deleteUserAccount('${u.id}', '${escapeHtml(u.username)}')" title="Hapus Akun" class="p-1 rounded bg-slate-800 hover:bg-red-900/60 text-red-400 text-xs">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Buat akun baru via Super Admin
 */
async function handleCreateUser(event) {
    event.preventDefault();
    if (!isSuperAdmin()) return;

    const name = document.getElementById('new-user-name').value.trim();
    const username = document.getElementById('new-user-username').value.trim();
    const password = document.getElementById('new-user-password').value.trim();
    const role = document.getElementById('new-user-role').value;
    const msgEl = document.getElementById('new-user-msg');

    if (!username || !password) {
        if (msgEl) {
            msgEl.className = 'text-red-400 text-xs';
            msgEl.innerText = 'Username dan password wajib diisi.';
        }
        return;
    }

    try {
        const res = await fetch('/api/users', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentAuthToken}`,
                'x-auth-token': currentAuthToken
            },
            body: JSON.stringify({ username, password, name, role })
        });
        const data = await res.json();
        if (res.ok && data.success) {
            document.getElementById('form-create-user').reset();
            if (msgEl) {
                msgEl.className = 'text-emerald-400 text-xs';
                msgEl.innerText = `✅ Akun @${username} (${role}) berhasil dibuat!`;
            }
            loadUsersList();
            return;
        } else {
            if (msgEl) {
                msgEl.className = 'text-red-400 text-xs';
                msgEl.innerText = data.error || 'Gagal membuat akun.';
            }
        }
    } catch (e) {
        // Fallback local
        const localUsers = getStoredLocalUsers();
        if (localUsers.some(u => u.username.toLowerCase() === username.toLowerCase())) {
            if (msgEl) {
                msgEl.className = 'text-red-400 text-xs';
                msgEl.innerText = 'Username sudah terpakai.';
            }
            return;
        }
        const newUser = {
            id: 'usr_' + Date.now(),
            username,
            password,
            name: name || username,
            role,
            avatar: role === 'SUPER_ADMIN' ? 'fa-user-shield' : (role === 'ADMIN' ? 'fa-user-gear' : 'fa-hard-hat'),
            createdAt: new Date().toISOString()
        };
        localUsers.push(newUser);
        saveStoredLocalUsers(localUsers);
        document.getElementById('form-create-user').reset();
        if (msgEl) {
            msgEl.className = 'text-emerald-400 text-xs';
            msgEl.innerText = `✅ Akun @${username} berhasil dibuat!`;
        }
        loadUsersList();
    }
}

/**
 * Ubah role user (USER -> ADMIN -> SUPER_ADMIN -> USER)
 */
async function toggleUserRole(userId, currentRole) {
    if (!isSuperAdmin()) return;
    let newRole = 'USER';
    if (currentRole === 'USER' || currentRole === 'user') newRole = 'ADMIN';
    else if (currentRole === 'ADMIN' || currentRole === 'admin') newRole = 'SUPER_ADMIN';
    else if (currentRole === 'SUPER_ADMIN') newRole = 'USER';

    if (!confirm(`Ubah role pengguna ini menjadi "${newRole}"?`)) return;

    try {
        const res = await fetch('/api/users/update', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentAuthToken}`,
                'x-auth-token': currentAuthToken
            },
            body: JSON.stringify({ id: userId, role: newRole })
        });
        const data = await res.json();
        if (res.ok) {
            showToast(`Role berhasil diubah menjadi ${newRole}`);
            loadUsersList();
            return;
        } else {
            alert(data.error || 'Gagal mengubah role.');
        }
    } catch (e) {
        const localUsers = getStoredLocalUsers();
        const u = localUsers.find(x => x.id === userId);
        if (u) {
            u.role = newRole;
            u.avatar = newRole === 'SUPER_ADMIN' ? 'fa-user-shield' : (newRole === 'ADMIN' ? 'fa-user-gear' : 'fa-hard-hat');
            saveStoredLocalUsers(localUsers);
            showToast(`Role berhasil diubah menjadi ${newRole}`);
            loadUsersList();
        }
    }
}

/**
 * Hapus akun pengguna
 */
async function deleteUserAccount(userId, username) {
    if (!isSuperAdmin()) return;
    if (!confirm(`Yakin ingin menghapus akun @${username}?`)) return;

    try {
        const res = await fetch('/api/users/delete', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentAuthToken}`,
                'x-auth-token': currentAuthToken
            },
            body: JSON.stringify({ id: userId })
        });
        const data = await res.json();
        if (res.ok) {
            showToast(`Akun @${username} berhasil dihapus.`);
            loadUsersList();
            return;
        } else {
            alert(data.error || 'Gagal menghapus akun.');
        }
    } catch (e) {
        let localUsers = getStoredLocalUsers();
        localUsers = localUsers.filter(x => x.id !== userId);
        saveStoredLocalUsers(localUsers);
        showToast(`Akun @${username} berhasil dihapus.`);
        loadUsersList();
    }
}
