<?php
/*
 * GameVerse — Yöncü üzerinden mail gönderimi.
 *  Paylaşımlı hostingte PHP mail() yerel sunucudan gider: Render'ın Yöncü
 *  SMTP firewall'una takılma sorunu tamamen ortadan kalkar.
 *  Başarısızlıkta linkler yine de kaybolmasın diye log dosyasına yazılır.
 */

function gv_mail_log($msg) {
    $f = __DIR__ . '/gv-mail.log';
    @file_put_contents($f, '[' . date('Y-m-d H:i:s') . '] ' . $msg . "\n", FILE_APPEND);
}

function gv_mail_last_error() {
    $f = __DIR__ . '/gv-mail-last-error.txt';
    return file_exists($f) ? trim(@file_get_contents($f)) : null;
}
function gv_mail_set_error($msg) {
    @file_put_contents(__DIR__ . '/gv-mail-last-error.txt', strval($msg));
}

function gv_b64_subject($s) {
    return '=?UTF-8?B?' . base64_encode($s) . '?=';
}

// HTML + düz metin (multipart/alternative) — spam filtrelerine daha dosttur.
function gv_send_mail($to, $subject, $text, $html) {
    if (!function_exists('mail')) {
        gv_mail_set_error('Sunucuda mail() fonksiyonu kapalı (Yöncü desteğe sorun).');
        gv_mail_log("MAIL-KAPALI -> $to :: $text");
        return false;
    }
    $boundary = '----gv' . bin2hex(random_bytes(8));
    $headers  = "From: " . GV_MAIL_FROM . "\r\n";
    $headers .= "Reply-To: " . GV_MAIL_FROM_ADDR . "\r\n";
    $headers .= "MIME-Version: 1.0\r\n";
    $headers .= "Content-Type: multipart/alternative; boundary=\"$boundary\"\r\n";
    $headers .= "X-Mailer: GameVerse/1.0\r\n";
    $textB = chunk_split(base64_encode($text));
    $htmlB = chunk_split(base64_encode($html));
    $body  = "--$boundary\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n$textB\r\n";
    $body .= "--$boundary\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n$htmlB\r\n";
    $body .= "--$boundary--";

    $ok = @mail($to, gv_b64_subject($subject), $body, $headers, '-f ' . GV_MAIL_FROM_ADDR);
    if (!$ok) {
        // Bazı cPanel kurulumlarında 5. parametre (envelope) reddedilir — onsuz dene.
        $ok = @mail($to, gv_b64_subject($subject), $body, $headers);
    }
    if (!$ok) {
        $err = error_get_last();
        gv_mail_set_error('mail() false döndü: ' . ($err ? $err['message'] : 'bilinmeyen'));
        gv_mail_log("GONDERILEMEDI -> $to :: $subject");
        return false;
    }
    @unlink(__DIR__ . '/gv-mail-last-error.txt');
    gv_mail_log("GONDERILDI -> $to :: $subject");
    return true;
}

function gv_verify_link($token) { return GV_SITE_URL . '/?verify=' . urlencode($token); }
function gv_reset_link($token)  { return GV_SITE_URL . '/?reset=' . urlencode($token); }
function gv_esc($v) { return htmlspecialchars(strval($v), ENT_QUOTES, 'UTF-8'); }

function gv_send_verify_mail($to, $name, $token) {
    $link = gv_verify_link($token);
    $subject = '✅ GameVerse Üyelik Onayı';
    $text = "Merhaba $name,\n\nGameVerse üyeliğinizi onaylamak için bağlantıya tıklayın:\n$link\n\nBu isteği siz yapmadıysanız e-postayı yok sayabilirsiniz.";
    $html =
      '<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;background:#12122b;color:#fff;padding:28px;border-radius:14px">'
      . '<h2 style="color:#f9ca24;margin-top:0">🎮 GameVerse</h2>'
      . '<p>Merhaba <b>' . gv_esc($name) . '</b>,</p>'
      . '<p>Üyeliğinizi onaylamak için düğmeye tıklayın. Onaylamadan giriş yapamazsınız.</p>'
      . '<p style="text-align:center;margin:26px 0">'
      . '<a href="' . $link . '" style="background:linear-gradient(135deg,#6c5ce7,#4834d4);color:#fff;padding:13px 26px;border-radius:10px;text-decoration:none;font-weight:bold">✅ Üyeliğimi Onayla</a></p>'
      . '<p style="font-size:.8em;color:#9aa0b4">Bağlantı çalışmazsa kopyalayın: <br>' . $link . '</p>'
      . '<p style="font-size:.8em;color:#9aa0b4">Bu isteği siz yapmadıysanız e-postayı yok sayabilirsiniz.</p></div>';
    return gv_send_mail($to, $subject, $text, $html);
}

function gv_send_reset_mail($to, $name, $token) {
    $link = gv_reset_link($token);
    $subject = '🔒 GameVerse Şifre Sıfırlama';
    $text = "Merhaba $name,\n\nŞifrenizi sıfırlamak için bağlantıya tıklayın (30 dk geçerli):\n$link\n\nBu isteği siz yapmadıysanız e-postayı yok sayabilirsiniz.";
    $html =
      '<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;background:#12122b;color:#fff;padding:28px;border-radius:14px">'
      . '<h2 style="color:#f9ca24;margin-top:0">🎮 GameVerse</h2>'
      . '<p>Merhaba <b>' . gv_esc($name) . '</b>,</p>'
      . '<p>Şifrenizi sıfırlamak için düğmeye tıklayın. Bağlantı <b>30 dakika</b> geçerlidir.</p>'
      . '<p style="text-align:center;margin:26px 0">'
      . '<a href="' . $link . '" style="background:linear-gradient(135deg,#e74c3c,#c0392b);color:#fff;padding:13px 26px;border-radius:10px;text-decoration:none;font-weight:bold">🔒 Şifremi Sıfırla</a></p>'
      . '<p style="font-size:.8em;color:#9aa0b4">Bağlantı çalışmazsa kopyalayın: <br>' . $link . '</p></div>';
    return gv_send_mail($to, $subject, $text, $html);
}
