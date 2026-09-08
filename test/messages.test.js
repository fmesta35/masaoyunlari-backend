'use strict';

/*
 * KULLANICI MESAJLARI — hiçbir teknik kod ekrana çıkmasın
 *
 *  Kullanıcı raporu: ekranda "Hamle reddedildi: illegal_move" gibi
 *  yazılar görünüyordu. Sunucu sebepleri kısa İngilizce kodlarla
 *  gönderir; js/messages.js bunları tek cümlelik Türkçe metne çevirir.
 *
 *  Bu test sözlüğü SUNUCUNUN KENDİSİNDEN türetir: server.js ve motorlarda
 *  geçen her reason kodunu toplar ve karşılığının yazılmış olmasını şart
 *  koşar. Yeni bir kod eklenip metni unutulursa test kırmızı olur.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

// messages.js bir IIFE'dir ve window bekler: sahte bir window ile çalıştır.
function yukle() {
  const kod = fs.readFileSync(path.join(__dirname, '..', 'js', 'messages.js'), 'utf8');
  const w = {};
  new Function('window', kod)(w);
  return w.GVMsg;
}

// Bitiş ekranında kullanılan sebepler (red uyarısı değil).
const BITIS = new Set([
  'player_left', 'move_timeout', 'timeout', 'time_expired', 'finished',
  'checkmate', 'stalemate', 'draw', 'fifty_move', 'insufficient_material',
  'threefold_repetition', 'round_over'
]);

function sunucuKodlari() {
  const kok = path.join(__dirname, '..');
  const dosyalar = fs.readdirSync(kok).filter(f => /\.js$/.test(f) && !/^socket\.io/.test(f));
  const kodlar = new Set();
  for (const f of dosyalar) {
    const s = fs.readFileSync(path.join(kok, f), 'utf8');
    const re = /reason:\s*'([a-z_]+)'/g;
    let m;
    while ((m = re.exec(s))) kodlar.add(m[1]);
  }
  return [...kodlar].sort();
}

function main() {
  const M = yukle();
  assert.ok(M && typeof M.red === 'function' && typeof M.bitis === 'function', 'GVMsg yüklenmeli');

  const genel = M.red('__boyle_bir_kod_yok__');
  const kodlar = sunucuKodlari();
  assert.ok(kodlar.length > 15, 'sunucudan kod toplanmalı, bulunan: ' + kodlar.length);

  const eksik = [];
  for (const k of kodlar) {
    if (BITIS.has(k)) continue;              // bunlar bitiş ekranında karşılanır
    if (M.red(k) === genel) eksik.push(k);
  }
  assert.deepStrictEqual(eksik, [],
    'şu sebep kodlarının Türkçe karşılığı yazılmamış: ' + eksik.join(', '));
  console.log('  ✓ 1) sunucunun ürettiği ' + kodlar.length + ' sebep kodunun tamamı karşılanıyor');

  // Hiçbir metin kod sızdırmamalı
  for (const k of kodlar) {
    const t = M.red(k);
    assert.ok(!/[a-z]+_[a-z]+/.test(t), 'red metni kod sızdırıyor (' + k + '): ' + t);
  }
  for (const k of [...BITIS]) {
    for (const kazandi of [true, false]) {
      const b = M.bitis({ reason: k, youWon: kazandi });
      assert.ok(b && b.ikon && b.baslik && b.metin, 'bitiş metni eksik: ' + k);
      const hepsi = b.baslik + ' ' + b.metin;
      assert.ok(!/[a-z]+_[a-z]+/.test(hepsi), 'bitiş metni kod sızdırıyor (' + k + '): ' + hepsi);
    }
    const izleyici = M.bitis({ reason: k, isSpectator: true });
    assert.ok(!/[a-z]+_[a-z]+/.test(izleyici.baslik + ' ' + izleyici.metin),
      'izleyici metni kod sızdırıyor: ' + k);
  }
  console.log('  ✓ 2) hiçbir uyarı ya da bitiş metni teknik kod içermiyor');

  // Kazanan ve kaybeden AYNI metni görmemeli (ters mesaj hatası kapalı kalsın)
  for (const k of ['player_left', 'move_timeout', 'timeout', 'checkmate']) {
    const kazanan = M.bitis({ reason: k, youWon: true });
    const kaybeden = M.bitis({ reason: k, youWon: false });
    assert.notStrictEqual(kazanan.baslik + kazanan.metin, kaybeden.baslik + kaybeden.metin,
      k + ': kazanan ve kaybeden aynı metni görüyor');
    // Satrançta kazanana 'Şah mat!' demek daha doğru; diğerlerinde açıkça
    // 'Kazandınız' yazar. Her durumda kazananın kutusu kupa ikonlu olmalı.
    assert.ok(/Kazand/i.test(kazanan.baslik) || kazanan.ikon === '🏆',
      k + ': kazanan açıkça kazandığını anlamalı, görülen: ' + kazanan.baslik);
  }
  console.log('  ✓ 3) kazanan ve kaybeden birbirinden farklı, doğru metni görüyor');

  // Ayrılan oyuncunun adı metne taşınıyor (kim ayrıldı belli olsun)
  const adli = M.bitis({ reason: 'player_left', youWon: true, leftName: 'Ahmet' });
  assert.ok(/Ahmet/.test(adli.metin), 'ayrılan oyuncunun adı metinde geçmeli: ' + adli.metin);
  console.log('  ✓ 4) "rakip ayrıldı" mesajı ayrılan oyuncunun adını taşıyor');

  console.log('OK kullanıcı mesajları: kod değil cümle');
}

try { main(); } catch (e) { console.error('❌ MESAJ TEST HATASI:', e.message); process.exit(1); }
