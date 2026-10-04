# -*- coding: utf-8 -*-
"""
GOOGLE PLAY ÖZELLİK GRAFİĞİ — assets/play/ozellik-grafigi-1024x500.png

NEDEN VAR
Play mağaza kaydının en üstünde duran banner. Zorunlu ölçü 1024x500 PNG
(ya da JPG), saydamlık YOK. Play bu görseli bazı yerlerde kırpar ve
üzerine oynatma düğmesi/metin bindirebilir; bu yüzden:
  • yazılar ortada ve kenardan en az 90 px içeride tutulur,
  • ÖNEMLİ hiçbir öğe en alt/en üst 60 px'e konmaz,
  • Play "metin kalabalığı" olan grafikleri eleyebildiği için metin azdır.

Paylaşım kapağıyla (tools/kapak-paylasim.py) AYNI görsel dili kullanır:
aynı mor gradyan, aynı halka dokusu, aynı logo ve oyun rozetleri. Mağaza
ile site yan yana görüldüğünde tek bir marka gibi dursun diye.

Kullanım:  python3 tools/play-ozellik-grafigi.py
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HEDEF = os.path.join(KOK, 'assets', 'play', 'ozellik-grafigi-1024x500.png')
W, H = 1024, 500
OLCEK = 2                      # 2 katı çizip küçültüyoruz: kenarlar pürüzsüz olsun
FB = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
FR = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
ALTIN = (246, 201, 84)

ROZETLER = [('okey.jpg', 'Okey'), ('okey101.jpg', '101 Okey'), ('tavla.jpg', 'Tavla'),
            ('chess.jpg', 'Satranç'), ('kelimelik.jpg', 'Kelimelik'),
            ('bilardo.jpg', 'Bilardo'), ('battleship.jpg', 'Amiral Battı')]


def fnt(p, s):
    return ImageFont.truetype(p, s)


def logo(boy):
    L = Image.open(os.path.join(KOK, 'assets', 'logo.png')).convert('RGBA')
    m = Image.new('L', L.size, 0)
    ImageDraw.Draw(m).rounded_rectangle([6, 6, L.size[0] - 6, L.size[1] - 6],
                                        int(L.size[0] * 0.22), fill=255)
    L.putalpha(m)
    return L.resize((boy, boy), Image.LANCZOS)


def yuvarlak(ad, cap):
    yol = os.path.join(KOK, 'assets', 'covers', ad)
    if not os.path.exists(yol):                 # kapağı olmayan oyun atlanır
        return None
    k = Image.open(yol).convert('RGB')
    kw, kh = k.size
    kisa = min(kw, kh)
    k = k.crop(((kw - kisa) // 2, (kh - kisa) // 2, (kw + kisa) // 2, (kh + kisa) // 2))
    k = k.resize((cap, cap), Image.LANCZOS).convert('RGBA')
    m = Image.new('L', (cap, cap), 0)
    ImageDraw.Draw(m).ellipse([0, 0, cap - 1, cap - 1], fill=255)
    k.putalpha(m)
    return k


def yazi(d, xy, t, f, renk, golge=True, ort=False):
    x, y = xy
    if ort:
        kutu = d.textbbox((0, 0), t, font=f)
        x = x - (kutu[2] - kutu[0]) // 2
    if golge:
        d.text((x + 3, y + 4), t, font=f, fill=(0, 0, 0, 165))
    d.text((x, y), t, font=f, fill=renk)


def arkaplan(w, h):
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    t = np.clip((xx / w) * 0.7 + (yy / h) * 0.5, 0, 1)
    a = np.stack([18 + (108 - 18) * t * 0.75,
                  18 + (92 - 18) * t * 0.55,
                  40 + (231 - 40) * t * 0.72], axis=2)
    r = np.sqrt(((xx - w * 0.22) / (w * 0.55)) ** 2 + ((yy - h * 0.35) / (h * 0.8)) ** 2)
    a *= np.clip(1.25 - r * 0.45, 0.72, 1.3)[:, :, None]
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def grafik():
    w, h = W * OLCEK, H * OLCEK
    im = arkaplan(w, h)
    d = ImageDraw.Draw(im, 'RGBA')

    for i in range(34):                          # sessiz halka dokusu
        x = (i * 211 * OLCEK) % w
        y = (i * 137 * OLCEK) % h
        r = (26 + (i % 4) * 16) * OLCEK
        d.ellipse([x - r, y - r, x + r, y + r], outline=(255, 255, 255, 15), width=2 * OLCEK)

    lg = logo(132 * OLCEK)
    im.paste(lg, (int(w / 2 - 66 * OLCEK), 44 * OLCEK), lg)

    yazi(d, (w // 2, 196 * OLCEK), 'MASA OYUNLARI', fnt(FB, 76 * OLCEK),
         (255, 255, 255), ort=True)
    yazi(d, (w // 2, 288 * OLCEK), 'Gerçek rakiplerle, ücretsiz',
         fnt(FR, 33 * OLCEK), (226, 229, 250), ort=True)

    cap, bosluk = 74 * OLCEK, 26 * OLCEK
    rozetler = [(a, e) for a, e in ROZETLER if os.path.exists(
        os.path.join(KOK, 'assets', 'covers', a))]
    top = len(rozetler) * cap + (len(rozetler) - 1) * bosluk
    x, y = (w - top) // 2, 352 * OLCEK
    for ad, _ in rozetler:
        r = yuvarlak(ad, cap)
        halka = Image.new('RGBA', (cap + 8 * OLCEK, cap + 8 * OLCEK), (0, 0, 0, 0))
        ImageDraw.Draw(halka).ellipse([0, 0, cap + 8 * OLCEK - 1, cap + 8 * OLCEK - 1],
                                      outline=(255, 255, 255, 115), width=3 * OLCEK)
        im.paste(r, (x, y), r)
        im.paste(halka, (x - 4 * OLCEK, y - 4 * OLCEK), halka)
        x += cap + bosluk

    return im.resize((W, H), Image.LANCZOS)


if __name__ == '__main__':
    os.makedirs(os.path.dirname(HEDEF), exist_ok=True)
    im = grafik()
    im.save(HEDEF, optimize=True)
    print('yazildi', HEDEF, im.size, os.path.getsize(HEDEF) // 1024, 'KB')
