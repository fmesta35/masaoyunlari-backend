<?php
/*
 * GameVerse — Yöncü PHP API ortak katmanı
 *  - PDO/MySQL bağlantısı (config.php)
 *  - Tablolar yoksa OTOMATIK kurulur (phpMyAdmin'e elle SQL girmeye gerek yok)
 *  - JSON giriş/çıkış yardımcıları, oturum (token) doğrulama
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-GV-Key, X-GV-Token');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }

/* ---------------- SUNUCU YAPILANDIRMASI (config.php) ----------------
 * config.php SUNUCUYA ÖZELDİR ve bu depoda BULUNMAZ.
 *
 * SEBEBİ (yaşanmış kaza): depoda "şablon" bir config.php duruyordu.
 * yoncu-api klasörü toptan yüklendiğinde şablon, sunucudaki GERÇEK
 * dosyanın üzerine yazdı; üyelik sistemi "Veritabanına bağlanılamadı"
 * diyerek tamamen durdu. Artık depoda yalnız config.ornek.php var —
 * klasörü toptan yüklemek config.php'ye ARTIK DOKUNAMAZ.
 *
 * Aşağıdaki iki kontrol, sorun yine de olursa "bağlanılamadı" gibi
 * yanıltıcı bir mesaj yerine ne yapılacağını doğrudan söyler. */
function gv_kurulum_hatasi($mesaj) {
    http_response_code(200);   // oPanel hata sayfası JSON'u yutmasın
    echo json_encode(array('ok' => false, 'status' => 503, 'error' => $mesaj), JSON_UNESCAPED_UNICODE);
    exit;
}

$gvCfg = __DIR__ . '/config.php';
if (!is_file($gvCfg)) {
    gv_kurulum_hatasi('Sunucu yapılandırması eksik: /api/config.php bulunamadı. '
        . 'Aynı klasördeki config.ornek.php dosyasını config.php adıyla kopyalayıp '
        . 'veritabanı bilgilerini ve GV_SERVER_KEY değerini girin.');
}
require_once $gvCfg;

// Şablon yer tutucularıyla (BURAYA_...) kalmış alan var mı?
$gvEksik = array();
foreach (array('GV_DB_NAME', 'GV_DB_USER', 'GV_DB_PASS', 'GV_SERVER_KEY') as $gvK) {
    if (!defined($gvK) || strpos(strval(constant($gvK)), 'BURAYA_') === 0) $gvEksik[] = $gvK;
}
if ($gvEksik) {
    gv_kurulum_hatasi('config.php doldurulmamış — şu alanlar hâlâ şablon değerinde: '
        . implode(', ', $gvEksik) . '. oPanel > Dosya Yöneticisi > /public_html/api/config.php '
        . 'dosyasını düzenleyip gerçek değerleri yazın. (GV_SERVER_KEY, Render ortam '
        . 'değişkenlerindeki değerle BİREBİR aynı olmalıdır.)');
}

