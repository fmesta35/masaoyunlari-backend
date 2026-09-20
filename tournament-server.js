/* ==========================================================================
   TURNUVA SUNUCU KATMANI
   --------------------------------------------------------------------------
   Kurallar tournament-engine.js'te (saf mantık), kalıcılık authApi'de
   (SQLite ya da Yöncü MySQL). Burası ikisini birleştirir ve zamanı yönetir:

     • Kurucu panelden turnuvayı kurar: oyun, ad, KAYIT penceresi
       (açılış/kapanış), BAŞLANGIÇ/BİTİŞ saati, kapasite ve özel not.
     • Kayıt penceresi açılınca durum 'kayit' olur; üyeler "Turnuvaya Katıl"
       ile kendilerini yazdırır (ziyaretçi katılamaz).
     • Kayıt olan üyeye anında bildirim gider; kontenjan dolunca HERKESE
       "turnuva başlıyor" bildirimi gider.
     • Başlangıç saatinde kura çekilir, braket kurulur ve her eşleşme için
       O OYUNA ÖZEL bir turnuva odası açılır; yalnız o iki oyuncu girebilir.
     • Maç bitince kazanan brakete işlenir, bir üst turun odası açılır.
     • Final bitince şampiyon ilan edilir.

   ZAMAN: kurucunun verdiği saatler sunucu saatine göre çalışır; tarayıcı
   saati kullanılmaz (oyuncular farklı saat diliminde olabilir).
   ========================================================================== */
'use strict';

const motor = require('./tournament-engine');

const TIK_MS = Number(process.env.GV_TOURNAMENT_TICK_MS) || 20000;
const MAC_SURESI_DK = Number(process.env.GV_TOURNAMENT_MATCH_MIN) || 10;

