# -*- coding: utf-8 -*-
"""
101 Okey kapağı: assets/kaynak/okey101-masa.jpg karesinden üretilir.

KAYNAK
Kullanıcının ilettiği kare 2752x1536 (oran 1.792). Kapak oranı 606/354 =
1.712 olduğundan kırpma gerekiyor; ayrıca ham kadrajda ıstaka çerçevenin
sol yarısında kalıyor ve taşlar küçük resim boyutunda okunmuyordu.

KADRAJ HESABI (ölçüldü, tahmin değil)
Kapaklar .game-thumb içinde `background-size:cover` ile gösterilir; kutunun
eni 140px ile ~300px arasında, boyu sabit 120px'tir. Oran 1.17 ile 2.50
arasında gezdiği için `cover` en kötü durumda ortadaki %68'lik bandı bırakır
(bkz. kapak-ortak.py GUVENLI_ORAN) — yani ANA CİSİMLER ortadaki
%68 x %68'lik kutuya sığmalı.
Ham karede okunması gereken cisim, öndeki ıstaka ve üzerindeki taşlardır:
kaynak koordinatlarında x 321..1797, y 607..1259 (en 1476, boy 652).
Bu bloğun %68'lik banda sığması için kırpma eni en az 1476/0.68 = 2171 px
olmalı. 2350 px seçildi: hem şart sağlanır (blok bandın içinde kalır) hem de
tam genişlikte kırpmaya (2629 px) göre %12 yakınlaşma olur, böylece taşların
üzerindeki rakamlar 300x120'lik küçük resimde bile okunur.
Kırpma bloğun merkezine (1059, 933) göre konumlanır ve kenarlara kırpılır.

POZLAMA
Fotoğraf zaten aydınlık; gölgeler hafif bir gamma eğrisiyle açılır, kontrast
ve doygunluk bir tık artırılır, ardından küçük resim boyutunda rakamların
kenarı kaybolmasın diye keskinleştirilir. Vinyet köşeleri hafifçe kapatır.

Kullanım:  python3 tools/kapak-okey101-fotograf.py
"""
import os
import numpy as np
from PIL import Image, ImageFilter, ImageEnhance

KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KAYNAK = os.path.join(KOK, 'assets', 'kaynak', 'okey101-masa.jpg')
HEDEF = os.path.join(KOK, 'assets', 'covers', 'okey101.jpg')

GEN, BOY = 606, 354          # yayınlanan kapak ölçüsü
GUVENLI = 0.68               # her ekran genişliğinde görünen orta bant
KIRPMA_EN = 2350             # kaynak pikselinde kırpma genişliği (hesabı yukarıda)
MERKEZ = (1059, 933)         # ıstaka + taş bloğunun kaynaktaki merkezi
# Bloğun kaynaktaki sınırları — güvenli bant denetimi bunun üzerinden yapılır.
BLOK = (321, 607, 1797, 1259)


def kapak():
    ham = Image.open(KAYNAK).convert('RGB')
    W, H = ham.size
    cw = min(KIRPMA_EN, W)
    ch = int(round(cw / (GEN / BOY)))
    if ch > H:                                  # kaynak yeterince uzun değilse
        ch = H
        cw = int(round(ch * (GEN / BOY)))
    x0 = max(0, min(W - cw, MERKEZ[0] - cw // 2))
    y0 = max(0, min(H - ch, MERKEZ[1] - ch // 2))
    im = ham.crop((x0, y0, x0 + cw, y0 + ch)).resize((GEN, BOY), Image.LANCZOS)

    # ---- POZLAMA: gölgeler hafifçe açılır (fotoğraf zaten aydınlık)
    a = np.asarray(im, np.float32) / 255.0
    a = np.power(a, 0.94)
    im = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8))
    im = ImageEnhance.Contrast(im).enhance(1.06)
    im = ImageEnhance.Color(im).enhance(1.05)

    # ---- VİNYET: köşeleri hafifçe kapatır, göz ortadaki ıstakaya gider
    yy, xx = np.mgrid[0:BOY, 0:GEN].astype(np.float32)
    v = np.clip(1.04 - np.sqrt(((xx - GEN / 2) / (GEN * .86)) ** 2 +
                               ((yy - BOY / 2) / (BOY * .86)) ** 2) * 0.42, 0.68, 1.0)
    im = Image.fromarray(np.clip(np.asarray(im, np.float32) * v[:, :, None],
                                 0, 255).astype(np.uint8))

    # ---- NETLİK: 140x120'lik küçük resimde rakamlar okunur kalsın
    im = im.filter(ImageFilter.UnsharpMask(radius=1.2, percent=72, threshold=3))
    im.save(HEDEF, quality=92, optimize=True, progressive=True)
    return im, (x0, y0, cw, ch)


def guvenli_denetim(x0, y0, cw, ch):
    """Taş bloğu %68'lik bandın içinde mi? Oran olarak döner."""
    bx0 = (BLOK[0] - x0) / cw
    by0 = (BLOK[1] - y0) / ch
    bx1 = (BLOK[2] - x0) / cw
    by1 = (BLOK[3] - y0) / ch
    alt, ust = (1 - GUVENLI) / 2, (1 + GUVENLI) / 2
    return (bx0, by0, bx1, by1), (alt, ust)


if __name__ == '__main__':
    im, (x0, y0, cw, ch) = kapak()
    (bx0, by0, bx1, by1), (alt, ust) = guvenli_denetim(x0, y0, cw, ch)
    print('yazildi', HEDEF, im.size)
    print('kirpma      : x0=%d y0=%d %dx%d' % (x0, y0, cw, ch))
    print('guvenli bant: %.3f .. %.3f' % (alt, ust))
    print('tas blogu   : x %.3f..%.3f  y %.3f..%.3f' % (bx0, bx1, by0, by1))
    print('banda sigiyor mu:', bx0 >= alt - 0.03 and bx1 <= ust + 0.03
                               and by0 >= alt and by1 <= ust)
