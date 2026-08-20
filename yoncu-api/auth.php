<?php
/*
 * GameVerse — Üyelik API'si (Yöncü / MySQL kalıcı kayıt + PHP mail())
 *  Node tarafındaki /api/auth/* uçlarıyla BİREBİR aynı sözleşme:
 *    POST ?action=register   {name,email,password}         → {ok,userId,mailSent,message}
 *    POST ?action=verify     {token}                       → {ok[,error]}
 *    GET  ?action=verify&token=... (mail linki HTML sayfası)
 *    POST ?action=login      {email,password}              → {ok,token,user} / 403 {needVerify}
 *    POST ?action=resend     {email}                       → {ok[,mailSent]} (429: 1 dk sınır)
 *    POST ?action=forgot     {email}                       → {ok,message} (enumeration yok)
 *    POST ?action=reset      {token,password}              → {ok,message}
 *    GET  ?action=me         (Bearer)                      → {ok,user} / 401
 *    POST ?action=logout     (Bearer)                      → {ok}
 *    GET  ?action=mail-status                              → {configured,lastError}
 *    GET  ?action=selftest                                  → tablo/mail adım adım teşhis
 */

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/mailer.inc.php';

$action = $_GET['action'] ?? '';

// En hafif nabız: DB'ye hiç dokunmaz. 503 ise PHP bile çalışmıyor demektir;
// ok:true gelirse sorun yalnızca config.php/MySQL ayarındadır.
if ($action === 'ping') {
    gv_json(array('ok' => true, 'php' => PHP_VERSION, 'time' => time()));
}

$in = gv_input();
$now = round(microtime(true) * 1000);

function gv_user_public($u) { return array('id' => intval($u['id']), 'name' => $u['name'], 'email' => $u['email']); }

if ($action === 'register') {
    $name = gv_clean_name($in['name'] ?? '');
    $email = strtolower(trim(strval($in['email'] ?? '')));
    $password = strval($in['password'] ?? '');
    if (strlen($name) < 2) gv_json(array('ok' => false, 'error' => 'Kullanıcı adı en az 2 karakter olmalı.'), 400);
    if (!gv_email_ok($email)) gv_json(array('ok' => false, 'error' => 'Geçerli bir e-posta adresi girin.'), 400);
    if (strlen($password) < 6) gv_json(array('ok' => false, 'error' => 'Şifre en az 6 karakter olmalı.'), 400);
    $pdo = gv_pdo();
    $s = $pdo->prepare("SELECT id FROM gv_users WHERE name = ? COLLATE utf8mb4_general_ci");
    $s->execute(array($name));
    if ($s->fetch()) gv_json(array('ok' => false, 'error' => 'Bu kullanıcı adı alınmış.'), 409);
    $s = $pdo->prepare("SELECT id FROM gv_users WHERE email = ?");
    $s->execute(array($email));
    if ($s->fetch()) gv_json(array('ok' => false, 'error' => 'Bu e-posta ile zaten bir hesap var. Giriş yapmayı deneyin.'), 409);
    $token = gv_token();
    $hash = password_hash($password, PASSWORD_DEFAULT);
    $pdo->prepare("INSERT INTO gv_users(name,email,pass_hash,verified,verify_token,verify_sent_at,created_at) VALUES(?,?,?,0,?,?,?)")
        ->execute(array($name, $email, $hash, $token, $now, $now));
    $id = intval($pdo->lastInsertId());
    $sent = gv_send_verify_mail($email, $name, $token);
    gv_json(array(
        'ok' => true, 'userId' => $id, 'mailSent' => (bool)$sent,
        'message' => $sent
            ? 'Onay bağlantısı e-postanıza gönderildi. Onaylamadan giriş yapamazsınız.'
            : 'Onay e-postası GÖNDERİLEMEDİ — "Tekrar Gönder" ile yeniden deneyin.'
    ));
}

