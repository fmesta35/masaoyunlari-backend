<?php
/*
 * ==================================================================
 *   BU DOSYA "ÖRNEK"TİR — SUNUCUDA KULLANILAN DOSYA DEĞİLDİR
 * ==================================================================
 *
 *  Gerçek yapılandırma dosyasının adı: config.php
 *  Yeri: /public_html/api/config.php   (YALNIZCA sunucuda yaşar)
 *
 *  Bu depoda config.php BULUNMAZ (.gitignore ile dışarıda tutulur).
 *  Böylece yoncu-api klasörünü toptan yüklemek sunucudaki gerçek
 *  dosyanın üzerine ARTIK YAZAMAZ.
 *
 *  NEDEN: Daha önce depoda "şablon" bir config.php duruyordu; klasör
 *  toptan yüklenince gerçek dosyayı ezdi ve üyelik sistemi
 *  "Veritabanına bağlanılamadı" diyerek tamamen durdu.
 *
 *  İLK KURULUM
 *    1) Bu dosyayı sunucuda config.php adıyla kopyalayın.
 *    2) BURAYA_... yer tutucularını gerçek değerlerle doldurun.
 *    3) Sonraki yüklemelerde bu dosyaya hiç dokunmanız gerekmez.
 *
 *  Gerçek şifreleri ASLA bu dosyaya veya GitHub'a yazmayın.
 */

define('GV_DB_HOST', 'localhost');
define('GV_DB_NAME', 'BURAYA_VERITABANI_ADI');      // örn. masaoyun_db
define('GV_DB_USER', 'BURAYA_KULLANICI_ADI');       // örn. masaoyun_kurucu
define('GV_DB_PASS', 'BURAYA_SIFRE');               // MySQL kullanıcı şifresi

/* Render (backend) ile paylaşılan gizli anahtar: maç/sohbet kaydı gibi
 * yalnızca sunucunun yazabileceği uçları korur. Render'a GV_SERVER_KEY
 * olarak AYNI değer girilir. Uzun ve rastgele yapın (örn. 40+ karakter). */
define('GV_SERVER_KEY', 'BURAYA_UZUN_RASTGELE_ANAHTAR');

/* Site adresi (maildeki onay/sıfırlama linkleri buraya kurulur) */
define('GV_SITE_URL', 'https://www.masaoyunlari.com.tr');

/* Maillerin görünen göndereni (Yöncü panelinde açtığınız kutu) */
define('GV_MAIL_FROM', 'Masa Oyunları <info@masaoyunlari.com.tr>');
define('GV_MAIL_FROM_ADDR', 'info@masaoyunlari.com.tr');

/* SMTP ile gönderim (ÖNERİLİR — teslim oranı PHP mail()'den çok daha yüksek):
 * Yöncü'de açtığınız info@ kutusunun şifresini GV_SMTP_PASS'e yazın.
 * Boş/yer tutucu bırakılırsa sistem eskisi gibi PHP mail() ile gönderir. */
define('GV_SMTP_HOST', 'mail.masaoyunlari.com.tr');
define('GV_SMTP_PORT', 465);
define('GV_SMTP_USER', 'info@masaoyunlari.com.tr');
define('GV_SMTP_PASS', 'BURAYA_SMTP_ŞİFRESİ');

/* Yonetici (kurucu) hesabi — KURUCU PANELI YETKISI
 *
 * ⚠ ONEMLI DEGISIKLIK: Kurucu hesabi ARTIK KENDILIGINDEN OLUSMUYOR.
 * Eskiden kurucu@kurucu.com hesabi SABIT 'kurucu123' sifresiyle otomatik
 * aciliyordu; sifre depoda acik yazdigi icin siteye disaridan kurucu
 * olarak girilebiliyordu. Bu davranis kaldirildi.
 *
 * KURULUM (phpMyAdmin -> SQL sekmesi):
 *   1) Sitede normal bir uye hesabi acin (e-posta onayini tamamlayin).
 *   2) O hesabi kurucu yapin:
 *        UPDATE gv_users SET is_founder = 1 WHERE email = 'sizin@adresiniz';
 *   3) Eski varsayilan hesabi silin:
 *        DELETE FROM gv_users WHERE email = 'kurucu@kurucu.com';
 *
 * Asagidaki GV_ADMIN_EMAIL ek/yedek bir yoldur: bu e-postaya sahip MEVCUT
 * hesap da kurucu sayilir (ve ilk istekte is_founder = 1 olarak isaretlenir).
 * Bayrakla yonetmek istiyorsaniz bos birakabilirsiniz. */
define('GV_ADMIN_EMAIL', '');
