<?php
/*
 * GameVerse — Yöncü PHP API ortak katmanı
 *  - PDO/MySQL bağlantısı (config.php)
 *  - Tablolar yoksa OTOMATIK kurulur (phpMyAdmin'e elle SQL girmeye gerek yok)
 *  - JSON giriş/çıkış yardımcıları, oturum (token) doğrulama
 */

require_once __DIR__ . '/config.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-GV-Key');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }

function gv_json($data, $code = 200) {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function gv_input() {
    $raw = file_get_contents('php://input');
    $d = json_decode($raw ? $raw : '', true);
    if (is_array($d)) return $d;
    return $_POST ? $_POST : array();
}

function gv_bearer() {
    $h = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (function_exists('apache_request_headers')) {
        $all = apache_request_headers();
        if (empty($h) && !empty($all['Authorization'])) $h = $all['Authorization'];
        if (empty($h) && !empty($all['authorization'])) $h = $all['authorization'];
    }
    if (preg_match('/Bearer\s+(.+)/i', $h, $m)) return trim($m[1]);
    return null;
}

// ---------------- Veritabanı ----------------
function gv_pdo() {
    static $pdo = null;
    if ($pdo) return $pdo;
    try {
        $pdo = new PDO(
            'mysql:host=' . GV_DB_HOST . ';dbname=' . GV_DB_NAME . ';charset=utf8mb4',
            GV_DB_USER, GV_DB_PASS,
            array(
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false
            )
        );
    } catch (Exception $e) {
        gv_json(array('ok' => false, 'error' => 'Veritabanına bağlanılamadı (config.php bilgilerini kontrol edin).'), 503);
    }
    gv_schema($pdo);
    return $pdo;
}

function gv_schema($pdo) {
    // İlk istekte otomatik kurulum — tablolar varsa no-op'tur.
    $pdo->exec("CREATE TABLE IF NOT EXISTS gv_users(
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(32) NOT NULL,
        email VARCHAR(190) NOT NULL UNIQUE,
        pass_hash VARCHAR(255) NOT NULL,
        verified TINYINT NOT NULL DEFAULT 0,
        verify_token VARCHAR(96) NULL,
        verify_sent_at BIGINT NULL,
        reset_token VARCHAR(96) NULL,
        reset_expires BIGINT NULL,
        created_at BIGINT NOT NULL,
        INDEX (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci");
    $pdo->exec("CREATE TABLE IF NOT EXISTS gv_sessions(
        token VARCHAR(96) PRIMARY KEY,
        user_id INT NOT NULL,
        created_at BIGINT NOT NULL,
        INDEX (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci");
    $pdo->exec("CREATE TABLE IF NOT EXISTS gv_friends(
        user_id INT NOT NULL,
        friend_id INT NOT NULL,
        created_at BIGINT NOT NULL,
        UNIQUE KEY uk_pair (user_id, friend_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci");
    $pdo->exec("CREATE TABLE IF NOT EXISTS gv_matches(
        id INT AUTO_INCREMENT PRIMARY KEY,
        game_id VARCHAR(32) NOT NULL,
        room_id VARCHAR(32) NULL,
        players TEXT NOT NULL,
        winner VARCHAR(64) NULL,
        reason VARCHAR(40) NULL,
        ts BIGINT NOT NULL,
        INDEX (ts)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci");
    $pdo->exec("CREATE TABLE IF NOT EXISTS gv_chat(
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        scope VARCHAR(8) NOT NULL,
        room_id VARCHAR(32) NULL,
        uid INT NULL,
        name VARCHAR(48) NOT NULL,
        text VARCHAR(300) NOT NULL,
        ts BIGINT NOT NULL,
        INDEX (room_id), INDEX (ts)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci");
}

// ---------------- Üye yardımcıları ----------------
function gv_token() { return bin2hex(random_bytes(24)); }

function gv_user_by_token($token) {
    if (!$token) return null;
    $pdo = gv_pdo();
    $s = $pdo->prepare("SELECT u.id, u.name, u.email, u.verified FROM gv_sessions s JOIN gv_users u ON u.id = s.user_id WHERE s.token = ?");
    $s->execute(array($token));
    $u = $s->fetch();
    return $u ? $u : null;
}

function gv_require_user() {
    $u = gv_user_by_token(gv_bearer());
    if (!$u) gv_json(array('ok' => false, 'error' => 'Giriş gerekli.'), 401);
    return $u;
}

function gv_clean_name($v) {
    $v = preg_replace('/[<>"\'`]/u', '', strval($v));
    $v = preg_replace('/\s+/u', ' ', trim($v));
    if (function_exists('mb_substr')) return mb_substr($v, 0, 24, 'UTF-8');
    return substr($v, 0, 24);
}

function gv_email_ok($e) {
    return (bool)preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/', trim(strval($e)));
}

// Sunucu (Render) anahtarı — yalnız backend'in yazma uçlarında zorunlu.
function gv_require_server_key() {
    $k = $_SERVER['HTTP_X_GV_KEY'] ?? '';
    if (!hash_equals(strval(GV_SERVER_KEY), strval($k))) {
        gv_json(array('ok' => false, 'error' => 'Yetkisiz (sunucu anahtarı).'), 403);
    }
}