if ($action === 'verify') {
    $token = strval($in['token'] ?? ($_GET['token'] ?? ''));
    $pdo = gv_pdo();
    $ok = false; $err = '';
    if ($token !== '') {
        $s = $pdo->prepare("SELECT id FROM gv_users WHERE verify_token = ?");
        $s->execute(array($token));
        $row = $s->fetch();
        if ($row) {
            $pdo->prepare("UPDATE gv_users SET verified = 1, verify_token = NULL WHERE id = ?")->execute(array($row['id']));
            $ok = true;
        } else $err = 'Bağlantı geçersiz veya zaten kullanılmış.';
    } else $err = 'Geçersiz onay bağlantısı.';
    if (($_GET['format'] ?? '') === 'html' || ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($_GET['token']))) {
        header('Content-Type: text/html; charset=utf-8');
        $site = GV_SITE_URL;
        $icon = $ok ? '✅' : '⚠️';
        $title = $ok ? 'Üyeliğiniz onaylandı!' : 'Onay yapılamadı';
        $desc = $ok ? 'Artık giriş yapabilirsiniz. 5 sn içinde siteye yönlendiriliyorsunuz...' : $err;
        echo "<!DOCTYPE html><html lang=\"tr\"><head><meta charset=\"utf-8\"><title>GameVerse Üyelik Onayı</title>"
           . "<meta http-equiv=\"refresh\" content=\"5;url=$site\"></head>"
           . "<body style=\"font-family:Arial;background:#0d0d22;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center\">"
           . "<div style=\"background:#12122b;padding:34px;border-radius:16px;text-align:center;max-width:420px\">"
           . "<div style=\"font-size:2.4em\">$icon</div><h2>$title</h2><p style=\"color:#c6c9db\">" . gv_esc($desc) . "</p>"
           . "<p><a style=\"color:#8f7bff\" href=\"$site\">🎮 GameVerse'e git</a></p></div></body></html>";
        exit;
    }
    gv_json($ok ? array('ok' => true) : array('ok' => false, 'error' => $err));
}

if ($action === 'login') {
    $ident = strtolower(trim(strval($in['email'] ?? ($in['user'] ?? ''))));
    $password = strval($in['password'] ?? '');
    $pdo = gv_pdo();
    $s = $pdo->prepare("SELECT * FROM gv_users WHERE email = ? OR name = ? COLLATE utf8mb4_general_ci LIMIT 1");
    $s->execute(array($ident, $ident));
    $u = $s->fetch();
    if (!$u || !password_verify($password, $u['pass_hash'])) {
        gv_json(array('ok' => false, 'error' => 'E-posta/kullanıcı adı veya şifre hatalı.'), 401);
    }
    if (!intval($u['verified'])) {
        gv_json(array('ok' => false, 'needVerify' => true, 'email' => $u['email'],
            'error' => 'E-posta adresiniz henüz onaylanmadı. Gelen kutunuzu kontrol edin veya tekrar gönderin.'), 403);
    }
    $token = gv_token();
    $pdo->prepare("INSERT INTO gv_sessions(token,user_id,created_at) VALUES(?,?,?)")->execute(array($token, $u['id'], $now));
    gv_json(array('ok' => true, 'token' => $token, 'user' => gv_user_public($u)));
}

if ($action === 'resend') {
    $email = strtolower(trim(strval($in['email'] ?? '')));
    $pdo = gv_pdo();
    $s = $pdo->prepare("SELECT * FROM gv_users WHERE email = ?");
    $s->execute(array($email));
    $u = $s->fetch();
    if (!$u || intval($u['verified'])) gv_json(array('ok' => true, 'message' => 'Hesap için onay e-postası gerekirse gönderildi.'));
    if ($u['verify_sent_at'] && ($now - intval($u['verify_sent_at'])) < 60000) {
        gv_json(array('ok' => false, 'error' => 'Az önce gönderildi; 1 dakika sonra tekrar deneyin.'), 429);
    }
    $token = gv_token();
    $pdo->prepare("UPDATE gv_users SET verify_token = ?, verify_sent_at = ? WHERE id = ?")->execute(array($token, $now, $u['id']));
    $sent = gv_send_verify_mail($email, $u['name'], $token);
    gv_json(array('ok' => true, 'mailSent' => (bool)$sent, 'message' => 'Onay bağlantısı yeniden gönderildi.'));
}

if ($action === 'forgot') {
    $email = strtolower(trim(strval($in['email'] ?? '')));
    $pdo = gv_pdo();
    $s = $pdo->prepare("SELECT * FROM gv_users WHERE email = ?");
    $s->execute(array($email));
    $u = $s->fetch();
    if ($u) { // enumeration önlemi: hesap yoksa da aynı yanıt
        $token = gv_token();
        $pdo->prepare("UPDATE gv_users SET reset_token = ?, reset_expires = ? WHERE id = ?")
            ->execute(array($token, $now + 30 * 60 * 1000, $u['id']));
        gv_send_reset_mail($email, $u['name'], $token);
    }
    gv_json(array('ok' => true, 'message' => 'Bu e-posta kayıtlıysa sıfırlama bağlantısı gönderildi (30 dk geçerli).'));
}

