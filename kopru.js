'use strict';
/* ============================================================================
 * İMZALI KÖPRÜ (röle) — Render → tarayıcı → Yöncü PHP
 * ============================================================================
 * Kullanıcı raporu: "fazil1905gs'in birçok maç geçmişi olmuş ama toplam puan
 * 0, toplam maç 0, kazanma %0; liderlik ve istatistiklerde veri yok."
 *
 * KÖK NEDEN (canlı ölçüm, /api/_php_ping): Yöncü'nün DDoS koruması Render'ın
 * sunucu-sunucu isteklerine "Yoncu DDoS Protection" sayfası (HTTP 303)
 * döndürüyor. Puan (scoreWrite), maç (recordMatch) ve turnuva yazımları
 * "ateş-unut" çağrılar olduğu için hata sessizce yutuluyor, MySQL'e HİÇBİR
 * ŞEY yazılmıyordu.
 *
 * ÇÖZÜM: Her yazım bir KAYIT olur ve GV_SERVER_KEY ile imzalanır:
 *     sig = HMAC-SHA256('relay|id|a|ts|b')      (b = gövdenin JSON metni)
 *   1) Render önce DOĞRUDAN iletmeyi dener (DDoS beyaz listeye alınırsa
 *      kendiliğinden bu yol çalışır).
 *   2) Olmazsa kayıt kuyrukta bekler ve siteyi açık tutan tarayıcılara
 *      (canlı sayaç nabzının yanıtında) dağıtılır. Tarayıcı korumayı
 *      sorunsuz geçer, kaydı social.php?action=relay'e iletir.
 *   3) PHP imzayı doğrular, kimliği bir kez işler (aynı kaydı iki tarayıcı
 *      iletse de çift yazılmaz) ve imzalı bir "fiş" döner. Render kaydı
 *      ancak bu fişi görünce kuyruktan düşer — sahte "ilettim" işe yaramaz.
 * İmzayı yalnız anahtarı bilen Render üretebildiği için tarayıcı kaydı
 * değiştiremez ya da uyduramaz (puan şişirme mümkün değil).
 * ========================================================================= */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const IZINLI = new Set(['scoreWrite', 'recordMatch', 'tournamentSave', 'tournamentDelete', 'chatLog', 'wordsSave']);
const OMUR_MS = 13 * 24 * 3600 * 1000;     // PHP 14 gün kabul eder
const DAGITIM_ARALIK_MS = 15000;           // aynı kayıt en sık 15 sn'de bir dağıtılır

