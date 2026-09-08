<?php
/*
 * GameVerse — Yönetici (Kurucu) Paneli API'si (Yöncü)
 *
 *  Kurucu Paneli yalnız GV_ADMIN_EMAIL hesabının oturumunda çalışır.
 *  Hesap YOKSA ilk istekte otomatik oluşturulur (onaylı, şifre: kurucu123)
 *  → kurucu@kurucu.com / kurucu123 ile giriş yapılır, panel açılır.
 *
 *  Uçlar (tarayıcıdan, Bearer oturumuyla):
 *    GET  ?action=users        → {ok, users:[{id,name,email,createdAt,role}]}
 *    GET  ?action=gamesGet     → {ok, settings:{...}}  (X-GV-Key ile de: Render)
 *    POST ?action=gamesSave    {games:{...}}           → {ok}
 *
 *  gamesGet'e X-GV-Key ile gelen çağrılar Render'ın sunucu-sunucu
 *  doğrulamasıdır (Render açılışta ayarları buradan çeker; DDoS koruması
 *  engelliyorsa Render varsayılanlarla çalışır ve kurucunun panel
 *  kaydı/canlı uygulamasıyla senkron kalır).
 */
require_once __DIR__ . '/bootstrap.php';

$now = round(microtime(true) * 1000);
$action = $_GET['action'] ?? '';

// gv_admin_email() ve gv_ensure_admin() bootstrap.php'dedir (paylaşımlı
// yardımcı; auth.php de her kimlik çağrısında çağırır).

function gv_server_key_ok() {
    $k = isset($_SERVER['HTTP_X_GV_KEY']) ? strval($_SERVER['HTTP_X_GV_KEY']) : '';
    return $k !== '' && hash_equals(strval(GV_SERVER_KEY), $k);
}

// Yönetici oturumu şart: Bearer jetonu GV_ADMIN_EMAIL hesabına ait olmalı.
function gv_require_admin() {
    $pdo = gv_pdo();
    $u = gv_user_by_token(gv_bearer());
    if (!gv_is_founder($u)) {
        gv_json(array('ok' => false, 'error' => 'Yönetici yetkisi gerekli.'), 403);
    }
    return $u;
}

$pdo = gv_pdo();
gv_ensure_admin($pdo, $now);

if ($action === 'users') {
    gv_require_admin();
    $rows = $pdo->query("SELECT id, name, email, created_at, is_founder FROM gv_users ORDER BY created_at ASC, id ASC LIMIT 500")
        ->fetchAll(PDO::FETCH_ASSOC);
    $out = array_map(function ($r) {
        return array(
            'id' => intval($r['id']),
            'name' => strval($r['name']),
            'email' => strval($r['email']),
            'createdAt' => intval($r['created_at']),
            'role' => gv_is_founder($r) ? 'kurucu' : 'uye'
        );
    }, $rows);
    gv_json(array('ok' => true, 'users' => $out));
}

if ($action === 'gamesGet') {
    // Render (X-GV-Key) veya kurucu oturumu:
    if (!gv_server_key_ok()) gv_require_admin();
    $s = $pdo->prepare("SELECT value FROM gv_settings WHERE skey = 'table_settings'");
    $s->execute();
    $row = $s->fetch(PDO::FETCH_ASSOC);
    $settings = null;
    if ($row && $row['value'] !== null && $row['value'] !== '') {
        $d = json_decode(strval($row['value']), true);
        $settings = is_array($d) ? $d : null;
    }
    gv_json(array('ok' => true, 'settings' => $settings));
}

if ($action === 'gamesSave') {
    gv_require_admin();
    $in = gv_input();
    $settings = is_array($in['games'] ?? null) ? $in['games']
        : (is_array($in['settings'] ?? null) ? $in['settings'] : null);
    if ($settings === null) gv_json(array('ok' => false, 'error' => 'games alanı gerekli.'), 400);
    $json = json_encode($settings, JSON_UNESCAPED_UNICODE);
    if ($json === false) gv_json(array('ok' => false, 'error' => 'Ayarlar kodlanamadı.'), 400);
    $pdo->prepare("INSERT INTO gv_settings(skey, value, updated_at) VALUES('table_settings', ?, ?)
                   ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = VALUES(updated_at)")
        ->execute(array($json, $now));
    gv_json(array('ok' => true));
}

// Kurucu Paneli / Ana sayfa — üye + maç istatistikleri (MySQL'den).
// Online/aktif-oyun/devam-eden maçı Render canlı durumdan verir; istemci
// iki kaynağı birleştirir (bkz. js/admin-panel.js refreshHeroStats).
if ($action === 'stats') {
    gv_require_admin();
    $DAY = 86400000; $WEEK = 7 * $DAY; $MONTH = 30 * $DAY;
    $totalUsers = intval($pdo->query("SELECT COUNT(*) c FROM gv_users")->fetchColumn());
    $cnt = function ($ms) use ($pdo, $now) {
        $s = $pdo->prepare("SELECT COUNT(*) c FROM gv_users WHERE created_at >= ?");
        $s->execute(array($now - $ms));
        return intval($s->fetchColumn());
    };
    $newUsersToday = $cnt($DAY);
    $newUsersWeek = $cnt($WEEK);
    $newUsersMonth = $cnt($MONTH);
    $totalMatches = intval($pdo->query("SELECT COUNT(*) c FROM gv_matches")->fetchColumn());
    // 7 günde en az 1 maçı olan AYRIK üye (son 500 maç oyuncular JSON'u):
    $activeUsers = 0;
    $recent = $pdo->prepare("SELECT players FROM gv_matches WHERE ts >= ? ORDER BY ts DESC LIMIT 500");
    $recent->execute(array($now - $WEEK));
    $seen = array();
    foreach ($recent->fetchAll(PDO::FETCH_ASSOC) as $m) {
        $pl = json_decode(strval($m['players']), true);
        if (is_array($pl)) foreach ($pl as $p) {
            if (isset($p['id']) && $p['id'] !== null) $seen[intval($p['id'])] = 1;
        }
    }
    $activeUsers = count($seen);
    gv_json(array('ok' => true, 'stats' => array(
        'totalUsers' => $totalUsers,
        'newUsersToday' => $newUsersToday,
        'newUsersWeek' => $newUsersWeek,
        'newUsersMonth' => $newUsersMonth,
        'activeUsers' => $activeUsers,
        'totalMatches' => $totalMatches,
        'completedMatches' => $totalMatches,
    )));
}

gv_json(array('ok' => false, 'error' => 'Bilinmeyen işlem.'), 404);
