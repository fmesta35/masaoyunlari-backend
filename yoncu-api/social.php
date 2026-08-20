<?php
/*
 * GameVerse — Sosyal API (Yöncü / MySQL):
 *    GET  ?action=profile&id=N            → {ok,user,stats,recent}   (herkese açık)
 *    GET  ?action=search&q=               → {ok,users[]}             (Bearer zorunlu)
 *    GET  ?action=userPublic&id=N         → {ok,user:{id,name}}      (herkese açık)
 *    GET  ?action=friends                 → {ok,friends[]}           (Bearer)
 *    POST ?action=friendAdd   {friendId}  → {ok,friends[]}           (Bearer)
 *    POST ?action=friendRemove{friendId}  → {ok,friends[]}           (Bearer)
 *    GET  ?action=isFriendPair&a&b        → {ok,friend:bool}         (X-GV-Key: Render)
 *    POST ?action=recordMatch {...}       → {ok}                     (X-GV-Key: Render)
 *    POST ?action=chatLog {...}           → {ok}                     (X-GV-Key: Render)
 *    GET  ?action=chatHistory&scope&roomId→ {ok,messages[]}          (herkese açık)
 *
 *  Çevrimiçi/çevrimdışı bilgisi Render'da tutulur (socket); buradaki
 *  "friends" yanıtı online bayrağı OLMADAN döner — bayrağı Render ekler.
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
        'online' => false, // Render soket katmanı gerçek bayrağı ekler (proxy modunda)
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

if ($action === 'friendAdd') {
    $u = gv_require_user();
    $fid = intval($in['friendId'] ?? 0);
    $pdo = gv_pdo();
    $s = $pdo->prepare("SELECT id FROM gv_users WHERE id = ?");
    $s->execute(array($fid));
    if (!$s->fetch()) gv_json(array('ok' => false, 'error' => 'Oyuncu bulunamadı.'), 404);
    if ($fid === intval($u['id'])) gv_json(array('ok' => false, 'error' => 'Kendinizi ekleyemezsiniz.'), 400);
    $pdo->prepare("INSERT IGNORE INTO gv_friends(user_id,friend_id,created_at) VALUES(?,?,?)")
        ->execute(array($u['id'], $fid, $now));
    gv_json(array('ok' => true, 'friends' => gv_friends_of($pdo, intval($u['id']))));
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
