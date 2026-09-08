/* GameVerse — Servis Çalışanı (Service Worker)
 * ============================================
 * NEDEN VAR: Android uygulaması (TWA / WebView) ve "Ana ekrana ekle"
 * kurulumu için tarayıcının bir servis çalışanı görmesi gerekir. Ayrıca
 * ağ bir an koptuğunda uygulama beyaz ekran yerine son bilinen kabuğu
 * gösterir.
 *
 * KURALLAR (oyun canlı bir soket uygulaması olduğu için katıdır):
 *  1) /api/*, /socket.io/* ve GET olmayan hiçbir istek ÖNBELLEĞE ALINMAZ,
 *     araya girilmez. Oyun trafiği her zaman doğrudan ağa gider.
 *  2) index.html "önce ağ" (network-first): dağıtımdan sonra kullanıcı
 *     eski sürümde takılı kalmaz; ağ yoksa önbellekteki kabuk açılır.
 *  3) js/css/ikon "önce önbellek, arkada tazele" (stale-while-revalidate):
 *     açılış hızlıdır, yeni sürüm sessizce indirilir. Dosya adlarında
 *     ?v=... damgası olduğu için tazeleme anında yansır.
 *  4) Sürüm değişince ESKİ önbellekler silinir.
 */
'use strict';

const SURUM = 'gv-v1-20260908a';
const KABUK = 'gv-kabuk-' + SURUM;
const VARLIK = 'gv-varlik-' + SURUM;

// Çevrimdışıyken de açılabilmesi için en baştan alınan asgari kabuk.
const ON_YUKLE = [
  '/',
  '/manifest.json',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(KABUK)
      .then(c => c.addAll(ON_YUKLE).catch(() => {}))   // biri düşerse kurulum yine de tamamlansın
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(adlar => Promise.all(adlar.filter(a => a !== KABUK && a !== VARLIK).map(a => caches.delete(a))))
      .then(() => self.clients.claim())
  );
});

// Sayfa "hemen güncelle" derse beklemeden devral.
self.addEventListener('message', e => {
  if (e.data === 'gv-skip-waiting') self.skipWaiting();
});

function atlanacakMi(url, req) {
  if (req.method !== 'GET') return true;
  if (url.origin !== self.location.origin) return true;          // CDN/harici: dokunma
  const p = url.pathname;
  return p.startsWith('/api/') ||
         p.startsWith('/socket.io/') ||
         p.endsWith('.php') ||
         p.startsWith('/.well-known/');
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (atlanacakMi(url, e.request)) return;                        // ağa dokunmadan geç

  const htmlMi = e.request.mode === 'navigate' ||
    (e.request.headers.get('accept') || '').includes('text/html');

  if (htmlMi) {
    // ÖNCE AĞ: yeni dağıtım anında görünsün.
    e.respondWith(
      fetch(e.request)
        .then(cev => {
          const kopya = cev.clone();
          caches.open(KABUK).then(c => c.put('/', kopya)).catch(() => {});
          return cev;
        })
        .catch(() => caches.match('/').then(c => c || caches.match(e.request)))
    );
    return;
  }

  // ÖNCE ÖNBELLEK + ARKADA TAZELE (js, css, ikon, font)
  e.respondWith(
    caches.match(e.request).then(onbellek => {
      const agdan = fetch(e.request).then(cev => {
        if (cev && cev.status === 200 && cev.type === 'basic') {
          const kopya = cev.clone();
          caches.open(VARLIK).then(c => c.put(e.request, kopya)).catch(() => {});
        }
        return cev;
      }).catch(() => onbellek);
      return onbellek || agdan;
    })
  );
});
