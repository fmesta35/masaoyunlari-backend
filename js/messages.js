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
    no_discard:     '🀄 Atılacak taş yok.',
    tile_not_found: '🀄 O taş elinizde görünmüyor — masayı yenileyin.',
    not_a_win_hand: '🀄 Bu el bitmiş sayılmıyor — perler ve seriler tamamlanmalı.',
    roll_first:     '🎲 Önce zar atmalısınız.',
    round_over:     '⏹️ Bu el kapandı, yeni el bekleniyor.'
  };

  // ---- Oyun bitiş sebepleri ----
  // Metin, kazanana / kaybedene / izleyiciye göre değişir.
  function bitis(o) {
    o = o || {};
    var r = String(o.reason || '');
    var kim = o.leftName ? ('"' + String(o.leftName).slice(0, 24) + '"') : 'Rakibiniz';

    if (o.isSpectator) {
      if (r === 'player_left') return { ikon: '🚪', baslik: 'Oyuncu ayrıldı', metin: 'Masadaki oyunculardan biri oyunu terk etti; maç sona erdi.' };
      if (r === 'move_timeout') return { ikon: '⏱️', baslik: 'Süre doldu', metin: 'Sırası gelen oyuncu süresinde hamle yapmadı.' };
      if (r === 'timeout' || r === 'time_expired') return { ikon: '⏱️', baslik: 'Süre bitti', metin: 'Oyunculardan birinin süresi tükendi.' };
      return { ikon: '🏁', baslik: 'Maç bitti', metin: 'Bu masadaki maç sona erdi.' };
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
