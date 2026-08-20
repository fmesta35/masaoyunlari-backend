'use strict';

/*
 * GameVerse — E-posta gönderici (Yöncü SMTP, info@masaoyunlari.com.tr)
 *
 *  Ortam değişkenleri (Render → Environment):
 *    GV_SMTP_HOST (vars: mail.masaoyunlari.com.tr)
 *    GV_SMTP_PORT (vars: 465, secure) / 587 için GV_SMTP_SECURE=0 verin
 *    GV_SMTP_USER (vars: info@masaoyunlari.com.tr)
 *    GV_SMTP_PASS — ZORUNLU (yoksa gönderim kapalı; linkler konsola düşer)
 *    GV_MAIL_FROM (vars: "GameVerse <{GV_SMTP_USER}>")
 *    GV_SITE_URL  (vars: https://www.masaoyunlari.com.tr) — maildeki linkler
 */

let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch (_) { /* opsiyonel */ }

const HOST = process.env.GV_SMTP_HOST || 'mail.masaoyunlari.com.tr';
const PORT = Number(process.env.GV_SMTP_PORT) || 465;
const SECURE = process.env.GV_SMTP_SECURE ? process.env.GV_SMTP_SECURE === '1' : PORT === 465;
const USER = process.env.GV_SMTP_USER || 'info@masaoyunlari.com.tr';
const PASS = process.env.GV_SMTP_PASS || '';
const FROM = process.env.GV_MAIL_FROM || `GameVerse <${USER}>`;
const SITE = (process.env.GV_SITE_URL || 'https://www.masaoyunlari.com.tr').replace(/\/+$/, '');

let transport = null;
function getTransport() {
  if (transport || !nodemailer || !PASS) return transport;
  transport = nodemailer.createTransport({
    host: HOST,
    port: PORT,
    secure: SECURE,
    auth: { user: USER, pass: PASS },
    tls: { rejectUnauthorized: false } // paylaşımlı hosting sertifikaları için
  });
  return transport;
}

function mailEnabled() { return !!PASS && !!nodemailer; }

// Başarısızlıkta FALSE döner ama linki konsola yazar (kurulum hatasında
// kullanıcı dışarıda kalmasın; sunucu yöneticisi linki logdan alabilir).
async function sendMail(to, subject, text, html, logTag) {
  const t = getTransport();
  if (!t) {
    console.log(`📧 [MAIL-KAPALI] ${logTag || subject} -> ${to}`);
    console.log(text);
    return false;
  }
  try {
    await t.sendMail({ from: FROM, to, subject, text, html });
    console.log(`📧 ${logTag || 'Mail'} gönderildi -> ${to}`);
    return true;
  } catch (e) {
    console.warn('⚠️  Mail gönderilemedi (' + (logTag || to) + '):', e.message);
    console.log(text); // link hiç kaybolmasın
    return false;
  }
}

function verifyLink(token) { return `${SITE}/?verify=${encodeURIComponent(token)}`; }
function resetLink(token) { return `${SITE}/?reset=${encodeURIComponent(token)}`; }

async function sendVerifyMail(to, name, token) {
  const link = verifyLink(token);
  const subject = '✅ GameVerse Üyelik Onayı';
  const text = `Merhaba ${name},\n\nGameVerse üyeliğinizi onaylamak için bağlantıya tıklayın:\n${link}\n\nBu isteği siz yapmadıysanız e-postayı yok sayabilirsiniz.`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;background:#12122b;color:#fff;padding:28px;border-radius:14px">
      <h2 style="color:#f9ca24;margin-top:0">🎮 GameVerse</h2>
      <p>Merhaba <b>${esc(name)}</b>,</p>
      <p>Üyeliğinizi onaylamak için düğmeye tıklayın. Onaylamadan giriş yapamazsınız.</p>
      <p style="text-align:center;margin:26px 0">
        <a href="${link}" style="background:linear-gradient(135deg,#6c5ce7,#4834d4);color:#fff;padding:13px 26px;border-radius:10px;text-decoration:none;font-weight:bold">✅ Üyeliğimi Onayla</a>
      </p>
      <p style="font-size:.8em;color:#9aa0b4">Bağlantı çalışmazsa kopyalayın: <br>${link}</p>
      <p style="font-size:.8em;color:#9aa0b4">Bu isteği siz yapmadıysanız e-postayı yok sayabilirsiniz.</p>
    </div>`;
  return sendMail(to, subject, text, html, 'üyelik-onayı');
}

async function sendResetMail(to, name, token) {
  const link = resetLink(token);
  const subject = '🔒 GameVerse Şifre Sıfırlama';
  const text = `Merhaba ${name},\n\nŞifrenizi sıfırlamak için bağlantıya tıklayın (30 dk geçerli):\n${link}\n\nBu isteği siz yapmadıysanız e-postayı yok sayabilirsiniz.`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;background:#12122b;color:#fff;padding:28px;border-radius:14px">
      <h2 style="color:#f9ca24;margin-top:0">🎮 GameVerse</h2>
      <p>Merhaba <b>${esc(name)}</b>,</p>
      <p>Şifrenizi sıfırlamak için düğmeye tıklayın. Bağlantı <b>30 dakika</b> geçerlidir.</p>
      <p style="text-align:center;margin:26px 0">
        <a href="${link}" style="background:linear-gradient(135deg,#e74c3c,#c0392b);color:#fff;padding:13px 26px;border-radius:10px;text-decoration:none;font-weight:bold">🔒 Şifremi Sıfırla</a>
      </p>
      <p style="font-size:.8em;color:#9aa0b4">Bağlantı çalışmazsa kopyalayın: <br>${link}</p>
    </div>`;
  return sendMail(to, subject, text, html, 'şifre-sıfırlama');
}

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

module.exports = { sendVerifyMail, sendResetMail, verifyLink, resetLink, mailEnabled };