function kur(ortam) {
  const { io, authApi, app, rooms, createRoom, emitRoom, requireAdmin } = ortam;

  let turnuvalar = [];            // bellekteki kopya (tek kaynak: authApi)
  let hazirMi = false;
  let zamanlayici = null;

  /* ------------------------------------------------------------ yardımcılar */
  const simdi = () => Date.now();

  async function yukle() {
    try {
      const liste = await authApi.turnuvaListe();
      turnuvalar = Array.isArray(liste) ? liste : [];
    } catch (_) { turnuvalar = []; }
    hazirMi = true;
    return turnuvalar;
  }

  async function kaydet(t) {
    t.guncelleme = simdi();
    const i = turnuvalar.findIndex(x => x.id === t.id);
    if (i >= 0) turnuvalar[i] = t; else turnuvalar.push(t);
    try { await authApi.turnuvaKaydet(t); } catch (e) {
      console.warn('turnuva kaydedilemedi:', e.message);
    }
    return t;
  }

  function bul(id) { return turnuvalar.find(t => t.id === String(id)) || null; }

  /* Ekrana giden biçim: braket ve katılımcılar herkese açıktır (kullanıcının
     isteği: "eşleşen kişiler herkese açık bir şekilde tablo hâlinde"). */
  function disaVer(t, uid) {
    const braket = t.braket || null;
    return {
      id: t.id, gameId: t.gameId, ad: t.ad, durum: t.durum,
      kayitAcilis: t.kayitAcilis, kayitKapanis: t.kayitKapanis,
      baslangic: t.baslangic, bitis: t.bitis,
      kapasite: t.kapasite, not: t.not || '',
      katilimci: (t.katilimcilar || []).length,
      katilimcilar: (t.katilimcilar || []).map(k => ({ uid: k.uid, name: k.name })),
      kayitliyim: uid != null && (t.katilimcilar || []).some(k => Number(k.uid) === Number(uid)),
      braket: braket ? { boy: braket.boy, turlar: braket.turlar,
                         turAdlari: braket.turlar.map((_, i) => motor.turAdi(braket.turlar.length, i)) } : null,
      sampiyon: braket ? motor.sampiyon(braket) : null,
      benimMac: (braket && uid != null) ? motor.uyeMaci(braket, Number(uid)) : null,
      duyurular: (t.duyurular || []).slice(-10)
    };
  }

  function yayinla(t) {
    try { io.emit('tournamentUpdated', { id: t.id }); } catch (_) {}
  }

  /* Bildirim: çevrimiçi üyeye anında gider. Ayrıca turnuvanın duyuru
     defterine yazılır — o sırada çevrimdışı olan üye turnuva sayfasını
     açtığında duyuruyu orada görür (bildirimler kalıcı saklanmıyor). */
  function duyur(t, metin, hedefUidler) {
    const kayit = { ts: simdi(), metin: String(metin || '').slice(0, 400) };
    t.duyurular = (t.duyurular || []).concat([kayit]).slice(-50);
    const govde = {
      baslik: '🏆 ' + t.ad,
      metin: kayit.metin + (t.not ? ('\n' + t.not) : ''),
      turnuvaId: t.id, gameId: t.gameId, ts: kayit.ts
    };
    try {
      if (Array.isArray(hedefUidler)) {
        hedefUidler.forEach(u => { if (u != null) authApi.emitToUser(Number(u), 'tournamentNotice', govde); });
      } else {
        io.emit('tournamentNotice', govde);
      }
    } catch (_) {}
  }

  function tarihMetni(ms) {
    if (!ms) return '';
    try {
      return new Date(ms).toLocaleString('tr-TR',
        { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
    } catch (_) { return new Date(ms).toISOString(); }
  }

  /* ------------------------------------------------------- maç odası açma */
  function odaAc(t, mac) {
    if (!mac || !mac.a || !mac.b || mac.roomId) return null;
    const id = 'T' + String(t.id).slice(-6) + '-' + mac.id;
    let room = rooms.get(id);
    if (!room) {
      room = createRoom(id, t.gameId, 2, MAC_SURESI_DK, {
        isPrivate: true,
        name: t.ad + ' — ' + motor.turAdi((t.braket.turlar || []).length, mac.tur)
      });
    }
    /* Turnuva odası: yalnız eşleşen iki oyuncu girebilir. Özel oda kapısı
       zaten "davetli" listesine bakıyor; iki oyuncuyu oraya yazıyoruz.
       Kurucu alanı boş bırakılır ki ikisi de eşit haklı olsun. */
    room.turnuva = { id: t.id, macId: mac.id, tur: mac.tur };
    room.creatorId = null;
    if (!room.invited || typeof room.invited.set !== 'function') room.invited = new Map();
    room.invited.set(Number(mac.a.uid), { ts: simdi() });
    room.invited.set(Number(mac.b.uid), { ts: simdi() });
    mac.roomId = id;
    mac.durum = 'oynaniyor';
    try { emitRoom(room); } catch (_) {}
    return room;
  }

  function odalariAc(t) {
    if (!t.braket) return;
    motor.oynanacakMaclar(t.braket).forEach(mac => {
      const oda = odaAc(t, mac);
      if (!oda) return;
      const ne = motor.turAdi(t.braket.turlar.length, mac.tur);
      duyur(t, ne + ' maçınız hazır: ' + mac.a.name + ' — ' + mac.b.name +
               '. Turnuva sayfasından masaya geçin.', [mac.a.uid, mac.b.uid]);
    });
  }

  /* ------------------------------------------------------------- başlatma */
  async function baslat(t) {
    const kisi = (t.katilimcilar || []).length;
    if (kisi < 2) {
      t.durum = 'iptal';
      duyur(t, 'Yeterli katılım olmadığı için turnuva iptal edildi.');
      await kaydet(t); yayinla(t);
      return;
    }
    const tohum = (simdi() ^ (kisi * 2654435761)) >>> 0;
    t.braket = motor.braketKur(t.katilimcilar, tohum);
    t.durum = 'devam';
    duyur(t, 'Turnuva başladı! Kura çekildi, eşleşmeler turnuva sayfasında.');
    odalariAc(t);
    await kaydet(t); yayinla(t);
  }

  /* --------------------------------------------- maç bitti (server.js hook) */
  function macBitti(room) {
    if (!room || !room.turnuva || !room.result) return;
    const t = bul(room.turnuva.id);
    if (!t || !t.braket || t.durum !== 'devam') return;

    // Kazananın ÜYE kimliği: oyunlar kazananı koltuk indeksiyle bildirir.
    let kazananUid = null;
    const seat = room.result.winnerSeat;
    if (seat !== null && seat !== undefined) {
      const p = (room.players || []).find(x => x && x.seat === seat);
      if (p && p.userId) kazananUid = Number(p.userId);
    }
    if (kazananUid == null && room.result.winner != null) kazananUid = Number(room.result.winner);
    if (kazananUid == null) return;                 // beraberlik/belirsiz: dokunma

    const r = motor.sonucIsle(t.braket, room.turnuva.macId, kazananUid);
    if (!r.ok) return;

    const ad = (r.mac.a && r.mac.a.uid === kazananUid) ? r.mac.a.name : (r.mac.b ? r.mac.b.name : '');
    const turAd = motor.turAdi(t.braket.turlar.length, r.mac.tur);
    duyur(t, turAd + ' sonucu: ' + ad + ' kazandı ve bir üst tura çıktı.');

    if (r.sampiyon) {
      t.durum = 'bitti';
      t.sampiyon = r.sampiyon;
      duyur(t, '🏆 ŞAMPİYON: ' + r.sampiyon.name + '! Tebrikler.');
    } else {
      odalariAc(t);
    }
    kaydet(t).then(() => yayinla(t)).catch(() => {});
  }

  /* ------------------------------------------------------------ zaman tiki */
  async function tik() {
    if (!hazirMi) await yukle();
    const n = simdi();
    for (const t of turnuvalar.slice()) {
      try {
        if (t.durum === 'taslak' && t.kayitAcilis && n >= t.kayitAcilis) {
          t.durum = 'kayit';
          duyur(t, 'Kayıtlar açıldı. Turnuva ' + tarihMetni(t.baslangic) +
                   ' saatinde başlayacak. Katılmak için turnuva sayfasına gidin.');
          await kaydet(t); yayinla(t);
          continue;
        }
        if (t.durum === 'kayit' && t.kayitKapanis && n >= t.kayitKapanis) {
          t.durum = (t.katilimcilar || []).length >= 2 ? 'hazir' : 'iptal';
          duyur(t, t.durum === 'hazir'
            ? ('Kayıtlar kapandı. ' + (t.katilimcilar || []).length +
               ' katılımcıyla turnuva ' + tarihMetni(t.baslangic) + ' saatinde başlıyor.')
            : 'Yeterli katılım olmadığı için turnuva iptal edildi.');
          await kaydet(t); yayinla(t);
          continue;
        }
        if ((t.durum === 'kayit' || t.durum === 'hazir') && t.baslangic && n >= t.baslangic) {
          await baslat(t);
          continue;
        }
        if (t.durum === 'devam' && t.braket) {
          // Bir tur bitip üst turun eşleşmeleri oluştuysa odalarını aç.
          const acilacak = motor.oynanacakMaclar(t.braket).filter(m => !m.roomId);
          if (acilacak.length) { odalariAc(t); await kaydet(t); yayinla(t); }
        }
      } catch (e) { console.warn('turnuva tiki:', t && t.id, e.message); }
    }
  }

  /* ================================================================ UÇLAR */
  // Herkese açık: turnuva listesi (braket dâhil).
  app.get('/api/tournaments', async (req, res) => {
    if (!hazirMi) await yukle();
    let uid = null;
    try { const u = await authApi.userFromReqAsync(req); uid = u ? u.id : null; } catch (_) {}
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, liste: turnuvalar.map(t => disaVer(t, uid)) });
  });

  // Üye kaydı: "Turnuvaya Katıl".
  app.post('/api/tournaments/:id/katil', async (req, res) => {
    if (!hazirMi) await yukle();
    let u = null;
    try { u = await authApi.userFromReqAsync(req); } catch (_) {}
    if (!u || !u.id) {
      return res.status(401).json({ ok: false, error: 'Turnuvaya yalnızca üyeler katılabilir. Giriş yapın.' });
    }
    const t = bul(req.params.id);
    if (!t) return res.status(404).json({ ok: false, error: 'Turnuva bulunamadı.' });
    if (t.durum !== 'kayit') {
      return res.status(400).json({ ok: false, error: 'Kayıtlar şu anda açık değil.' });
    }
    t.katilimcilar = t.katilimcilar || [];
    if (t.katilimcilar.some(k => Number(k.uid) === Number(u.id))) {
      return res.json({ ok: true, zaten: true, turnuva: disaVer(t, u.id) });
    }
    if (t.kapasite && t.katilimcilar.length >= t.kapasite) {
      return res.status(400).json({ ok: false, error: 'Kontenjan doldu.' });
    }
    t.katilimcilar.push({ uid: Number(u.id), name: String(u.name || 'Oyuncu'), ts: simdi() });

    duyur(t, 'Kaydınız alındı. ' + t.ad + ' turnuvası ' + tarihMetni(t.baslangic) +
             ' saatinde başlayacak; eşleşmeniz başlangıçta turnuva sayfasında görünecek.',
          [u.id]);

    if (t.kapasite && t.katilimcilar.length >= t.kapasite) {
      t.durum = 'hazir';
      duyur(t, 'Kontenjan doldu! ' + t.ad + ' turnuvası ' + tarihMetni(t.baslangic) + ' saatinde başlıyor.');
    }
    await kaydet(t); yayinla(t);
    res.json({ ok: true, turnuva: disaVer(t, u.id) });
  });

  // Üye kaydını geri çeker (turnuva başlamadan).
  app.post('/api/tournaments/:id/ayril', async (req, res) => {
    let u = null;
    try { u = await authApi.userFromReqAsync(req); } catch (_) {}
    if (!u || !u.id) return res.status(401).json({ ok: false, error: 'Giriş gerekli.' });
    const t = bul(req.params.id);
    if (!t) return res.status(404).json({ ok: false, error: 'Turnuva bulunamadı.' });
    if (t.durum !== 'kayit' && t.durum !== 'hazir') {
      return res.status(400).json({ ok: false, error: 'Turnuva başladıktan sonra çıkılamaz.' });
    }
    t.katilimcilar = (t.katilimcilar || []).filter(k => Number(k.uid) !== Number(u.id));
    if (t.durum === 'hazir' && t.kapasite && t.katilimcilar.length < t.kapasite) t.durum = 'kayit';
    await kaydet(t); yayinla(t);
    res.json({ ok: true, turnuva: disaVer(t, u.id) });
  });

  /* ---------------------------------------------------------- KURUCU UÇLARI */
  app.get('/api/admin/tournaments', async (req, res) => {
    if (!await requireAdmin(req, res)) return;
    if (!hazirMi) await yukle();
    res.json({ ok: true, liste: turnuvalar.map(t => disaVer(t, null)) });
  });

  app.post('/api/admin/tournaments', async (req, res) => {
    const u = await requireAdmin(req, res);
    if (!u) return;
    if (!hazirMi) await yukle();
    const b = req.body || {};
    const id = b.id ? String(b.id) : ('t' + simdi().toString(36));
    const eski = bul(id);
    const sayi = v => (v === null || v === undefined || v === '') ? null : Number(v);

    const t = eski || { id, olusturanUid: u.id, olusturma: simdi(), katilimcilar: [], duyurular: [], braket: null };
    t.gameId = String(b.gameId || t.gameId || 'chess');
    t.ad = String(b.ad || t.ad || 'Turnuva').slice(0, 120);
    t.kayitAcilis = sayi(b.kayitAcilis) != null ? sayi(b.kayitAcilis) : t.kayitAcilis;
    t.kayitKapanis = sayi(b.kayitKapanis) != null ? sayi(b.kayitKapanis) : t.kayitKapanis;
    t.baslangic = sayi(b.baslangic) != null ? sayi(b.baslangic) : t.baslangic;
    t.bitis = sayi(b.bitis) != null ? sayi(b.bitis) : t.bitis;
    t.kapasite = Number(b.kapasite) || t.kapasite || 8;
    t.not = b.not !== undefined ? String(b.not).slice(0, 400) : (t.not || '');
    if (!t.durum) t.durum = 'taslak';
    if (b.durum && ['taslak', 'kayit', 'hazir', 'iptal', 'ertelendi'].includes(b.durum)) t.durum = b.durum;

    if (!t.kayitAcilis || !t.kayitKapanis || !t.baslangic) {
      return res.status(400).json({ ok: false, error: 'Kayıt açılış/kapanış ve başlangıç saati zorunlu.' });
    }
    if (t.kayitKapanis <= t.kayitAcilis || t.baslangic < t.kayitKapanis) {
      return res.status(400).json({ ok: false,
        error: 'Saatler tutarsız: kayıt açılışı < kayıt kapanışı ≤ başlangıç olmalı.' });
    }
    await kaydet(t); yayinla(t);
    res.json({ ok: true, turnuva: disaVer(t, null) });
  });

  // Duyuru / erteleme / iptal — kurucunun özel notuyla birlikte.
  app.post('/api/admin/tournaments/:id/duyuru', async (req, res) => {
    if (!await requireAdmin(req, res)) return;
    const t = bul(req.params.id);
    if (!t) return res.status(404).json({ ok: false, error: 'Turnuva bulunamadı.' });
    const b = req.body || {};
    if (b.durum && ['iptal', 'ertelendi', 'kayit', 'hazir', 'taslak'].includes(b.durum)) t.durum = b.durum;
    if (b.baslangic) t.baslangic = Number(b.baslangic);
    duyur(t, String(b.metin || 'Turnuva ile ilgili duyuru.'));
    await kaydet(t); yayinla(t);
    res.json({ ok: true, turnuva: disaVer(t, null) });
  });

  app.delete('/api/admin/tournaments/:id', async (req, res) => {
    if (!await requireAdmin(req, res)) return;
    const t = bul(req.params.id);
    if (t && t.durum === 'devam') {
      return res.status(400).json({ ok: false, error: 'Devam eden turnuva silinemez; önce iptal edin.' });
    }
    turnuvalar = turnuvalar.filter(x => x.id !== String(req.params.id));
    try { await authApi.turnuvaSil(req.params.id); } catch (_) {}
    try { io.emit('tournamentUpdated', { id: String(req.params.id), silindi: true }); } catch (_) {}
    res.json({ ok: true });
  });

  /* --------------------------------------------------------------- yaşam */
  function basla() {
    yukle().then(() => { tik(); }).catch(() => {});
    if (!zamanlayici) {
      zamanlayici = setInterval(() => { tik().catch(() => {}); }, TIK_MS);
      if (zamanlayici.unref) zamanlayici.unref();
    }
  }
  function dur() { if (zamanlayici) { clearInterval(zamanlayici); zamanlayici = null; } }

  basla();

  return { macBitti, tik, dur, yukle, bul, _liste: () => turnuvalar };
}

module.exports = { kur, TIK_MS };