if ($action === 'reset') {
    $token = strval($in['token'] ?? '');
    $password = strval($in['password'] ?? '');
    if (strlen($password) < 6) gv_json(array('ok' => false, 'error' => 'Yeni şifre en az 6 karakter olmalı.'), 400);
    $pdo = gv_pdo();
    $s = $pdo->prepare("SELECT id, reset_expires FROM gv_users WHERE reset_token = ?");
    $s->execute(array($token));
    $u = $s->fetch();
    if (!$u || !$u['reset_expires'] || intval($u['reset_expires']) < $now) {
        gv_json(array('ok' => false, 'error' => 'Sıfırlama bağlantısı geçersiz veya süresi dolmuş. Yeniden isteyin.'), 400);
    }
    $pdo->prepare("UPDATE gv_users SET pass_hash = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?")
        ->execute(array(password_hash($password, PASSWORD_DEFAULT), $u['id']));
    $pdo->prepare("DELETE FROM gv_sessions WHERE user_id = ?")->execute(array($u['id'])); // eski oturumlar kapanır
    gv_json(array('ok' => true, 'message' => 'Şifreniz güncellendi. Yeni şifrenizle giriş yapabilirsiniz.'));
}

if ($action === 'me') {
    $u = gv_user_by_token(gv_bearer());
    if (!$u) gv_json(array('ok' => false, 'error' => 'Oturum geçersiz.'), 401);
    gv_json(array('ok' => true, 'user' => gv_user_public($u)));
}

if ($action === 'logout') {
    $t = gv_bearer();
    if ($t) {
        $pdo = gv_pdo();
        $pdo->prepare("DELETE FROM gv_sessions WHERE token = ?")->execute(array($t));
    }
    gv_json(array('ok' => true));
}

if ($action === 'mail-status') {
    gv_json(array(
        'ok' => true,
        'configured' => function_exists('mail'),
        'host' => 'Yöncü yerel sendmail (PHP mail)',
        'user' => GV_MAIL_FROM_ADDR,
        'lastError' => gv_mail_last_error()
    ));
}

if ($action === 'selftest') {
    // Kurulum teşhisi: tarayıcıdan açıp adım adım kontrol edin.
    $steps = array();
    $steps[] = array('adım' => 'PHP sürümü', 'ok' => true, 'detay' => PHP_VERSION);
    try {
        $pdo = gv_pdo();
        $steps[] = array('adım' => 'Veritabanı bağlantısı', 'ok' => true, 'detay' => GV_DB_NAME . ' @ ' . GV_DB_HOST);
        foreach (array('gv_users', 'gv_sessions', 'gv_friends', 'gv_matches', 'gv_chat') as $t) {
            $c = $pdo->query("SELECT COUNT(*) c FROM $t")->fetch();
            $steps[] = array('adım' => "Tablo $t", 'ok' => true, 'detay' => intval($c['c']) . ' kayıt');
        }
    } catch (Exception $e) {
        $steps[] = array('adım' => 'Veritabanı', 'ok' => false, 'detay' => $e->getMessage() . ' → config.php bilgilerini kontrol edin');
        gv_json(array('ok' => false, 'steps' => $steps), 500);
    }
    $steps[] = array('adım' => 'mail() fonksiyonu', 'ok' => function_exists('mail'));
    if (!empty($_GET['send']) && gv_email_ok($_GET['send'])) {
        $sent = gv_send_mail(strval($_GET['send']), 'GameVerse SMTP Testi', 'Bu bir GameVerse kurulum test e-postasıdır.', '<b>Bu bir GameVerse kurulum test e-postasıdır.</b>');
        $steps[] = array('adım' => 'Test maili gönderimi', 'ok' => (bool)$sent, 'detay' => $sent ? ('Gönderildi → ' . strval($_GET['send'])) : ('BAŞARISIZ: ' . gv_mail_last_error()));
    } else {
        $steps[] = array('adım' => 'Test maili', 'ok' => true, 'detay' => 'Göndermek için: auth.php?action=selftest&send=posta@adresiniz.com');
    }
    gv_json(array('ok' => true, 'steps' => $steps));
}

gv_json(array('ok' => false, 'error' => 'Bilinmeyen işlem.'), 404);
