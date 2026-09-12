<?php
/*
 * GameVerse — Sosyal API (Yöncü / MySQL):
 *    GET  ?action=profile&id=N            → {ok,user,stats,recent}   (herkese açık)
 *    GET  ?action=search&q=               → {ok,users[]}             (Bearer zorunlu)
 *    GET  ?action=userPublic&id=N         → {ok,user:{id,name}}      (herkese açık)
 *    GET  ?action=friends                 → {ok,friends[]}           (Bearer)
 *    GET  ?action=friendRequests          → {ok,incoming[],outgoing[]} (Bearer)
 *    POST ?action=friendRequest{friendId} → {ok,requested|accepted}  (Bearer)
 *    POST ?action=friendAdd   {friendId}  → (= friendRequest, eski istemciler) (Bearer)
 *    POST ?action=friendAccept{friendId}  → {ok,friends[]}           (Bearer)
 *    POST ?action=friendDecline{friendId} → {ok} (reddet VEYA iptal)  (Bearer)
 *    POST ?action=friendRemove{friendId}  → {ok,friends[]}           (Bearer)
 *    GET  ?action=hasRequest&a&b          → {ok,has:bool}            (X-GV-Key: Render)
 *    GET  ?action=isFriendPair&a&b        → {ok,friend:bool}         (X-GV-Key: Render)
 *    POST ?action=recordMatch {...}       → {ok}                     (X-GV-Key: Render)
 *    POST ?action=chatLog {...}           → {ok}                     (X-GV-Key: Render)
 *    GET  ?action=chatHistory&scope&roomId→ {ok,messages[]}          (herkese açık)
 *
 *  Çevrimiçi/çevrimdışı bilgisi Render'da tutulur (socket); buradaki
 *  "friends" yanıtı online bayrağı OLMADAN döner — bayrağı ISTEMCİ
 *  Render'dan /api/online-status ile alıp birleştirir (DDoS'a dayanıklı yol).
 */

require_once __DIR__ . '/bootstrap.php';

$action = $_GET['action'] ?? '';
$in = gv_input();
$now = round(microtime(true) * 1000);

