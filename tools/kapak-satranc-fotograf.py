# -*- coding: utf-8 -*-
"""
Satranç kapağı: assets/kaynak/satranc-vezir.jpg karesinden üretilir.

KAYNAK
Kullanıcının ilettiği kare (beyaz vezir ayakta, siyah şah devriliyor) zaten
606x354, yani kapak ölçüsünde geldi. Bu yüzden yapılacak iş kırpma değil,
KADRAJ DÜZELTMESİ ve pozlama.

NEDEN KADRAJ DÜZELTMESİ GEREKTİ (ölçüldü)
Kapaklar .game-thumb içinde `background-size:cover` ile gösterilir; kutunun
eni 140px ile ~300px arasında, boyu sabit 120px'tir. Oran 1.17 ile 2.50
arasında gezerken kapağın oranı 606/354 = 1.71 olduğundan `cover` en kötü
durumda ortadaki %68'lik bandı bırakır (bkz. kapak-ortak.py GUVENLI_ORAN).
Dikeyde bu bant y = 57 .. 297 px demek. Ham karede beyaz vezirin tacı y≈8'de
başlıyor, tabanı y≈295'te bitiyor: 287 px'lik cisim 240 px'lik banda sığmıyor,
yani geniş kutularda TAÇ KESİLİYORDU.

ÇÖZÜM
Fotoğraf %85,4 ölçeğe indirilip alt kenara dayanacak şekilde yerleştirilir
(52 px aşağı); böylece tacın tepesi y≈59'a, vezirin tabanı y≈304'e gelir —
taç güvenli bandın içine girer, tabanın alt pervazı 7 px taşar; bu, mevcut
kapakların toleransıyla (attaki kulaklar da 4-5 px taşıyordu) aynı çizgide.
Kalan kenar boşluğu AYNI fotoğrafın kadrajı dolduracak şekilde büyütülmüş,
bulanıklaştırılmış ve koyultulmuş kopyasıyla doldurulur: arka plan zaten
bulanık bir salon olduğu için bu, alan derinliğinin devamı gibi okunur.
Ön planın kenarları yumuşak bir maskeyle geçiştirilir, en sonda vinyet de
köşeleri kapatır — dikdörtgen bir çerçeve izi kalmaz.

POZLAMA
Parlaklık düz bir çarpanla değil gamma eğrisiyle artırılır (düz çarpan
pencereden gelen ışığı ve altın işlemeleri patlatıyordu).

Kullanım:  python3 tools/kapak-satranc-fotograf.py
"""
import os
import numpy as np
from PIL import Image, ImageFilter, ImageEnhance

KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KAYNAK = os.path.join(KOK, 'assets', 'kaynak', 'satranc-vezir.jpg')
HEDEF = os.path.join(KOK, 'assets', 'covers', 'chess.jpg')

GEN, BOY = 606, 354          # yayınlanan kapak ölçüsü
GUVENLI = 0.68               # her ekran genişliğinde görünen orta bant
OLCEK = 0.854                # ham karenin küçültme oranı (hesabı yukarıda)
# Ön plan ALT kenara dayanır: altta kalan ince şerit (7 px) bulanık arka
# planla ön plan arasında görünür bir çizgi bırakıyordu. Böylece taban
# kadrajın dışına taşmaz, üstte ise vinyetin içinde eriyen bir bant kalır.
KAYDIR_Y = None              # None = alta daya (BOY - ön plan yüksekliği)


def kapak():
    ham = Image.open(KAYNAK).convert('RGB')
    if ham.size != (GEN, BOY):
        # Başka ölçüde bir kare gelirse önce kapak oranına kırp.
        w, h = ham.size
        hh = int(w / (GEN / BOY))
        if hh <= h:
            ust = (h - hh) // 2
            ham = ham.crop((0, ust, w, ust + hh))
        else:
            ww = int(h * (GEN / BOY))
            sol = (w - ww) // 2
            ham = ham.crop((sol, 0, sol + ww, h))
        ham = ham.resize((GEN, BOY), Image.LANCZOS)

    # ---- ARKA PLAN: aynı kare, kadrajı taşacak kadar büyütülmüş + bulanık
    bg = ham.resize((int(GEN * 1.62), int(BOY * 1.62)), Image.LANCZOS)
    sol = (bg.width - GEN) // 2
    ust = (bg.height - BOY) // 2
    bg = bg.crop((sol, ust, sol + GEN, ust + BOY))
    bg = bg.filter(ImageFilter.GaussianBlur(26))
    bg = ImageEnhance.Brightness(bg).enhance(0.82)

    # ---- ÖN PLAN: küçültülmüş kare, yumuşak kenarlı maskeyle üstüne
    fw, fh = int(GEN * OLCEK), int(BOY * OLCEK)
    on = ham.resize((fw, fh), Image.LANCZOS)
    ox = (GEN - fw) // 2
    oy = (BOY - fh) if KAYDIR_Y is None else KAYDIR_Y
    maske = Image.new('L', (fw, fh), 0)
    # 9 px'lik iç dikdörtgen + bulanıklık = tüylenmiş kenar
    maske.paste(255, (26, 26, fw - 26, fh - 26))
    maske = maske.filter(ImageFilter.GaussianBlur(19))
    kapak = bg.copy()
    kapak.paste(on, (ox, oy), maske)

    # ---- POZLAMA: gölgeler ve orta tonlar açılır
    a = np.asarray(kapak, np.float32) / 255.0
    a = np.power(a, 0.845)
    a = np.clip(a * 1.05, 0, 1)
    im = Image.fromarray((a * 255).astype(np.uint8))

    # ---- VİNYET: köşeleri kapatır, ön planın kenar izini de gizler
    yy, xx = np.mgrid[0:BOY, 0:GEN].astype(np.float32)
    v = np.clip(1.06 - np.sqrt(((xx - GEN / 2) / (GEN * .80)) ** 2 +
                               ((yy - BOY / 2) / (BOY * .80)) ** 2) * 0.78, 0.40, 1.0)
    im = Image.fromarray(np.clip(np.asarray(im, np.float32) * v[:, :, None],
                                 0, 255).astype(np.uint8))

    im = ImageEnhance.Contrast(im).enhance(1.05)
    im = ImageEnhance.Color(im).enhance(1.05)
    im = im.filter(ImageFilter.UnsharpMask(radius=1.3, percent=62, threshold=3))
    im.save(HEDEF, quality=92, optimize=True, progressive=True)
    return im, (ox, oy, ox + fw, oy + fh)


if __name__ == '__main__':
    im, kutu = kapak()
    gx0, gy0 = GEN * (1 - GUVENLI) / 2, BOY * (1 - GUVENLI) / 2
    print('yazildi', HEDEF, im.size)
    print('guvenli bant  : x %.0f-%.0f, y %.0f-%.0f' % (gx0, GEN - gx0, gy0, BOY - gy0))
    print('on plan kutusu:', kutu)
