<?php
session_start(); // Oturumu başlat (Kritik)
header('Content-Type: application/json; charset=utf-8'); // JSON çıktısı bildirimi

require_once 'db.php';

$action = $_GET['action'] ?? '';

// JSON verilerini veya varsayılan POST verilerini al
$rawInput = file_get_contents('php://input'); // php://input düzeltildi
$input = json_decode($rawInput, true) ?? $_POST;

// Otomatik Ziyaretçi Kimliği Oluştur
if (!isset($_SESSION['user_id'])) {
    $guestName = 'Ziyaretçi#' . rand(1000, 9999);
    $stmt = $pdo->prepare("INSERT INTO users (username, is_guest) VALUES (?, 1)");
    $stmt->execute([$guestName]);
    $_SESSION['user_id'] = $pdo->lastInsertId();
    $_SESSION['username'] = $guestName;
    $_SESSION['is_guest'] = 1;
}

$userId = $_SESSION['user_id'];
$username = $_SESSION['username'];
$isGuest = $_SESSION['is_guest'];

// --- API UÇ NOKTALARI ---

if ($action === 'get_user_info') {
    $stmt = $pdo->prepare("SELECT id, username, score, is_guest FROM users WHERE id = ?");
    $stmt->execute([$userId]);
    $u = $stmt->fetch(PDO::FETCH_ASSOC);
    echo json_encode(['success' => true, 'user' => $u]);
    exit;
}

if ($action === 'get_rooms') {
    $gameId = $_GET['game_id'] ?? 'billiards';
    $stmt = $pdo->prepare("SELECT * FROM rooms WHERE game_id = ? AND status != 'finished' ORDER BY id DESC");
    $stmt->execute([$gameId]);
    echo json_encode(['success' => true, 'rooms' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
    exit;
}

if ($action === 'create_room') {
    if ($isGuest) {
        echo json_encode(['success' => false, 'is_guest_error' => true, 'message' => 'Masa kurmak için kayıt olmalısınız!']);
        exit;
    }
    
    $gameId = $input['game_id'] ?? 'billiards';
    $roomName = trim($input['room_name'] ?? 'Yeni Masa');
    $maxP = intval($input['max_players'] ?? 2);
    $isPrivate = intval($input['is_private'] ?? 0);

    $stmt = $pdo->prepare("INSERT INTO rooms (game_id, room_name, max_players, current_players, is_private, created_by) VALUES (?, ?, ?, 1, ?, ?)");
    $stmt->execute([$gameId, $roomName, $maxP, $isPrivate, $userId]);
    $roomId = $pdo->lastInsertId();

    // Kurucuyu 0. koltuğa oturt
    $stmtPlayer = $pdo->prepare("INSERT INTO room_players (room_id, user_id, seat_index) VALUES (?, ?, 0)");
    $stmtPlayer->execute([$roomId, $userId]);

    echo json_encode(['success' => true, 'room_id' => $roomId]);
    exit;
}

if ($action === 'quick_match') {
    $gameId = $_GET['game_id'] ?? 'billiards';

    // 1. Bekleyen, dolmamış ve herkese açık masa ara
    $stmt = $pdo->prepare("SELECT id, max_players, current_players FROM rooms WHERE game_id = ? AND status = 'waiting' AND is_private = 0 AND current_players < max_players ORDER BY id ASC LIMIT 1");
    $stmt->execute([$gameId]);
    $room = $stmt->fetch(PDO::FETCH_ASSOC);

    if ($room) {
        $roomId = $room['id'];
        // Koltuk bul
        $stmtSeats = $pdo->prepare("SELECT seat_index FROM room_players WHERE room_id = ?");
        $stmtSeats->execute([$roomId]);
        $takenSeats = $stmtSeats->fetchAll(PDO::FETCH_COLUMN);

        $emptySeat = 0;
        for ($i = 0; $i < $room['max_players']; $i++) {
            if (!in_array($i, $takenSeats)) { $emptySeat = $i; break; }
        }

        $stmtJoin = $pdo->prepare("INSERT INTO room_players (room_id, user_id, seat_index) VALUES (?, ?, ?)");
        $stmtJoin->execute([$roomId, $userId, $emptySeat]);

        $pdo->prepare("UPDATE rooms SET current_players = current_players + 1 WHERE id = ?")->execute([$roomId]);

        echo json_encode(['success' => true, 'room_id' => $roomId]);
    } else {
        // Boş masa yoksa
        if ($isGuest) {
            echo json_encode(['success' => false, 'message' => 'Eşleşilecek boş masa bulunamadı. Masa açmak için giriş yapın!']);
            exit;
        }

        $stmtNew = $pdo->prepare("INSERT INTO rooms (game_id, room_name, max_players, current_players, created_by) VALUES (?, ?, 2, 1, ?)");
        $stmtNew->execute([$gameId, 'Hızlı Eşleşme Masası', $userId]);
        $newRoomId = $pdo->lastInsertId();

        $pdo->prepare("INSERT INTO room_players (room_id, user_id, seat_index) VALUES (?, ?, 0)")->execute([$newRoomId, $userId]);

        echo json_encode(['success' => true, 'room_id' => $newRoomId]);
    }
    exit;
}

if ($action === 'poll_room') {
    $roomId = intval($_GET['room_id'] ?? 0);

    // Oda Detayı
    $stmtR = $pdo->prepare("SELECT * FROM rooms WHERE id = ?");
    $stmtR->execute([$roomId]);
    $room = $stmtR->fetch(PDO::FETCH_ASSOC);

    // Oyuncular
    $stmtP = $pdo->prepare("SELECT rp.seat_index, rp.is_ready, u.id as user_id, u.username FROM room_players rp JOIN users u ON rp.user_id = u.id WHERE rp.room_id = ?");
    $stmtP->execute([$roomId]);
    $players = $stmtP->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode(['success' => true, 'room' => $room, 'players' => $players, 'my_id' => $userId]);
    exit;
}

if ($action === 'toggle_ready') {
    $roomId = intval($input['room_id'] ?? 0);
    $pdo->prepare("UPDATE room_players SET is_ready = NOT is_ready WHERE room_id = ? AND user_id = ?")->execute([$roomId, $userId]);
    echo json_encode(['success' => true]);
    exit;
}

if ($action === 'send_chat') {
    if ($isGuest) {
        echo json_encode(['success' => false, 'is_guest_error' => true, 'message' => 'Sohbet etmek için giriş yapmalısınız!']);
        exit;
    }
    $roomId = isset($input['room_id']) ? intval($input['room_id']) : null;
    $msg = trim($input['message'] ?? '');

    if ($msg !== '') {
        $stmt = $pdo->prepare("INSERT INTO chats (room_id, username, message) VALUES (?, ?, ?)");
        $stmt->execute([$roomId, $username, $msg]);
    }
    echo json_encode(['success' => true]);
    exit;
}

if ($action === 'get_chat') {
    $roomId = isset($_GET['room_id']) ? intval($_GET['room_id']) : null;
    if ($roomId === null) {
        $stmt = $pdo->prepare("SELECT * FROM chats WHERE room_id IS NULL ORDER BY id DESC LIMIT 20");
        $stmt->execute();
    } else {
        $stmt = $pdo->prepare("SELECT * FROM chats WHERE room_id = ? ORDER BY id DESC LIMIT 20");
        $stmt->execute([$roomId]);
    }
    echo json_encode(['success' => true, 'messages' => array_reverse($stmt->fetchAll(PDO::FETCH_ASSOC))]);
    exit;
}