function gv_json($data, $code = 200) {
    // NOT: oPanel gibi hosting panelleri 4xx/5xx yanıt GÖVDELERİNİ kendi hata
    // sayfalarıyla değiştirebiliyor; JSON mesajının istemciye her zaman
    // ulaşması için HTTP kodu 200 tutulur, asıl kod gövdede "status" alanıdır.
    if (!isset($data['status'])) $data['status'] = $code;
    http_response_code(200);
    header('Content-Type: application/json; charset=utf-8');
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
    // Yöncü/cPanel FastCGI kurulumları Authorization başlığını PHP'ye
    // GEÇİRMEYEBİLİR (CGI standardı). O yüzden istemci ve oyun sunucusu aynı
    // jetonu özel X-GV-Token başlığıyla da yollar; zincir tüm yolları dener.
    $h = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if ($h === '' && !empty($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) $h = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
    if ($h === '' && function_exists('getallheaders')) {
        foreach ((array)call_user_func('getallheaders') as $gk => $gvh) {
            if (strcasecmp(strval($gk), 'Authorization') === 0) { $h = strval($gvh); break; }
        }
    }
    if (function_exists('apache_request_headers')) {
        $all = apache_request_headers();
        if (empty($h) && !empty($all['Authorization'])) $h = $all['Authorization'];
        if (empty($h) && !empty($all['authorization'])) $h = $all['authorization'];
    }
    if (preg_match('/Bearer\s+(.+)/i', $h, $m)) return trim($m[1]);
    // Başlığı kırpan kurulumlar için özel yedek başlık (ham jeton):
    if (!empty($_SERVER['HTTP_X_GV_TOKEN'])) return trim(strval($_SERVER['HTTP_X_GV_TOKEN']));
    // Son çare: jeton istek GÖVDESİNDE (JSON {"token":"..."}) ya da query'de
    // gelebilir — oyun sunucusu (Render) me doğrulamasını gövdeyle yollar.
    // Bu yol başlık kırpmasından tümüyle bağımsızdır.
    if (!empty($_GET['token'])) return trim(strval($_GET['token']));
    static $gvBody = null;
    if ($gvBody === null) {
        $gvBody = array();
        $raw = file_get_contents('php://input');
        if ($raw) { $d = json_decode($raw, true); if (is_array($d)) $gvBody = $d; }
    }
    if (!empty($gvBody['token'])) return trim(strval($gvBody['token']));
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
        is_founder TINYINT(1) NOT NULL DEFAULT 0,
        INDEX (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci");
    // Kurucu bayragi: eski kurulumlarda sutun yoktur, bir kez eklenir.
    // (Sutun zaten varsa MySQL hata verir; yutulur — islem tekrarlanabilir.)
    try { $pdo->exec("ALTER TABLE gv_users ADD COLUMN is_founder TINYINT(1) NOT NULL DEFAULT 0"); } catch (Exception $e) {}
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
    $pdo->exec("CREATE TABLE IF NOT EXISTS gv_friend_requests(
        from_id INT NOT NULL,
        to_id INT NOT NULL,
        created_at BIGINT NOT NULL,
        PRIMARY KEY (from_id, to_id),
        INDEX (to_id)
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
    // Yönetici (kurucu) paneli ayarları: hazır masa yapılandırması (JSON).
    $pdo->exec("CREATE TABLE IF NOT EXISTS gv_settings(
        skey VARCHAR(64) PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at BIGINT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci");
}

// ---------------- Üye yardımcıları ----------------
function gv_token() { return bin2hex(random_bytes(24)); }

function gv_user_by_token($token) {
    if (!$token) return null;
    $pdo = gv_pdo();
    $s = $pdo->prepare("SELECT u.id, u.name, u.email, u.verified, u.is_founder FROM gv_sessions s JOIN gv_users u ON u.id = s.user_id WHERE s.token = ?");
    $s->execute(array($token));
    $u = $s->fetch();
    return $u ? $u : null;
}

// ---------------- Yönetici (kurucu) hesabı ----------------
// Kurucu Paneli iki koşuldan BİRİYLE açılır:
//   1) gv_users.is_founder = 1  → hesabı phpMyAdmin'den siz işaretlersiniz
//   2) hesabın e-postası config.php'deki GV_ADMIN_EMAIL ile birebir aynı
//
// ⚠ GÜVENLİK NOTU: Eskiden kurucu@kurucu.com hesabı SABİT "kurucu123"
// şifresiyle kendiliğinden oluşuyordu. Şifre bu depoda açıkça yazdığı için
// siteye dışarıdan kurucu olarak girilebiliyordu. OTOMATİK OLUŞTURMA
// KALDIRILDI: artık kurucu hesabını siz açar, sonra işaretlersiniz:
//   UPDATE gv_users SET is_founder = 1 WHERE email = 'sizin@adresiniz';
//   DELETE FROM gv_users WHERE email = 'kurucu@kurucu.com';
function gv_admin_email() {
    return defined('GV_ADMIN_EMAIL') ? strtolower(trim(strval(GV_ADMIN_EMAIL))) : '';
}

// Bu üye kaydı kurucu mu? (bayrak VEYA GV_ADMIN_EMAIL eşleşmesi)
function gv_is_founder($u) {
    if (!$u) return false;
    if (isset($u['is_founder']) && intval($u['is_founder']) === 1) return true;
    $mail = gv_admin_email();
    if ($mail === '') return false;
    return strtolower(strval(isset($u['email']) ? $u['email'] : '')) === $mail;
}

// Geriye dönük uyumluluk: eskiden kurucu hesabını OLUŞTURAN yardımcı.
// Artık yalnızca GV_ADMIN_EMAIL ile eşleşen MEVCUT hesaba kurucu bayrağını
// işler. Hiçbir koşulda yeni hesap açmaz, hiçbir şifre atamaz.
function gv_ensure_admin($pdo, $now) {
    static $done = false;
    if ($done) return;
    $done = true;
    $mail = gv_admin_email();
    if ($mail === '') return;
    try {
        $pdo->prepare("UPDATE gv_users SET is_founder = 1 WHERE email = ? AND is_founder = 0")
            ->execute(array($mail));
    } catch (Exception $e) {}
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
