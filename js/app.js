/**
 * GameVerse - Ana Uygulama Modülü
 * Masa oyunları platformu için temel JavaScript fonksiyonları
 * 
 * @version 1.0.0
 * @author GameVerse Team
 */

'use strict';

// Ana uygulama nesnesi
const GVApp = {
    version: '1.0.0',
    
    // Uygulama durumu
    state: {
        currentUser: null,
        currentGame: null,
        activeRooms: [],
        notifications: []
    },
    
    /**
     * Uygulamayı başlatır
     */
    init() {
        console.log('GameVerse v' + this.version + ' başlatılıyor...');
        this.setupEventListeners();
        this.loadUserPreferences();
        this.checkConnection();
    },
    
    /**
     * Event listener'ları kurar
     */
    setupEventListeners() {
        document.addEventListener('DOMContentLoaded', () => {
            this.initializeTheme();
            this.setupNavigation();
        });
        
        window.addEventListener('online', () => this.handleOnline());
        window.addEventListener('offline', () => this.handleOffline());
    },
    
    /**
     * Tema ayarlarını başlatır
     */
    initializeTheme() {
        const savedTheme = localStorage.getItem('gv-theme') || 'dark';
        document.documentElement.setAttribute('data-theme', savedTheme);
    },
    
    /**
     * Navigasyon ayarlarını yapar
     */
    setupNavigation() {
        const navButtons = document.querySelectorAll('.nav-btn');
        navButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const targetPage = e.target.dataset.page;
                if (targetPage) {
                    this.navigateTo(targetPage);
                }
            });
        });
    },
    
    /**
     * Sayfa navigasyonu
     */
    navigateTo(pageId) {
        const pages = document.querySelectorAll('.page');
        pages.forEach(page => page.classList.remove('active'));
        
        const targetPage = document.getElementById(pageId);
        if (targetPage) {
            targetPage.classList.add('active');
            history.pushState({ page: pageId }, '', `#${pageId}`);
        }
    },
    
    /**
     * Kullanıcı tercihlerini yükler
     */
    loadUserPreferences() {
        const prefs = localStorage.getItem('gv-preferences');
        if (prefs) {
            this.state.preferences = JSON.parse(prefs);
        }
    },
    
    /**
     * Bağlantı durumunu kontrol eder
     */
    checkConnection() {
        if (!navigator.onLine) {
            this.showToast('İnternet bağlantısı yok', 'warning');
        }
    },
    
    /**
     * Online durum handler'ı
     */
    handleOnline() {
        this.showToast('İnternet bağlantısı sağlandı', 'success');
        this.syncPendingActions();
    },
    
    /**
     * Offline durum handler'ı
     */
    handleOffline() {
        this.showToast('İnternet bağlantısı kesildi', 'error');
    },
    
    /**
     * Bekleyen aksiyonları senkronize eder
     */
    syncPendingActions() {
        const pending = localStorage.getItem('gv-pending-actions');
        if (pending) {
            // Bekleyen API çağrılarını yeniden dene
            console.log('Bekleyen aksiyonlar senkronize ediliyor...');
        }
    },
    
    /**
     * Toast bildirimi gösterir
     */
    showToast(message, type = 'info') {
        const toastWrap = document.getElementById('toastWrap');
        if (!toastWrap) return;
        
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        
        toastWrap.appendChild(toast);
        
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    },
    
    /**
     * Modal açar
     */
    showModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('show');
            document.body.style.overflow = 'hidden';
        }
    },
    
    /**
     * Modal kapatır
     */
    hideModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('show');
            document.body.style.overflow = '';
        }
    },
    
    /**
     * API çağrısı yapar
     */
    async apiCall(endpoint, data = {}, method = 'GET') {
        try {
            const options = {
                method,
                headers: {
                    'Content-Type': 'application/json'
                }
            };
            
            if (method !== 'GET' && data) {
                options.body = JSON.stringify(data);
            }
            
            const response = await fetch(`api.php?action=${endpoint}`, options);
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.message || 'İşlem başarısız');
            }
            
            return result;
        } catch (error) {
            console.error('API Hatası:', error);
            this.showToast(error.message, 'error');
            throw error;
        }
    },
    
    /**
     * LocalStorage'a veri kaydeder
     */
    saveToStorage(key, value) {
        try {
            localStorage.setItem(`gv-${key}`, JSON.stringify(value));
            return true;
        } catch (error) {
            console.error('Storage hatası:', error);
            return false;
        }
    },
    
    /**
     * LocalStorage'dan veri okur
     */
    loadFromStorage(key) {
        try {
            const data = localStorage.getItem(`gv-${key}`);
            return data ? JSON.parse(data) : null;
        } catch (error) {
            console.error('Storage okuma hatası:', error);
            return null;
        }
    }
};

// Uygulamayı otomatik başlat
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => GVApp.init());
} else {
    GVApp.init();
}

// Global erişim için export
window.GVApp = GVApp;
