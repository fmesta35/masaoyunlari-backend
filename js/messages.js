/* GameVerse — KULLANICI MESAJLARI (tek kaynak)
 * ============================================
 * Sunucu, hata ve bitiş sebeplerini kısa İngilizce kodlarla gönderir
 * (illegal_move, must_follow, move_timeout…). Bu kodlar kullanıcıya
 * OLDUĞU GİBİ gösteriliyordu: ekranda "Hamle reddedildi: illegal_move"
 * gibi, ne olduğunu anlatmayan teknik bir uyarı çıkıyordu.
 *
 * Bu dosya her kodu; NE OLDUĞUNU söyleyen ve mümkünse NE YAPILACAĞINI
 * gösteren bir cümleye çevirir. Tek yerde durmasının sebebi: aynı kod
 * satranç, tavla, okey ve ortak yaşam döngüsündeki yedi oyunda aynı
 * cümleyi göstersin; her istemci kendi metnini uydurmasın.
 *
 * ÜSLUP KURALLARI
 *  - Kullanıcıyı suçlamayız: "Yanlış hamle yaptın" değil, "Bu hamle
 *    kurallara uymuyor".
 *  - Her uyarı ya sebebi ya da çıkış yolunu söyler.
 *  - Kısa: tek cümle, tek emoji.
 */
