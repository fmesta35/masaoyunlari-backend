/**
 * GameVerse - Ana Uygulama Modülü
 */
'use strict';

const GVApp = {
    version: '1.0.2',
    state: { currentUser: null, currentGame: null, activeRooms: [], notifications: [] },

    init() {
        console.log('GameVerse v' + this.version + ' başlatılıyor...');
        this.setupEventListeners();
        this.loadUserPreferences();
        this.checkConnection();
        this.loadOnlineModules();
    },

    setupEventListeners() {
        document.addEventListener('DOMContentLoaded', () => {
            this.initializeTheme();
            this.setupNavigation();
        });
        window.addEventListener('online', () => this.handleOnline());
        window.addEventListener('offline', () => this.handleOffline());
    },

    initializeTheme() {
        const savedTheme = localStorage.getItem('gv-theme') || 'dark';
        document.documentElement.setAttribute('data-theme', savedTheme);
    },

    setupNavigation() {
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                const targetPage = e.currentTarget.dataset.page || e.currentTarget.dataset.p;
                if (targetPage) this.navigateTo(targetPage);
            });
        });
    },

    navigateTo(pageId) {
        document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
        const targetPage = document.getElementById('pg-' + pageId) || document.getElementById(pageId);
        if (targetPage) {
            targetPage.classList.add('active');
            history.pushState({ page: pageId }, '', `#${pageId}`);
        }
    },

    loadUserPreferences() {
        try {
            const prefs = localStorage.getItem('gv-preferences');
            if (prefs) this.state.preferences = JSON.parse(prefs);
        } catch (error) { console.warn('[GVApp] Tercihler okunamadı:', error); }
    },

    checkConnection() {
        if (!navigator.onLine) this.showToast('İnternet bağlantısı yok', 'warning');
    },
    handleOnline() { this.showToast('İnternet bağlantısı sağlandı', 'success'); this.syncPendingActions(); },
    handleOffline() { this.showToast('İnternet bağlantısı kesildi', 'error'); },
    syncPendingActions() { if (localStorage.getItem('gv-pending-actions')) console.log('Bekleyen aksiyonlar senkronize ediliyor...'); },

    showToast(message, type = 'info') {
        const toastWrap = document.getElementById('toastWrap');
        if (!toastWrap) return;
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        toastWrap.appendChild(toast);
        setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
    },

    showModal(modalId) { const modal = document.getElementById(modalId); if (modal) { modal.classList.add('show'); document.body.style.overflow = 'hidden'; } },
    hideModal(modalId) { const modal = document.getElementById(modalId); if (modal) { modal.classList.remove('show'); document.body.style.overflow = ''; } },

    async apiCall(endpoint, data = {}, method = 'GET') {
        try {
            const options = { method, headers: { 'Content-Type': 'application/json' } };
            if (method !== 'GET' && data) options.body = JSON.stringify(data);
            const response = await fetch(`api.php?action=${endpoint}`, options);
            const result = await response.json();
            if (!result.success) throw new Error(result.message || 'İşlem başarısız');
            return result;
        } catch (error) {
            console.error('API Hatası:', error);
            this.showToast(error.message, 'error');
            throw error;
        }
    },

    saveToStorage(key, value) {
        try { localStorage.setItem(`gv-${key}`, JSON.stringify(value)); return true; }
        catch (error) { console.error('Storage hatası:', error); return false; }
    },
    loadFromStorage(key) {
        try { const data = localStorage.getItem(`gv-${key}`); return data ? JSON.parse(data) : null; }
        catch (error) { console.error('Storage okuma hatası:', error); return null; }
    },

    loadOnlineModules() {
        const load = (src, attr) => {
            if (document.querySelector('script[' + attr + ']')) return Promise.resolve();
            return new Promise(resolve => {
                const script = document.createElement('script');
                script.src = src;
                script.async = false;
                script.setAttribute(attr, '1');
                script.onload = () => { console.log('[Online] yüklendi:', src); resolve(); };
                script.onerror = () => { console.error('[Online] yüklenemedi:', src); resolve(); };
                (document.head || document.documentElement).appendChild(script);
            });
        };

        load('js/room-waiting-fix.js?v=20260817-5', 'data-gv-room-fix')
            .then(() => load('js/online-compat.js?v=20260817-1', 'data-gv-online-compat'));
    }
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => GVApp.init(), { once: true });
else GVApp.init();
window.GVApp = GVApp;