function gv_friends_of($pdo, $uid) {
    $s = $pdo->prepare("
        SELECT u.id, u.name, f.created_at AS since FROM gv_friends f
        JOIN gv_users u ON u.id = f.friend_id WHERE f.user_id = ?
        UNION
        SELECT u.id, u.name, f.created_at AS since FROM gv_friends f
        JOIN gv_users u ON u.id = f.user_id WHERE f.friend_id = ?
        ORDER BY name");
    $s->execute(array($uid, $uid));
    return array_map(function ($r) {
        return array('id' => intval($r['id']), 'name' => $r['name'], 'since' => intval($r['since']));
    }, $s->fetchAll());
}

if ($action === 'profile') {
    $id = intval($_GET['id'] ?? 0);
    $pdo = gv_pdo();
    $s = $pdo->prepare("SELECT id, name, created_at FROM gv_users WHERE id = ?");
    $s->execute(array($id));
    $u = $s->fetch();
    if (!$u) gv_json(array('ok' => false, 'error' => 'Oyuncu bulunamadı.'), 404);
    $like1 = '%"id":' . $id . ',%';
    $like2 = '%"id":' . $id . '}%' ;
    $s = $pdo->prepare("SELECT game_id, room_id, players, winner, reason, ts FROM gv_matches
                        WHERE players LIKE ? OR players LIKE ? ORDER BY ts DESC LIMIT 20");
    $s->execute(array($like1, $like2));
    $rows = $s->fetchAll();
    $recent = array(); $stats = array();
    foreach ($rows as $r) {
        $players = json_decode($r['players'], true);
        if (!is_array($players)) $players = array();
        $won = false;
        foreach ($players as $p) { if (intval($p['id'] ?? 0) === $id && !empty($p['won'])) { $won = true; break; } }
        $recent[] = array(
            'gameId' => $r['game_id'], 'roomId' => $r['room_id'], 'winner' => $r['winner'],
            'reason' => $r['reason'], 'ts' => intval($r['ts']), 'players' => $players, 'won' => $won
        );
        $g = $r['game_id'];
        if (!isset($stats[$g])) $stats[$g] = array('played' => 0, 'won' => 0);
        $stats[$g]['played']++;
        if ($won) $stats[$g]['won']++;
    }
    gv_json(array(
        'ok' => true,
        'user' => array('id' => intval($u['id']), 'name' => $u['name'], 'createdAt' => intval($u['created_at'])),
        'online' => false, // Istemci Render /api/online-status ile gerçek bayrağı alır
        'stats' => (object)$stats,
        'recent' => $recent
    ));
}

if ($action === 'search') {
    gv_require_user();
    $q = gv_clean_name($_GET['q'] ?? '');
    if (strlen($q) < 2) gv_json(array('ok' => true, 'users' => array()));
    $pdo = gv_pdo();
    $s = $pdo->prepare("SELECT id, name FROM gv_users WHERE verified = 1 AND name LIKE ? COLLATE utf8mb4_general_ci ORDER BY name LIMIT 8");
    $s->execute(array('%' . $q . '%'));
    $users = array_map(function ($r) {
        return array('id' => intval($r['id']), 'name' => $r['name'], 'online' => false);
    }, $s->fetchAll());
    gv_json(array('ok' => true, 'users' => $users));
}

// ---- Arkadaşlık isteği yardımcıları ----
function gv_req_pending($pdo, $a, $b) { // a -> b bekleyen istek var mı?
    $s = $pdo->prepare("SELECT 1 FROM gv_friend_requests WHERE from_id = ? AND to_id = ? LIMIT 1");
    $s->execute(array(intval($a), intval($b)));
    return (bool)$s->fetch();
}
function gv_are_friends($pdo, $a, $b) {
    $s = $pdo->prepare("SELECT 1 FROM gv_friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?) LIMIT 1");
    $s->execute(array(intval($a), intval($b), intval($b), intval($a)));
    return (bool)$s->fetch();
}
function gv_make_friends($pdo, $a, $b, $now) {
    $pdo->prepare("INSERT IGNORE INTO gv_friends(user_id,friend_id,created_at) VALUES(?,?,?)")
        ->execute(array(intval($a), intval($b), $now));
    $pdo->prepare("DELETE FROM gv_friend_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)")
        ->execute(array(intval($a), intval($b), intval($b), intval($a)));
}

if ($action === 'userPublic') {
    $id = intval($_GET['id'] ?? 0);
    $pdo = gv_pdo();
    $s = $pdo->prepare("SELECT id, name FROM gv_users WHERE id = ?");
    $s->execute(array($id));
    $u = $s->fetch();
    if (!$u) gv_json(array('ok' => false, 'error' => 'Oyuncu bulunamadı.'), 404);
    gv_json(array('ok' => true, 'user' => array('id' => intval($u['id']), 'name' => $u['name'])));
}

if ($action === 'friends') {
    $u = gv_require_user();
    $pdo = gv_pdo();
    gv_json(array('ok' => true, 'friends' => gv_friends_of($pdo, intval($u['id']))));
}

if ($action === 'friendRequests') {
    // Bekleyen istekler: gelen (bana) + giden (benim gönderdiklerim)
    $u = gv_require_user();
    $pdo = gv_pdo();
    $s = $pdo->prepare("SELECT u.id, u.name, r.created_at AS since FROM gv_friend_requests r
                        JOIN gv_users u ON u.id = r.from_id WHERE r.to_id = ? ORDER BY r.created_at DESC");
    $s->execute(array(intval($u['id'])));
    $incoming = array_map(function ($r) {
        return array('id' => intval($r['id']), 'name' => $r['name'], 'since' => intval($r['since']));
    }, $s->fetchAll());
    $s = $pdo->prepare("SELECT u.id, u.name, r.created_at AS since FROM gv_friend_requests r
                        JOIN gv_users u ON u.id = r.to_id WHERE r.from_id = ? ORDER BY r.created_at DESC");
    $s->execute(array(intval($u['id'])));
    $outgoing = array_map(function ($r) {
        return array('id' => intval($r['id']), 'name' => $r['name'], 'since' => intval($r['since']));
    }, $s->fetchAll());
    gv_json(array('ok' => true, 'incoming' => $incoming, 'outgoing' => $outgoing));
}

// İstek gönderme — ARTIK DİREKT EKLEME YOK: karşı taraf kabul edince arkadaş olunur.
// (friendAdd eski istemciler için aynı davranışa bağlıdır.)
if ($action === 'friendRequest' || $action === 'friendAdd') {
    $u = gv_require_user();
    $uid = intval($u['id']);
    $fid = intval($in['friendId'] ?? 0);
    $pdo = gv_pdo();
    $s = $pdo->prepare("SELECT id, name FROM gv_users WHERE id = ?");
    $s->execute(array($fid));
    $t = $s->fetch();
    if (!$t) gv_json(array('ok' => false, 'error' => 'Oyuncu bulunamadı.'), 404);
    if ($fid === $uid) gv_json(array('ok' => false, 'error' => 'Kendinize istek gönderemezsiniz.'), 400);
    if (gv_are_friends($pdo, $uid, $fid)) gv_json(array('ok' => false, 'error' => 'Zaten arkadaşsınız. ️'), 409);
    if (gv_req_pending($pdo, $fid, $uid)) {
        // Karşı taraf bana zaten istek göndermiş → ikisi de kabul etmiş sayılır.
        gv_make_friends($pdo, $uid, $fid, $now);
        gv_json(array('ok' => true, 'accepted' => true, 'toName' => $t['name'], 'friends' => gv_friends_of($pdo, $uid)));
    }
    if (gv_req_pending($pdo, $uid, $fid)) gv_json(array('ok' => false, 'error' => 'İstek zaten gönderildi — yanıt bekleniyor.'), 409);
    $pdo->prepare("INSERT IGNORE INTO gv_friend_requests(from_id,to_id,created_at) VALUES(?,?,?)")
        ->execute(array($uid, $fid, $now));
    gv_json(array('ok' => true, 'requested' => true, 'toName' => $t['name']));
}

if ($action === 'friendAccept') {
    // Gelen isteği KABUL: friendId = isteği gönderen kişi
    $u = gv_require_user();
    $uid = intval($u['id']);
    $fid = intval($in['friendId'] ?? 0);
    $pdo = gv_pdo();
    $s = $pdo->prepare("SELECT id, name FROM gv_users WHERE id = ?");
    $s->execute(array($fid));
    $t = $s->fetch();
    if (!$t) gv_json(array('ok' => false, 'error' => 'Oyuncu bulunamadı.'), 404);
    if (!gv_req_pending($pdo, $fid, $uid)) gv_json(array('ok' => false, 'error' => 'Bekleyen istek bulunamadı.'), 404);
    gv_make_friends($pdo, $uid, $fid, $now);
    gv_json(array('ok' => true, 'accepted' => true, 'fromName' => $t['name'], 'friends' => gv_friends_of($pdo, $uid)));
}

if ($action === 'friendDecline') {
    // Gelen isteği REDDET veya kendi gönderdiğin isteği İPTAL ET
    $u = gv_require_user();
    $uid = intval($u['id']);
    $fid = intval($in['friendId'] ?? 0);
    $pdo = gv_pdo();
    if (!gv_req_pending($pdo, $fid, $uid) && !gv_req_pending($pdo, $uid, $fid))
        gv_json(array('ok' => false, 'error' => 'Bekleyen istek bulunamadı.'), 404);
    $pdo->prepare("DELETE FROM gv_friend_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)")
        ->execute(array($uid, $fid, $fid, $uid));
    gv_json(array('ok' => true));
}

if ($action === 'hasRequest') {
    // Render soket katmanı anlık bildirimden önce bekleyen isteği buradan doğrular.
    gv_require_server_key();
    $a = intval($_GET['a'] ?? 0); $b = intval($_GET['b'] ?? 0);
    gv_json(array('ok' => true, 'has' => gv_req_pending(gv_pdo(), $a, $b)));
}

if ($action === 'friendRemove') {
    $u = gv_require_user();
    $fid = intval($in['friendId'] ?? 0);
    $pdo = gv_pdo();
    $pdo->prepare("DELETE FROM gv_friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)")
        ->execute(array($u['id'], $fid, $fid, $u['id']));
    gv_json(array('ok' => true, 'friends' => gv_friends_of($pdo, intval($u['id']))));
}

if ($action === 'isFriendPair') {
    gv_require_server_key();
    $a = intval($_GET['a'] ?? 0); $b = intval($_GET['b'] ?? 0);
    $pdo = gv_pdo();
    $s = $pdo->prepare("SELECT 1 FROM gv_friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?) LIMIT 1");
    $s->execute(array($a, $b, $b, $a));
    gv_json(array('ok' => true, 'friend' => (bool)$s->fetch()));
}

// Kısa ömürlü "arkadaşız" belgesi (HMAC-SHA256, GV_SERVER_KEY): üye kendi
// Bearer oturumuyla çalar; Render davet anında imzayı yerinde doğrular —
// DDoS koruması Render→PHP yolunu kapattığı için arkadaşlık kuralı yine
// SUNUCU tarafında zorunlu kalır (istemci kanıtı sahtesizdir).
// Çıktı: {ok, proof:{a,kurucuId, b,hedefId, ts, exp, sig}}
if ($action === 'friendProof') {
    $u = gv_user_by_token(gv_bearer());
    if (!$u) gv_json(array('ok' => false, 'error' => 'Oturum geçersiz.'), 401);
    $a = intval($u['id']);
    $b = intval($in['friendId'] ?? 0);
    if ($b <= 0 || $b === $a) gv_json(array('ok' => false, 'error' => 'Geçersiz hedef.'), 400);
    $pdo = gv_pdo();
    $s = $pdo->prepare("SELECT 1 FROM gv_friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?) LIMIT 1");
    $s->execute(array($a, $b, $b, $a));
    if (!$s->fetch()) gv_json(array('ok' => false, 'error' => 'Bu oyuncu arkadaş listenizde değil.'), 403);
    $ts  = $now;
    $exp = $now + 10 * 60 * 1000; // 10 dk
    $sig = hash_hmac('sha256', 'friend|' . $a . '|' . $b . '|' . $ts . '|' . $exp, GV_SERVER_KEY);
    gv_json(array('ok' => true, 'proof' => array('a' => $a, 'b' => $b, 'ts' => $ts, 'exp' => $exp, 'sig' => $sig)));
}

if ($action === 'recordMatch') {
    gv_require_server_key();
    $players = $in['players'] ?? array();
    if (!is_array($players) || !count($players)) gv_json(array('ok' => true)); // kayıt edilecek üye yok
    $hasMember = false;
    foreach ($players as $p) { if (($p['id'] ?? null) !== null) { $hasMember = true; break; } }
    if (!$hasMember) gv_json(array('ok' => true)); // tamamı misafirse kaydetme
    $pdo = gv_pdo();
    $pdo->prepare("INSERT INTO gv_matches(game_id,room_id,players,winner,reason,ts) VALUES(?,?,?,?,?,?)")
        ->execute(array(
            strval($in['gameId'] ?? ''), strval($in['roomId'] ?? ''),
            json_encode($players, JSON_UNESCAPED_UNICODE),
            ($in['winnerName'] ?? null) !== null ? strval($in['winnerName']) : null,
            isset($in['reason']) ? strval($in['reason']) : null, $now
        ));
    gv_json(array('ok' => true));
}

/* ==========================================================================
 * PUAN SİSTEMİ (kalıcılık)
 * --------------------------------------------------------------------------
 * Kurallar Render tarafındadır (scoring.js); burada YALNIZ kayıt ve
 * toplama yapılır. Tüm uçlar sunucu anahtarıyla korunur — tarayıcı
 * doğrudan puan yazamaz (hile önleme).
 * ========================================================================== */

/* Render maç bitişinde/terkte puan olaylarını toplu gönderir. */
if ($action === 'scoreWrite') {
    gv_require_server_key();
    $olaylar = $in['olaylar'] ?? array();
    if (!is_array($olaylar) || !count($olaylar)) gv_json(array('ok' => true));
    $pdo = gv_pdo();
    $st = $pdo->prepare("INSERT INTO gv_score_events(user_id,game_id,kind,points,room_id,ts) VALUES(?,?,?,?,?,?)");
    $pdo->beginTransaction();
    try {
        foreach ($olaylar as $o) {
            $uid = intval($o['uid'] ?? 0);
            if ($uid <= 0) continue;                       // misafir: puan yok
            $st->execute(array($uid, strval($o['gameId'] ?? ''), strval($o['tur'] ?? ''),
                intval($o['puan'] ?? 0), strval($o['roomId'] ?? ''), $now));
        }
        $pdo->commit();
    } catch (Exception $e) {
        $pdo->rollBack();
        gv_json(array('ok' => false, 'error' => 'puan yazılamadı'));
    }
    gv_json(array('ok' => true));
}

/* Bir üyenin puan özeti — OYUN TÜRÜNE GÖRE AYRI. */
if ($action === 'scoreSummary') {
    gv_require_server_key();
    $uid = intval($_GET['uid'] ?? 0);
    if ($uid <= 0) gv_json(array('ok' => false, 'error' => 'uid yok'));
    $pdo = gv_pdo();
    $t0 = gv_score_reset_at();
    $st = $pdo->prepare("SELECT game_id, kind, COUNT(*) adet, SUM(points) puan
                           FROM gv_score_events WHERE user_id = ? AND ts >= ?
                          GROUP BY game_id, kind");
    $st->execute(array($uid, $t0));
    $harita = array();
    foreach ($st->fetchAll() as $r) {
        $g = $r['game_id'];
        if (!isset($harita[$g])) {
            $harita[$g] = array('gameId' => $g, 'puan' => 0, 'mac' => 0, 'galibiyet' => 0,
                                'beraberlik' => 0, 'maglubiyet' => 0, 'terk' => 0, 'donus' => 0);
        }
        $adet = intval($r['adet']);
        $harita[$g]['puan'] += intval($r['puan']);
        $k = $r['kind'];
        if ($k === 'win' || $k === 'win_left') { $harita[$g]['galibiyet'] += $adet; $harita[$g]['mac'] += $adet; }
        elseif ($k === 'draw') { $harita[$g]['beraberlik'] += $adet; $harita[$g]['mac'] += $adet; }
        elseif ($k === 'loss' || $k === 'timeout') { $harita[$g]['maglubiyet'] += $adet; $harita[$g]['mac'] += $adet; }
        elseif ($k === 'leave') $harita[$g]['terk'] += $adet;
        elseif ($k === 'rejoin') $harita[$g]['donus'] += $adet;
    }
    $oyunlar = array_values($harita);
    usort($oyunlar, function ($a, $b) { return $b['puan'] - $a['puan']; });
    $toplam = 0;
    $genel = array('mac' => 0, 'galibiyet' => 0, 'beraberlik' => 0, 'maglubiyet' => 0, 'terk' => 0);
    foreach ($oyunlar as $g) {
        $toplam += $g['puan'];
        $genel['mac'] += $g['mac']; $genel['galibiyet'] += $g['galibiyet'];
        $genel['beraberlik'] += $g['beraberlik']; $genel['maglubiyet'] += $g['maglubiyet'];
        $genel['terk'] += $g['terk'];
    }
    // TABAN: toplam puan eksiye düşmez (tek tek olaylar eksi kalabilir).
    gv_json(array('ok' => true, 'ozet' => array(
        'toplam' => max(0, $toplam), 'oyunlar' => $oyunlar, 'genel' => $genel, 'sifirlandi' => $t0)));
}

/* Sıralama tablosu. */
if ($action === 'scoreBoard') {
    gv_require_server_key();
    $limit = max(1, min(100, intval($_GET['limit'] ?? 20)));
    $game = isset($_GET['game']) && $_GET['game'] !== '' ? strval($_GET['game']) : null;
    $pdo = gv_pdo();
    $t0 = gv_score_reset_at();
    if ($game !== null) {
        $st = $pdo->prepare("SELECT u.id, u.name, SUM(e.points) puan
                               FROM gv_score_events e JOIN gv_users u ON u.id = e.user_id
                              WHERE e.ts >= ? AND e.game_id = ?
                              GROUP BY u.id, u.name ORDER BY puan DESC LIMIT " . $limit);
        $st->execute(array($t0, $game));
    } else {
        $st = $pdo->prepare("SELECT u.id, u.name, SUM(e.points) puan
                               FROM gv_score_events e JOIN gv_users u ON u.id = e.user_id
                              WHERE e.ts >= ?
                              GROUP BY u.id, u.name ORDER BY puan DESC LIMIT " . $limit);
        $st->execute(array($t0));
    }
    $out = array();
    foreach ($st->fetchAll() as $r) {
        $out[] = array('id' => intval($r['id']), 'name' => $r['name'], 'puan' => max(0, intval($r['puan'])));
    }
    gv_json(array('ok' => true, 'siralama' => $out));
}

/* Kurucu: sıfırla. Veri SİLİNMEZ — yeni sıfırlama noktası işaretlenir. */
if ($action === 'scoreReset') {
    gv_require_server_key();
    $pdo = gv_pdo();
    $pdo->prepare("INSERT INTO gv_score_resets(ts,by_user,mode) VALUES(?,?,?)")
        ->execute(array($now, isset($in['by']) ? intval($in['by']) : null,
                        strval($in['mode'] ?? 'manuel')));
    gv_json(array('ok' => true, 'ts' => $now));
}

/* Kurucu: otomatik sıfırlama periyodu (oku/yaz). */
if ($action === 'scoreSettings') {
    gv_require_server_key();
    $pdo = gv_pdo();
    if (isset($in['periyot'])) {
        $p = strval($in['periyot']);
        $izin = array('kapali', 'haftalik', 'aylik', 'ceyrek', 'yarim', 'yillik');
        if (!in_array($p, $izin, true)) gv_json(array('ok' => false, 'error' => 'Geçersiz periyot.'));
        $pdo->prepare("INSERT INTO gv_settings(skey,value,updated_at) VALUES('score_reset_period',?,?)
                       ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = VALUES(updated_at)")
            ->execute(array($p, $now));
        gv_json(array('ok' => true, 'periyot' => $p));
    }
    $r = $pdo->query("SELECT value FROM gv_settings WHERE skey = 'score_reset_period'")->fetch();
    gv_json(array('ok' => true, 'periyot' => $r ? strval($r['value']) : 'kapali',
                  'sonSifirlama' => gv_score_reset_at()));
}

if ($action === 'chatLog') {
    gv_require_server_key();
    $scope = ($in['scope'] ?? 'room') === 'global' ? 'global' : 'room';
    $text = trim(strval($in['text'] ?? ''));
    if ($text === '') gv_json(array('ok' => false, 'error' => 'boş mesaj'));
    if (function_exists('mb_substr')) $text = mb_substr($text, 0, 240, 'UTF-8'); else $text = substr($text, 0, 240);
    $pdo = gv_pdo();
    $pdo->prepare("INSERT INTO gv_chat(scope,room_id,uid,name,text,ts) VALUES(?,?,?,?,?,?)")
        ->execute(array($scope, strval($in['roomId'] ?? ''), ($in['uid'] ?? null) !== null ? intval($in['uid']) : null,
            gv_clean_name($in['name'] ?? 'Oyuncu'), $text, $now));
    gv_json(array('ok' => true));
}

if ($action === 'chatHistory') {
    $scope = ($_GET['scope'] ?? 'room') === 'global' ? 'global' : 'room';
    $roomId = strval($_GET['roomId'] ?? '');
    $pdo = gv_pdo();
    if ($scope === 'global') {
        $s = $pdo->prepare("SELECT id, name, text, ts, uid, scope, room_id FROM gv_chat WHERE scope='global' ORDER BY id DESC LIMIT 100");
        $s->execute();
    } else {
        $s = $pdo->prepare("SELECT id, name, text, ts, uid, scope, room_id FROM gv_chat WHERE scope='room' AND room_id = ? ORDER BY id DESC LIMIT 100");
        $s->execute(array($roomId));
    }
    $rows = array_reverse($s->fetchAll());
    $messages = array_map(function ($r) {
        return array(
            'id' => 'db-' . $r['id'], 'scope' => $r['scope'], 'roomId' => $r['room_id'],
            'uid' => $r['uid'] !== null ? intval($r['uid']) : null,
            'name' => $r['name'], 'text' => $r['text'], 'ts' => intval($r['ts'])
        );
    }, $rows);
    gv_json(array('ok' => true, 'messages' => $messages));
}

gv_json(array('ok' => false, 'error' => 'Bilinmeyen işlem.'), 404);