(function () {
  'use strict';
  if (window.GVMsg) return;

  // ---- Hamle/işlem reddi ----
  var RED = {
    not_your_turn:  '⏳ Sıra sizde değil — rakibinizin hamlesi bekleniyor.',
    not_in_room:    '🔌 Masayla bağlantı kurulamadı. Sayfayı yenileyip tekrar deneyin.',
    illegal_move:   '🚫 Bu hamle oyunun kurallarına uymuyor.',
    bad_move:       '🚫 Bu hamle oyunun kurallarına uymuyor.',
    occupied:       '⛔ Burası dolu — boş bir kareye oynayın.',
    column_full:    '⛔ Bu sütun dolu — başka bir sütun seçin.',
    must_follow:    '♠️ Elinizde masadaki renkten kart var, onu oynamalısınız.',
    bad_card:       '🃏 Bu kart şu an oynanamaz.',
    bad_bid:        '🔢 Geçersiz ihale — listedeki değerlerden birini seçin.',
    bad_trump:      '👑 Geçersiz koz — dört seriden birini seçin.',
    bad_shot:       '🎱 Vuruş yapılamadı — açı ve gücü ayarlayıp tekrar deneyin.',
    cue_unavailable:'🎱 Beyaz top masada değil — vuruş yapılamıyor.',
    early_eight:    '🎱 Önce kendi gruplarınızı bitirmelisiniz; 8 numara en sona kalır.',
    must_draw:      '🀄 Önce yerden ya da desteden taş çekmelisiniz.',
    must_discard:   '🀄 Elinizde fazla taş var — bir taş atmalısınız.',

    /* 101 OKEY (gerçek kurallar). Bu metinler oyuncunun gördüğü TEK
       açıklama: sunucu isteği reddettiğinde neden reddettiğini burada
       anlatıyoruz, yoksa oyuncu düğmenin çalışmadığını sanıyor. */
    draw_first:       '🀄 Önce taş çekmelisiniz.',
    already_opened:   '🎴 Zaten açtınız — artık taşlarınızı masadaki perlere işleyebilirsiniz.',
    not_opened:       '🎴 Önce elinizi açmalısınız (perlerin toplamı en az 101 ya da 5 çift).',
    no_melds:         '🎴 Açmak için en az bir per kurmalısınız.',
    below_101:        '💯 Perlerinizin toplamı 101\'e ulaşmıyor — açamazsınız.',
    bad_meld:         '🚫 Geçersiz per: aynı renkte ardışık en az 3 taş ya da aynı sayının farklı renklerinden 3-4 taş olmalı.',
    bad_pairs:        '👯 Geçersiz çift: her çift aynı renk ve aynı sayıdan iki taş olmalı.',
    need_discard_tile:'🀄 Elinizin tamamını koyamazsınız — atacak en az bir taş kalmalı.',
    tile_not_in_hand: '🚫 O taş elinizde değil.',
    duplicate_tile:   '🚫 Aynı taşı iki perde birden kullanamazsınız.',
    no_meld:          '🚫 Masada öyle bir per yok.',
    pairs_locked:     '👯 Çift açılışına taş işlenemez.',
    empty_pile:       '🀄 Alınacak atık taş yok — desteden çekin.',
    /* 101 kuralı: açmadan yerden taş alınmaz (klasik Okey'de bu kısıt yok). */
    acmadan_yerden_alinmaz:
      '🎴 Açmadan yerden taş alınmaz — önce elinizi açın (en az 101 ya da 5 çift). Şimdilik desteden çekebilirsiniz.',
    no_discard:     '🀄 Atılacak taş yok.',
    tile_not_found: '🀄 O taş elinizde görünmüyor — masayı yenileyin.',
    not_a_win_hand: '🀄 Bu el bitmiş sayılmıyor — perler ve seriler tamamlanmalı.',
    roll_first:     '🎲 Önce zar atmalısınız.',
    round_over:     '⏹️ Bu el kapandı, yeni el bekleniyor.',
    real_okey_discarded: '⚠️ Gerçek okeyi açık attınız! 101 puan ceza aldınız.',

    // ---- Kelimelik ----
    // Sunucu motorunun (kelimelik-engine.js) döndürdüğü her ret sebebinin
    // oyuncuya KOD değil CÜMLE olarak karşılığı.
    bos_hamle:        '🔤 Tahtaya hiç harf koymadınız.',
    tek_hat_degil:    '🔤 Harfler tek bir hat üzerinde olmalı — ya hepsi yatay ya hepsi dikey.',
    arada_bosluk:     '🔤 Harflerin arasında boşluk var — kelime kesintisiz dizilmeli.',
    merkezden_gecmeli:'⭐ İlk kelime ★ başlangıç karesinden geçmeli.',
    en_az_iki_harf:   '🔤 İlk kelime en az iki harfli olmalı.',
    temas_yok:        '🔤 Yeni harfler tahtadaki bir kelimeye değmeli.',
    kelime_olusmadi:  '🔤 Geçerli bir kelime oluşmadı.',
    sozlukte_yok:     '📖 Bu kelime sözlükte yok. TDK\'de olduğunu düşünüyorsanız 📣 Kelime Bildir ile iletebilirsiniz.',
    istakanda_yok:    '🔤 O harf ıstakanızda yok — masayı yenileyin.',
    kare_dolu:        '⛔ Burası dolu — boş bir kareye oynayın.',
    ayni_kare:        '⛔ Aynı kareye iki taş konamaz.',
    gecersiz_kare:    '⛔ Tahtanın dışına taş konamaz.',
    gecersiz_harf:    '🔤 Geçersiz harf — joker için harf seçmelisiniz.',
    gecersiz_hamle:   '🚫 Bu hamle oyunun kurallarına uymuyor.',
    torba_bos:        '🎒 Torbada taş kalmadı — harf değiştirilemez.',
    torbada_yetersiz: '🎒 Torbada o kadar taş yok — daha az harf seçin.',
    secim_yok:        '🔤 Değiştirmek için hiç harf seçmediniz.',

    // ---- İzleyici (koltuk seçerek izleme) ----
    /* Kullanıcı isteği: izleyici bir oyuncu seçer ve onun ekranından izler;
       oyuncu izni kaldırırsa seçilemez ve izleyen varsa odadan çıkarılır.
       Sunucunun kısa kodları (bkz. server.js 'spectateSeat' /
       'spectatorEjected') burada tek cümlelik Türkçeye çevrilir. */
    not_allowed:        '⛔ Bu oyuncu izleyicilere kapalı — izin veren bir oyuncu seçin.',
    no_seat:            '🪑 O koltukta oyuncu yok — listeden birini seçin.',
    unsupported:        '👁️ Bu oyunda oyuncu seçerek izleme yok; masayı tarafsız izliyorsunuz.',
    permission_revoked: '🚫 İzlediğiniz oyuncu izleyici iznini kapattı — lobiye yönlendiriliyorsunuz.',

    // ---- Amiral Battı (Battleship) ----
    bad_seat: '🔌 Masayla bağlantı kurulamadı. Sayfayı yenileyip tekrar deneyin.',
    wrong_phase: '🚫 Bu işlem şu anki oyun aşamasında yapılamaz.',
    already_ready: '✅ Filonuzu zaten onayladınız — rakibinizi bekleyin.',
    invalid_fleet: '🚢 Filo eksik ya da hatalı — 5 geminin tümünü yerleştirmelisiniz.',
    missing_ship: '🚢 Filonuzda eksik bir gemi var — tüm gemileri yerleştirin.',
    duplicate_ship: '🚢 Bir gemi birden fazla kez yerleştirilemez.',
    out_of_bounds: '🗺️ Bu yerleşim harita sınırlarının dışına taşıyor.',
    overlap: '🚢 Gemiler birbiriyle çakışamaz — başka bir yer seçin.',
    already_fired: '🎯 Bu kareye zaten ateş ettiniz — başka bir kare seçin.',

    // ---- Pes etme / rövanş (yeniden oyna) ----
    resign:       '🏳️ Maç pes edilerek sonlandı.',
    declined:     '↩️ Rövanş teklifi reddedildi.',
    no_opponent:  '👥 Masada rövanş yapacak rakip kalmadı.'
  };

  // ---- Oyun bitiş sebepleri ----
  // Metin, kazanana / kaybedene / izleyiciye göre değişir.
  function bitis(o) {
    o = o || {};
    var r = String(o.reason || '');
    var kim = o.leftName ? ('"' + String(o.leftName).slice(0, 24) + '"') : 'Rakibiniz';

    // Pes etme: ayrılmaktan farkı, oyuncunun masada KALMASIDIR — bu yüzden
    // metin "terk etti" demez ve rövanş imkânını hatırlatır.
    var pesEden = o.resignedName ? ('"' + String(o.resignedName).slice(0, 24) + '"') : 'Rakibiniz';

    if (o.isSpectator) {
      if (r === 'resign') return { ikon: '🏳️', baslik: 'Pes edildi', metin: 'Oyunculardan biri pes etti; maç sona erdi.' };
      if (r === 'player_left') return { ikon: '🚪', baslik: 'Oyuncu ayrıldı', metin: 'Masadaki oyunculardan biri oyunu terk etti; maç sona erdi.' };
      if (r === 'move_timeout') return { ikon: '⏱️', baslik: 'Süre doldu', metin: 'Sırası gelen oyuncu süresinde hamle yapmadı.' };
      if (r === 'timeout' || r === 'time_expired') return { ikon: '⏱️', baslik: 'Süre bitti', metin: 'Oyunculardan birinin süresi tükendi.' };
      return { ikon: '🏁', baslik: 'Maç bitti', metin: 'Bu masadaki maç sona erdi.' };
    }

    if (r === 'resign') {
      return o.youWon
        ? { ikon: '🏆', baslik: 'Kazandınız', metin: pesEden + ' pes etti — maçı siz kazandınız. Dilerseniz rövanş isteyebilirsiniz.' }
        : { ikon: '🏳️', baslik: 'Pes ettiniz', metin: 'Bu maçı pes ederek bıraktınız. Masadasınız — rövanş isteyebilirsiniz.' };
    }
    if (r === 'player_left') {
      return o.youWon
        ? { ikon: '🏆', baslik: 'Kazandınız', metin: kim + ' masadan ayrıldı, bu yüzden maçı siz kazandınız.' }
        : { ikon: '🚪', baslik: 'Maç bitti', metin: 'Masadan ayrıldığınız için maç sonlandı.' };
    }
    if (r === 'move_timeout') {
      return o.youWon
        ? { ikon: '🏆', baslik: 'Kazandınız', metin: kim + ' süresi içinde hamle yapmadı.' }
        : { ikon: '⏱️', baslik: 'Süre doldu', metin: 'Hamle sürenizi kullanamadınız; maç rakibinize gitti.' };
    }
    if (r === 'timeout' || r === 'time_expired') {
      return o.youWon
        ? { ikon: '🏆', baslik: 'Kazandınız', metin: 'Rakibinizin süresi bitti.' }
        : { ikon: '⌛', baslik: 'Süreniz bitti', metin: 'Oyun süreniz tükendi; maç rakibinize gitti.' };
    }
    if (r === 'checkmate') {
      return o.youWon
        ? { ikon: '🏆', baslik: 'Şah mat!', metin: 'Rakibinizin şahını mat ettiniz.' }
        : { ikon: '♟️', baslik: 'Şah mat', metin: 'Şahınız mat oldu. Bir sonraki masada bol şans!' };
    }
    if (r === 'stalemate' || r === 'draw' || r === 'fifty_move' ||
        r === 'insufficient_material' || r === 'threefold_repetition') {
      var acik = {
        stalemate: 'Oynanacak yasal hamle kalmadı.',
        fifty_move: 'Elli hamle boyunca taş alınmadı ve piyon oynanmadı.',
        insufficient_material: 'Mat için yeterli taş kalmadı.',
        threefold_repetition: 'Aynı konum üç kez tekrarlandı.'
      }[r] || 'İki taraf da kazanamadı.';
      return { ikon: '🤝', baslik: 'Berabere', metin: acik };
    }
    if (r === 'fleet_sunk') {
      return o.youWon
        ? { ikon: '🏆', baslik: 'Filoyu batırdınız!', metin: 'Rakibinizin TÜM filosunu batırdınız — zafer sizin!' }
        : { ikon: '🚢', baslik: 'Filonuz battı', metin: 'Tüm gemileriniz battı; bu maçı rakibiniz kazandı.' };
    }
    if (r === 'placement_timeout') {
      if (o.winnerSeat === null || o.winnerSeat === undefined) {
        return { ikon: '⏱️', baslik: 'Yerleştirme süresi doldu', metin: 'İki taraf da filosunu süresinde tamamlamadı; masa iptal edildi.' };
      }
      return o.youWon
        ? { ikon: '🏆', baslik: 'Kazandınız', metin: 'Rakibiniz filosunu süresinde yerleştirmedi.' }
        : { ikon: '⏱️', baslik: 'Süre doldu', metin: 'Filonuzu süresinde yerleştiremediniz; maç rakibinize gitti.' };
    }
    return o.youWon
      ? { ikon: '🏆', baslik: 'Kazandınız', metin: 'Tebrikler, bu masayı siz kazandınız!' }
      : { ikon: '🎯', baslik: 'Maç bitti', metin: 'Bu masayı rakibiniz kazandı. Yeni bir masada tekrar deneyin!' };
  }

  window.GVMsg = {
    /* Reddedilen hamle/işlem için tek cümlelik açıklama. */
    red: function (reason) {
      var k = String(reason || '').trim();
      return RED[k] || '🚫 Bu işlem şu anda yapılamıyor.';
    },
    /* Bitiş ekranı için {ikon, baslik, metin}. */
    bitis: bitis,
    /* Test/teşhis: tanımlı kod listesi */
    _kodlar: function () { return Object.keys(RED); }
  };
})();