function kur(ayar) {
  const o = ayar || {};
  const KEY = String(o.key || '');
  const REMOTE = String(o.remote || '').replace(/\/+$/, '');
  const dosya = o.dosya || null;
  const kuyruk = new Map();     // id → { id, a, ts, b, sig, son, deneme }
  let yazZaman = null;

  const hmac = m => crypto.createHmac('sha256', KEY).update(m).digest('hex');

  function diskeYaz() {
    if (!dosya) return;
    if (yazZaman) return;
    yazZaman = setTimeout(() => {
      yazZaman = null;
      try {
        fs.mkdirSync(path.dirname(dosya), { recursive: true });
        fs.writeFileSync(dosya, JSON.stringify([...kuyruk.values()].map(k => ({
          id: k.id, a: k.a, ts: k.ts, b: k.b, sig: k.sig }))));
      } catch (_) {}
    }, 500);
    if (yazZaman.unref) yazZaman.unref();
  }
  function disktenOku() {
    if (!dosya) return;
    try {
      const l = JSON.parse(fs.readFileSync(dosya, 'utf8'));
      (Array.isArray(l) ? l : []).forEach(k => {
        if (k && k.id && IZINLI.has(k.a) && Date.now() - Number(k.ts) < OMUR_MS) {
          kuyruk.set(k.id, Object.assign({ son: 0, deneme: 0 }, k));
        }
      });
    } catch (_) {}
  }

  function disaVer(k) { return { id: k.id, a: k.a, ts: k.ts, b: k.b, sig: k.sig }; }

  function fisGecerli(id, fis) {
    if (!KEY || !id || typeof fis !== 'string') return false;
    const b = hmac('relayok|' + id);
    try { return fis.length === b.length && crypto.timingSafeEqual(Buffer.from(fis), Buffer.from(b)); }
    catch (_) { return false; }
  }

  async function dogrudan(k) {
    if (!REMOTE || typeof fetch !== 'function') return false;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    try {
      const r = await fetch(REMOTE + '/social.php?action=relay', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ r: disaVer(k) }), signal: ctrl.signal
      });
      const d = await r.json().catch(() => null);
      if (d && d.ok && fisGecerli(k.id, d.fis)) { kuyruk.delete(k.id); diskeYaz(); return true; }
    } catch (_) {
    } finally { clearTimeout(t); }
    return false;
  }

  /* Yeni yazım: imzala, kuyruğa koy, hemen doğrudan dene. */
  function ekle(a, govde) {
    if (!KEY || !IZINLI.has(a)) return null;
    const id = Date.now().toString(36) + crypto.randomBytes(9).toString('hex');
    const ts = Date.now();
    const b = JSON.stringify(govde == null ? {} : govde);
    const k = { id, a, ts, b, sig: hmac('relay|' + id + '|' + a + '|' + ts + '|' + b), son: 0, deneme: 0 };
    kuyruk.set(id, k);
    diskeYaz();
    dogrudan(k).catch(() => {});
    return id;
  }

  /* Tarayıcıya verilecek kayıtlar (canlı sayaç yanıtına eklenir). */
  function dagit(n) {
    const simdi = Date.now();
    const out = [];
    for (const k of kuyruk.values()) {
      if (out.length >= (n || 3)) break;
      if (simdi - k.ts > OMUR_MS) { kuyruk.delete(k.id); continue; }
      if (simdi - k.son < DAGITIM_ARALIK_MS) continue;
      k.son = simdi; k.deneme++;
      out.push(disaVer(k));
    }
    return out;
  }

  /* Tarayıcı ilettiğini fişle bildirir. */
  function onayla(liste) {
    let n = 0;
    (Array.isArray(liste) ? liste : []).slice(0, 50).forEach(x => {
      if (x && kuyruk.has(String(x.id)) && fisGecerli(String(x.id), x.fis)) {
        kuyruk.delete(String(x.id)); n++;
      }
    });
    if (n) diskeYaz();
    return n;
  }

  /* PHP'nin imzaladığı turnuva listesi (social.php?action=tournamentListSigned). */
  function turnuvaListesiDogrula(p) { return imzaliListe(p, 'tlist'); }
  /* PHP'nin imzaladığı kelime ekleri (social.php?action=wordsListSigned). */
  function kelimeListesiDogrula(p) { return imzaliListe(p, 'klist'); }
  function imzaliListe(p, onek) {
    if (!KEY || !p || typeof p.veri !== 'string' || typeof p.sig !== 'string') return null;
    const ts = Number(p.ts);
    if (!(ts > 0) || Math.abs(Date.now() - ts) > 10 * 60 * 1000) return null;
    const b = hmac(onek + '|' + ts + '|' + p.veri);
    let ok = false;
    try { ok = p.sig.length === b.length && crypto.timingSafeEqual(Buffer.from(p.sig), Buffer.from(b)); } catch (_) {}
    if (!ok) return null;
    try { const l = JSON.parse(p.veri); return Array.isArray(l) ? l : null; } catch (_) { return null; }
  }

  disktenOku();
  /* Arada bir doğrudan yolu yeniden dene (beyaz liste açıldıysa kuyruk erir). */
  const tekrar = setInterval(() => {
    let i = 0;
    for (const k of kuyruk.values()) { if (i++ >= 5) break; dogrudan(k).catch(() => {}); }
  }, 60000);
  if (tekrar.unref) tekrar.unref();

  return { ekle, dagit, onayla, turnuvaListesiDogrula, kelimeListesiDogrula, boyut: () => kuyruk.size,
           _hmac: hmac, _kuyruk: kuyruk };
}

module.exports = { kur, IZINLI };
