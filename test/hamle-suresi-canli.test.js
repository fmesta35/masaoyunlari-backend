'use strict';
/* ============================================================================
 * HAMLE SÜRESİ KURUCU PANELİNDEN ANINDA — TÜM MASALARDA
 * ============================================================================
 * Kullanıcı raporu: "101 okey, hamle süresi hâlâ 30 saniye, kurucu panelinde
 * 60 saniye belirlenmişti. Tüm oyunlarda sonradan eklenen veya önceden
 * eklenen masalarda kurucu panelinde yapılan ayarlar anında güncellenecek
 * şekilde sistemi tasarla."
 *
 *  1) Hazır masa (oynanıyor) → satırdaki 60 sn tur sayacına ANINDA geçer.
 *  2) Listede OLMAYAN masa (üyenin kurduğu / eski kimlikli) → oyunun GENEL
 *     hamle süresini alır.
 *  3) Sonradan EKLENEN masa → kendi satır değeriyle doğar.
 *  4) Satır boşsa genel değer, genel de boşsa yerleşik varsayılan.
 *  5) Ayar senkronu: games-meta ayarSenkron bildirir.
 * ========================================================================= */
const fs = require('fs'), os = require('os'), path = require('path');
process.env.GV_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-hamle-canli-'));
process.env.GV_OKEY_PRESETS = '1';
const assert = require('assert');
const S = require('../server.js');

function tabloKopya(g) { return JSON.parse(JSON.stringify(S.defaultPresetConfig()[g].tables)); }

(async () => {
  await S.start(0);
  try {
    const port = S.server.address().port;
    const base = S.defaultPresetConfig();
    const t101 = tabloKopya('okey101');
    const id0 = String(t101[0].id), id1 = String(t101[1].id);
    const oda0 = S.rooms.get(id0);
    assert.ok(oda0, '101 Okey hazır masası tohumlanmalı: ' + id0);
    assert.strictEqual(oda0.moveLimitMs, 30000, 'başlangıçta yerleşik varsayılan 30 sn');

    // Masa OYNANIYORMUŞ gibi: oyuncu + okey tur sayacı
    oda0.players.push({ id: 'x', seat: 0, name: 'Ali', isReady: true });
    oda0.status = 'playing';
    oda0.okey = { yeni101: true, turnDeadlineMs: 30000, turnStartedAt: Date.now() };

    // Listede olmayan masa (üyenin kurduğu masayı temsilen): id1'i listeden çıkar, dolu kalsın
    const oda1 = S.rooms.get(id1);
    oda1.players.push({ id: 'y', seat: 0, name: 'Veli', isReady: false });

    // 1+2) Kurucu: satır 0 → 60 sn; oyun geneli → 45 sn; satır 1 listeden çıkar; yeni masa 90 sn
    const cfg = JSON.parse(JSON.stringify(base));
    const yeni = t101.filter((_, i) => i !== 1);
    yeni[0].moveSeconds = 60;
    yeni[2].moveSeconds = 0;   // kurucu kutuyu BOŞ bıraktı
    const yeniMasa = Object.assign({}, yeni[yeni.length - 1], { id: undefined, name: 'Yeni Masa', moveSeconds: 90 });
    delete yeniMasa.id;
    yeni.push(yeniMasa);
    cfg.okey101 = { visible: true, moveSeconds: 45, tables: yeni };
    // Satranç: tüm masalar oyun genelinden (120 sn)
    cfg.chess = Object.assign({}, cfg.chess, { moveSeconds: 120 });
    S.applyPresetConfig(cfg);

    assert.strictEqual(oda0.moveLimitMs, 60000, 'oynanan hazır masa 60 sn olmalı');
    assert.strictEqual(oda0.okey.turnDeadlineMs, 60000, 'okey tur sayacı da ANINDA 60 sn olmalı');
    assert.strictEqual(oda1.moveLimitMs, 45000, 'listede olmayan masa oyun genelini (45 sn) almalı');
    const yeniOda = [...S.rooms.values()].find(r => r.gameId === 'okey101' && r.name === 'Yeni Masa');
    assert.ok(yeniOda, 'sonradan eklenen masa açılmalı');
    assert.strictEqual(yeniOda.moveLimitMs, 90000, 'sonradan eklenen masa kendi değeriyle (90 sn) doğmalı');
    const bosSatir = S.rooms.get(String(yeni[2].id));
    assert.strictEqual(bosSatir.moveLimitMs, 45000, 'satırı boş masa oyun genelini almalı');
    const sat = S.rooms.get('101');
    assert.strictEqual(sat.moveLimitMs, 120000, 'satranç masası oyun genelini (120 sn) almalı');

    // 4) Genel değer kaldırılınca yerleşik varsayılana dönülmeli
    cfg.okey101.moveSeconds = 0; cfg.chess.moveSeconds = 0;
    S.applyPresetConfig(cfg);
    assert.strictEqual(oda1.moveLimitMs, 30000, 'genel değer boşsa 101 varsayılanı 30 sn');
    assert.strictEqual(oda0.okey.turnDeadlineMs, 60000, 'satır değeri korunmalı');
    assert.strictEqual(sat.moveLimitMs, 60000, 'satranç varsayılanı 60 sn');

    // normPresetConfig oyun geneli alanı korumalı
    assert.strictEqual(S.normPresetConfig({ okey101: { moveSeconds: 75 } }).okey101.moveSeconds, 75);

    // 5) games-meta
    const meta = await fetch(`http://127.0.0.1:${port}/api/games-meta`).then(r => r.json());
    assert.strictEqual(meta.ayarSenkron, true, 'yerel modda ayar senkron sayılmalı');
    console.log('✅ hamle-suresi-canli: tüm masalarda anlık hamle süresi doğrulandı');
  } finally {
    S.io.close(); S.server.close();
    setTimeout(() => process.exit(process.exitCode || 0), 200);
  }
})().catch(e => { console.error('❌', e); process.exit(1); });
