/**
 * GameVerse - Yardımcı Fonksiyonlar Modülü
 * Ortak kullanım için yardımcı fonksiyonlar ve utility'ler
 * 
 * @version 1.0.0
 * @author GameVerse Team
 */

'use strict';

const GVUtils = {
    version: '1.0.0',
    
    /**
     * Format para birimi
     */
    formatCurrency(amount, currency = 'TRY') {
        return new Intl.NumberFormat('tr-TR', {
            style: 'currency',
            currency: currency
        }).format(amount);
    },
    
    /**
     * Format sayı
     */
    formatNumber(num) {
        return new Intl.NumberFormat('tr-TR').format(num);
    },
    
    /**
     * Format tarih
     */
    formatDate(date, options = {}) {
        const defaultOptions = {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        };
        return new Date(date).toLocaleDateString('tr-TR', { ...defaultOptions, ...options });
    },
    
    /**
     * Geçmiş zaman formatı (örn: "5 dakika önce")
     */
    timeAgo(date) {
        const seconds = Math.floor((new Date() - new Date(date)) / 1000);
        
        const intervals = {
            yıl: 31536000,
            ay: 2592000,
            hafta: 604800,
            gün: 86400,
            saat: 3600,
            dakika: 60
        };
        
        for (const [unit, secondsInUnit] of Object.entries(intervals)) {
            const interval = Math.floor(seconds / secondsInUnit);
            if (interval >= 1) {
                return `${interval} ${unit} önce`;
            }
        }
        
        return 'az önce';
    },
    
    /**
     * String kısaltma
     */
    truncate(str, length = 50, suffix = '...') {
        if (!str) return '';
        if (str.length <= length) return str;
        return str.substring(0, length) + suffix;
    },
    
    /**
     * Email doğrulama
     */
    isValidEmail(email) {
        const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return re.test(email);
    },
    
    /**
     * Username doğrulama (sadece harf, rakam, alt çizgi)
     */
    isValidUsername(username) {
        const re = /^[a-zA-Z0-9_]{3,20}$/;
        return re.test(username);
    },
    
    /**
     * Şifre gücü kontrolü
     */
    checkPasswordStrength(password) {
        let score = 0;
        
        if (password.length >= 8) score++;
        if (password.length >= 12) score++;
        if (/[a-z]/.test(password)) score++;
        if (/[A-Z]/.test(password)) score++;
        if (/[0-9]/.test(password)) score++;
        if (/[^a-zA-Z0-9]/.test(password)) score++;
        
        if (score <= 2) return 'weak';
        if (score <= 4) return 'medium';
        return 'strong';
    },
    
    /**
     * Random string oluştur
     */
    randomString(length = 10) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    },
    
    /**
     * Random ID oluştur
     */
    generateId() {
        return 'gv_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    },
    
    /**
     * Debounce fonksiyonu
     */
    debounce(func, wait = 300) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },
    
    /**
     * Throttle fonksiyonu
     */
    throttle(func, limit = 300) {
        let inThrottle;
        return function(...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    },
    
    /**
     * LocalStorage helper
     */
    storage: {
        get(key, defaultValue = null) {
            try {
                const item = localStorage.getItem(key);
                return item ? JSON.parse(item) : defaultValue;
            } catch (e) {
                console.error('Storage okuma hatası:', e);
                return defaultValue;
            }
        },
        
        set(key, value) {
            try {
                localStorage.setItem(key, JSON.stringify(value));
                return true;
            } catch (e) {
                console.error('Storage yazma hatası:', e);
                return false;
            }
        },
        
        remove(key) {
            try {
                localStorage.removeItem(key);
                return true;
            } catch (e) {
                console.error('Storage silme hatası:', e);
                return false;
            }
        },
        
        clear(prefix = '') {
            try {
                if (prefix) {
                    Object.keys(localStorage).forEach(key => {
                        if (key.startsWith(prefix)) {
                            localStorage.removeItem(key);
                        }
                    });
                } else {
                    localStorage.clear();
                }
                return true;
            } catch (e) {
                console.error('Storage temizleme hatası:', e);
                return false;
            }
        }
    },
    
    /**
     * SessionStorage helper
     */
    session: {
        get(key, defaultValue = null) {
            try {
                const item = sessionStorage.getItem(key);
                return item ? JSON.parse(item) : defaultValue;
            } catch (e) {
                console.error('Session okuma hatası:', e);
                return defaultValue;
            }
        },
        
        set(key, value) {
            try {
                sessionStorage.setItem(key, JSON.stringify(value));
                return true;
            } catch (e) {
                console.error('Session yazma hatası:', e);
                return false;
            }
        },
        
        remove(key) {
            try {
                sessionStorage.removeItem(key);
                return true;
            } catch (e) {
                console.error('Session silme hatası:', e);
                return false;
            }
        }
    },
    
    /**
     * Cookie helper
     */
    cookie: {
        set(name, value, days = 7) {
            const expires = new Date(Date.now() + days * 864e5).toUTCString();
            document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
        },
        
        get(name) {
            const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
            return match ? decodeURIComponent(match[2]) : null;
        },
        
        remove(name) {
            document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
        }
    },
    
    /**
     * URL parametrelerini parse et
     */
    getUrlParams() {
        const params = new URLSearchParams(window.location.search);
        return Object.fromEntries(params.entries());
    },
    
    /**
     * URL'e parametre ekle
     */
    addUrlParam(key, value) {
        const url = new URL(window.location);
        url.searchParams.set(key, value);
        window.history.pushState({}, '', url);
    },
    
    /**
     * URL'den parametre sil
     */
    removeUrlParam(key) {
        const url = new URL(window.location);
        url.searchParams.delete(key);
        window.history.pushState({}, '', url);
    },
    
    /**
     * Clipboard'a kopyala
     */
    async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (e) {
            console.error('Kopyalama hatası:', e);
            // Fallback
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.position = 'fixed';
            textArea.style.left = '-999999px';
            document.body.appendChild(textArea);
            textArea.select();
            try {
                document.execCommand('copy');
                document.body.removeChild(textArea);
                return true;
            } catch (e2) {
                document.body.removeChild(textArea);
                return false;
            }
        }
    },
    
    /**
     * Share API ile paylaş
     */
    async share(data) {
        if (navigator.share) {
            try {
                await navigator.share(data);
                return true;
            } catch (e) {
                console.error('Paylaşım hatası:', e);
                return false;
            }
        } else {
            // Fallback: link'i kopyala
            if (data.url) {
                return this.copyToClipboard(data.url);
            }
            return false;
        }
    },
    
    /**
     * Download dosya
     */
    downloadFile(filename, content, type = 'text/plain') {
        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },
    
    /**
     * Image olarak canvas'dan indir
     */
    downloadCanvas(canvas, filename = 'image.png') {
        const link = document.createElement('a');
        link.download = filename;
        link.href = canvas.toDataURL('image/png');
        link.click();
    },
    
    /**
     * Fullscreen moduna geç
     */
    async toggleFullscreen(element = document.documentElement) {
        try {
            if (!document.fullscreenElement) {
                await element.requestFullscreen();
            } else {
                await document.exitFullscreen();
            }
        } catch (e) {
            console.error('Fullscreen hatası:', e);
        }
    },
    
    /**
     * Vibration (mobil cihazlarda)
     */
    vibrate(pattern = 100) {
        if (navigator.vibrate) {
            navigator.vibrate(pattern);
        }
    },
    
    /**
     * Geolocation
     */
    async getLocation() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error('Tarayıcı konum servisini desteklemiyor'));
                return;
            }
            
            navigator.geolocation.getCurrentPosition(
                position => resolve({
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                    accuracy: position.coords.accuracy
                }),
                error => reject(error),
                { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
            );
        });
    },
    
    /**
     * Network durumu
     */
    getNetworkInfo() {
        return {
            online: navigator.onLine,
            connection: navigator.connection ? {
                effectiveType: navigator.connection.effectiveType,
                downlink: navigator.connection.downlink,
                rtt: navigator.connection.rtt,
                saveData: navigator.connection.saveData
            } : null
        };
    },
    
    /**
     * Battery API
     */
    async getBatteryInfo() {
        if ('getBattery' in navigator) {
            const battery = await navigator.getBattery();
            return {
                level: battery.level,
                charging: battery.charging,
                chargingTime: battery.chargingTime,
                dischargingTime: battery.dischargingTime
            };
        }
        return null;
    },
    
    /**
     * Page Visibility API
     */
    isPageVisible() {
        return !document.hidden;
    },
    
    /**
     * On visibility change
     */
    onVisibilityChange(callback) {
        document.addEventListener('visibilitychange', callback);
    },
    
    /**
     * Detect mobile device
     */
    isMobile() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    },
    
    /**
     * Detect iOS
     */
    isIOS() {
        return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    },
    
    /**
     * Detect Android
     */
    isAndroid() {
        return /Android/.test(navigator.userAgent);
    },
    
    /**
     * Browser detection
     */
    getBrowser() {
        const ua = navigator.userAgent;
        if (ua.indexOf('Chrome') > -1) return 'chrome';
        if (ua.indexOf('Safari') > -1) return 'safari';
        if (ua.indexOf('Firefox') > -1) return 'firefox';
        if (ua.indexOf('MSIE') > -1 || ua.indexOf('Trident/') > -1) return 'ie';
        if (ua.indexOf('Edge') > -1) return 'edge';
        return 'unknown';
    },
    
    /**
     * Get browser version
     */
    getBrowserVersion() {
        const ua = navigator.userAgent;
        const match = /(chrome|safari|firefox|msie|trident|edge)\/?\s*(\d+)/i.exec(ua);
        if (match) {
            return parseInt(match[2]);
        }
        return 0;
    }
};

// Global erişim için export
window.GVUtils = GVUtils;
