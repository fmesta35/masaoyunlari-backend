<?php
/*
 * GameVerse — Yöncü tarafı yapılandırması (SUNUCUDA DOLDURULUR!)
 *
 *  Bu dosyayı Yöncü'ye yükledikten SONRA aşağıdaki 4 alanı cPanel
 *  (MySQL Veritabanları) ekranından oluşturduğunuz bilgilerle doldurun:
 *    1) MySQL veritabanı oluşturun: örn. masaoyun_gameverse
 *    2) MySQL kullanıcısı oluşturun + güçlü şifre verin
 *    3) Kullanıcıyı veritabanına "Tüm Yetkiler" ile ekleyin
 *    4) Bilgileri aşağıya yazın
 *
 *  GÜVENLİK: Gerçek şifreler ASLA GitHub'a konmaz; bu dosya yalnızca
 *  Yöncü sunucusunda yaşar. Depodaki kopya ŞABLONDUR (yer tutuculu).
 */

define('GV_DB_HOST', 'localhost');
define('GV_DB_NAME', 'BURAYA_VERITABANI_ADI');      // örn. masaoyun_gameverse
define('GV_DB_USER', 'BURAYA_KULLANICI_ADI');       // örn. masaoyun_gv
define('GV_DB_PASS', 'BURAYA_SIFRE');               // MySQL kullanıcı şifresi

/* Render (backend) ile paylaşılan gizli anahtar: maç/sohbet kaydı gibi
 * yalnızca sunucunun yazabileceği uçları korur. Render'a GV_SERVER_KEY
 * olarak AYNI değer girilir. Uzun ve rastgele yapın (örn. 40+ karakter). */
define('GV_SERVER_KEY', 'BURAYA_UZUN_RASTGELE_ANAHTAR');

/* Site adresi (maildeki onay/sıfırlama linkleri buraya kurulur) */
define('GV_SITE_URL', 'https://www.masaoyunlari.com.tr');

/* Maillerin görünen göndereni (Yöncü panelinde açtığınız kutu) */
define('GV_MAIL_FROM', 'GameVerse <info@masaoyunlari.com.tr>');
define('GV_MAIL_FROM_ADDR', 'info@masaoyunlari.com.tr');

/* SMTP ile gönderim (ÖNERİLİR — teslim oranı PHP mail()'den çok daha yüksek):
 * Yöncü'de açtığınız info@ kutusunun şifresini GV_SMTP_PASS'e yazın.
 * Boş/yer tutucu bırakılırsa sistem eskisi gibi PHP mail() ile gönderir. */
define('GV_SMTP_HOST', 'mail.masaoyunlari.com.tr');
define('GV_SMTP_PORT', 465);
define('GV_SMTP_USER', 'info@masaoyunlari.com.tr');
define('GV_SMTP_PASS', 'BURAYA_SMTP_ŞİFRESİ');
