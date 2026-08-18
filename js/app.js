'use strict';

const GVApp = {
  version: '1.0.0',
  state: {
    currentUser: null,
    currentGame: null,
    activeRooms: [],
    notifications: []
  },

  init() {
    console.log('GameVerse v' + this.version + ' başlatılıyor...');
    this.setupEventListeners();
    this.loadUserPreferences();
    this.checkConnection();
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
    document.documentElement.setAttribute('data-theme', localStorage.getItem('gv-theme') || 'dark');
  },

  setupNavigation() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        const targetPage = e.currentTarget.dataset.page;
        if (targetPage) this.navigateTo(targetPage);
      });
    });
  },

  navigateTo(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const target = document.getElementById(pageId);
    if (target) {
      target.classList.add('active');
      try {
        history.pushState({ page: pageId }, '', '#' + pageId);
      } catch (_) {}
    }
  },

  loadUserPreferences() {
    try {
      const p = localStorage.getItem('gv-preferences');
      if (p) this.state.preferences = JSON.parse(p);
    } catch (_) {}
  },

  checkConnection() {
    if (!navigator.onLine) this.showToast('İnternet bağlantısı yok', 'warning');
  },

  handleOnline() {
    this.showToast('İnternet bağlantısı sağlandı', 'success');
  },

  handleOffline() {
    this.showToast('İnternet bağlantısı kesildi', 'error');
  },

  showToast(message, type = 'info') {
    const w = document.getElementById('toastWrap');
    if (!w) return;
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.textContent = message;
    w.appendChild(t);
    setTimeout(() => {
      t.style.opacity = '0';
      setTimeout(() => t.remove(), 300);
    }, 3000);
  },

  showModal(id) {
    const m = document.getElementById(id);
    if (m) {
      m.classList.add('show');
      document.body.style.overflow = 'hidden';
    }
  },

  hideModal(id) {
    const m = document.getElementById(id);
    if (m) {
      m.classList.remove('show');
      document.body.style.overflow = '';
    }
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => GVApp.init());
} else {
  GVApp.init();
}

window.GVApp = GVApp;
