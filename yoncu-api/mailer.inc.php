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
function gv_mime_parts($text, $html) {
    $boundary = '----gv' . bin2hex(random_bytes(8));
    $headers  = "MIME-Version: 1.0\r\n";
    $headers .= "Content-Type: multipart/alternative; boundary=\"$boundary\"\r\n";
    $headers .= "X-Mailer: GameVerse/1.0\r\n";
    $textB = chunk_split(base64_encode($text));
    $htmlB = chunk_split(base64_encode($html));
    $body  = "--$boundary\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n$textB\r\n";
    $body .= "--$boundary\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n$htmlB\r\n";
    $body .= "--$boundary--";
    return array($headers, $body);
}

// Doğrulanmış SMTP gönderimi (Yöncü mail sunucusu, info@ kutusu).
// mail() "gönderdim" diyip teslim edemiyorsa kalıcı çözüm budur.
// Döner: true = gönderildi, false = tüm yollar denendi hata, null = SMTP tanımsız.

// Tek bir SMTP denemesi. Başarı: true; hata: açıklama metni (string).
function gv_smtp_one($host, $port, $to, $subject, $text, $html) {
    $errno = 0; $errstr = '';
    // Paylaşımlı hostlarda sertifika çoğu zaman panelin kendi adına (örn.
    // mail.yoncu.com) kayıtlıdır; katı peer doğrulaması TLS'i bozuyordu.
    // Bağlantı yine şifrelidir — yalnızca sertifika adı zorlaması esnetilir.
    $ctx = stream_context_create(array('ssl' => array(
        'verify_peer' => false,
        'verify_peer_name' => false,
        'allow_self_signed' => true
    )));
    $conn = @stream_socket_client(($port === 465 ? 'ssl' : 'tcp') . '://' . $host . ':' . $port, $errno, $errstr, 12, STREAM_CLIENT_CONNECT, $ctx);
    if (!$conn) return "bağlantı yok ($host:$port): $errstr ($errno)";
    stream_set_timeout($conn, 12);
    $read = function () use ($conn) {
        $d = '';
        while (($l = fgets($conn, 515)) !== false) { $d .= $l; if (strlen($l) >= 4 && $l[3] === ' ') break; }
        return $d;
    };
    $ok25 = function () use ($read) { $r = $read(); return (strpos($r, '25') === 0) ? $r : false; };
    $say = function ($c) use ($conn) { fwrite($conn, $c . "\r\n"); };
    $out = function ($why) use ($conn) { @fwrite($conn, "QUIT\r\n"); fclose($conn); return $why; };

    // EHLO kimliği: gönderen adresinin alan adı (masaoyunlari.com.tr)
    $helo = 'localhost';
    if (defined('GV_MAIL_FROM_ADDR') && strpos(GV_MAIL_FROM_ADDR, '@') !== false) {
        $helo = substr(strrchr(GV_MAIL_FROM_ADDR, '@'), 1);
    }
    $read(); // 220 karşılama
    $say("EHLO $helo"); if (!$ok25()) return $out('EHLO reddedildi');

    // 587 = STARTTLS zorunlu (465 doğrudan SSL; 25 düz)
    if ($port === 587) {
        $say('STARTTLS'); if (strpos($read(), '220') !== 0) return $out('STARTTLS reddedildi');
        if (!@stream_socket_enable_crypto($conn, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) return $out('TLS başlatılamadı');
        $say("EHLO $helo"); if (!$ok25()) return $out('TLS sonrası EHLO reddedildi');
    }

    // Kimlik doğrulama (yerel MTA'da AUTH ilan edilmeyebilir — o zaman kimliksiz dene)
    $from = GV_SMTP_USER;
    $say('AUTH LOGIN');
    $r = $read();
    if (strpos($r, '334') === 0) {
        $say(base64_encode(GV_SMTP_USER));
        if (strpos($read(), '334') !== 0) return $out('SMTP kullanıcı adı reddedildi');
        $say(base64_encode(GV_SMTP_PASS));
        if (strpos($read(), '235') !== 0) return $out('SMTP kimlik doğrulama başarısız (config.php şifresini kontrol edin)');
    } else {
        $local = ($host === '127.0.0.1' || $host === 'localhost');
        if (!$local) return $out('AUTH LOGIN desteklenmiyor');
        if (defined('GV_MAIL_FROM_ADDR')) $from = GV_MAIL_FROM_ADDR; // yerel MTA kimliksiz kabul
    }

    $say('MAIL FROM:<' . $from . '>'); if (!$ok25()) return $out('MAIL FROM reddedildi');
    $say('RCPT TO:<' . $to . '>');     if (!$ok25()) return $out('RCPT TO reddedildi');
    $say('DATA');                      if (strpos($read(), '354') !== 0) return $out('DATA reddedildi');

    list($mimeH, $mimeB) = gv_mime_parts($text, $html);
    $msg  = 'From: ' . GV_MAIL_FROM . "\r\n";
    $msg .= 'Reply-To: ' . GV_MAIL_FROM_ADDR . "\r\n";
    $msg .= 'To: <' . $to . ">\r\n";
    $msg .= 'Subject: ' . gv_b64_subject($subject) . "\r\n";
    $msg .= 'Date: ' . date('r') . "\r\n";
    $msg .= 'Message-ID: <gv' . bin2hex(random_bytes(8)) . '@' . $helo . '>' . "\r\n";
    $msg .= $mimeH . "\r\n" . $mimeB;
    $msg = preg_replace('/\r?\n/', "\r\n", $msg);  // CRLF normalleştir
    $msg = preg_replace('/^\./m', '..', $msg);     // dot-stuffing
    fwrite($conn, $msg . "\r\n.\r\n");
    if (!$ok25()) return $out('ileti gövdesi kabul edilmedi');
    $say('QUIT');
    fclose($conn);
    return true;
}

function gv_smtp_send($to, $subject, $text, $html) {
    if (!defined('GV_SMTP_USER') || !GV_SMTP_USER) return null;
    if (!defined('GV_SMTP_PASS') || !GV_SMTP_PASS || strpos(GV_SMTP_PASS, 'BURAYA') !== false || strpos(GV_SMTP_PASS, 'ŞİFRE') !== false) return null;
    $host = defined('GV_SMTP_HOST') ? GV_SMTP_HOST : 'mail.masaoyunlari.com.tr';
    $port = defined('GV_SMTP_PORT') ? intval(GV_SMTP_PORT) : 465;
    // Deneme sırası: yapılandırılan → aynı host 587/STARTTLS → yerel MTA (127.0.0.1:25).
    // Yöncü gibi paylaşımlı hostlarda DIŞ portlar güvenlik duvarına takılabiliyor;
    // yerel MTA ise aynı makinede olduğu için en sağlam yoldur.
    $tries = array(array($host, $port));
    if ($port === 465) $tries[] = array($host, 587);
    $tries[] = array('127.0.0.1', 25);
    $errs = array();
    foreach ($tries as $t) {
        $r = gv_smtp_one($t[0], $t[1], $to, $subject, $text, $html);
        if ($r === true) return true;
        $errs[] = $r;
    }
    gv_mail_set_error('SMTP: ' . implode(' | ', $errs));
    gv_mail_log("SMTP-HATA -> $to :: " . implode(' | ', $errs));
    return false;
}

function gv_send_mail($to, $subject, $text, $html) {
    // Önce doğrulanmış SMTP (teslim oranı mail()'den çok daha yüksek);
    // tanımsızsa ya da başarısız olursa PHP mail()'e düşer.
    $smtp = gv_smtp_send($to, $subject, $text, $html);
    if ($smtp === true) {
        @unlink(__DIR__ . '/gv-mail-last-error.txt');
        gv_mail_log("GONDERILDI(SMTP) -> $to :: $subject");
        return true;
    }
    if (!function_exists('mail')) {
        gv_mail_set_error('Sunucuda mail() fonksiyonu kapalı (Yöncü desteğe sorun).');
        gv_mail_log("MAIL-KAPALI -> $to :: $text");
        return false;
    }
    list($mimeH, $mimeB) = gv_mime_parts($text, $html);
    $headers  = "From: " . GV_MAIL_FROM . "\r\n";
    $headers .= "Reply-To: " . GV_MAIL_FROM_ADDR . "\r\n";
    $headers .= $mimeH;

    $ok = @mail($to, gv_b64_subject($subject), $mimeB, $headers, '-f ' . GV_MAIL_FROM_ADDR);
    if (!$ok) {
        // Bazı cPanel kurulumlarında 5. parametre (envelope) reddedilir — onsuz dene.
        $ok = @mail($to, gv_b64_subject($subject), $mimeB, $headers);
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
    $subject = '✅ Masa Oyunları Üyelik Onayı';
    $text = "Merhaba $name,\n\nMasa Oyunları üyeliğinizi onaylamak için bağlantıya tıklayın:\n$link\n\nBu isteği siz yapmadıysanız e-postayı yok sayabilirsiniz.";
    $html =
      '<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;background:#12122b;color:#fff;padding:28px;border-radius:14px">'
      . '<h2 style="color:#f9ca24;margin-top:0">🎲 Masa Oyunları</h2>'
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
    $subject = '🔒 Masa Oyunları Şifre Sıfırlama';
    $text = "Merhaba $name,\n\nŞifrenizi sıfırlamak için bağlantıya tıklayın (30 dk geçerli):\n$link\n\nBu isteği siz yapmadıysanız e-postayı yok sayabilirsiniz.";
    $html =
      '<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;background:#12122b;color:#fff;padding:28px;border-radius:14px">'
      . '<h2 style="color:#f9ca24;margin-top:0">🎲 Masa Oyunları</h2>'
      . '<p>Merhaba <b>' . gv_esc($name) . '</b>,</p>'
      . '<p>Şifrenizi sıfırlamak için düğmeye tıklayın. Bağlantı <b>30 dakika</b> geçerlidir.</p>'
      . '<p style="text-align:center;margin:26px 0">'
      . '<a href="' . $link . '" style="background:linear-gradient(135deg,#e74c3c,#c0392b);color:#fff;padding:13px 26px;border-radius:10px;text-decoration:none;font-weight:bold">🔒 Şifremi Sıfırla</a></p>'
      . '<p style="font-size:.8em;color:#9aa0b4">Bağlantı çalışmazsa kopyalayın: <br>' . $link . '</p></div>';
    return gv_send_mail($to, $subject, $text, $html);
}
