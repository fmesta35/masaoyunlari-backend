# -*- coding: utf-8 -*-
"""
PAYLAŞIM KAPAĞI (og:image) — assets/og-kapak.jpg, 1200x630.

NEDEN VAR
Kullanıcı isteği: "masaoyunlari.com.tr linkini paylaştığımda WhatsApp'ta,
Instagram'da veya diğer sosyal medya platformlarında güzel bir kapak
fotoğrafı, oyunlarımızı yansıtsın."
Eskiden index.html'de `og:image` olarak `assets/images/og-image.jpg`
yazıyordu ama O DOSYA HİÇ YOKTU (ve yol göreceliydi; WhatsApp mutlak URL
ister). `og:url` de eski bir alan adını (gameverse.com) gösteriyordu. Bu
yüzden link paylaşımlarında hiçbir görsel çıkmıyordu.

TASARIM (taslak C)
Sitenin mor marka gradyanı + ortada logo ve başlık, altında oyunların KENDİ
kapak fotoğraflarından yapılmış yuvarlak rozetler. Emoji KULLANILMAZ: emoji
her cihazda/sunucuda aynı çizilmiyor, önizlemede boş kutuya düşebiliyor.

ÖLÇÜ
1200x630 (1.91:1) — WhatsApp, Telegram, X, Facebook ve LinkedIn'in büyük
önizleme için beklediği oran. Yazılar kenardan en az 80 px içeride durur ki
kırpan istemcilerde de okunsun.

Kullanım:  python3 tools/kapak-paylasim.py
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HEDEF = os.path.join(KOK, 'assets', 'og-kapak.jpg')
W, H = 1200, 630
FB = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
FR = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
ALTIN = (246, 201, 84)
ALAN_ADI = 'www.masaoyunlari.com.tr'

ROZETLER = [('okey.jpg', 'Okey'), ('okey101.jpg', '101 Okey'), ('tavla.jpg', 'Tavla'),
            ('chess.jpg', 'Satranç'), ('bilardo.jpg', 'Bilardo'),
            ('battleship.jpg', 'Amiral Battı'), ('pisti.jpg', 'Pişti')]


def fnt(p, s):
    return ImageFont.truetype(p, s)


def logo():
    L = Image.open(os.path.join(KOK, 'assets', 'logo.png')).convert('RGBA')
    # logo.png saydam DEĞİL (RGB): beyaz kenarı yuvarlak maskeyle kesiyoruz.
    m = Image.new('L', L.size, 0)
    ImageDraw.Draw(m).rounded_rectangle([6, 6, L.size[0] - 6, L.size[1] - 6],
                                        int(L.size[0] * 0.22), fill=255)
    L.putalpha(m)
    return L


def yuvarlak(ad, cap):
    """Oyun kapağından yuvarlak rozet."""
    k = Image.open(os.path.join(KOK, 'assets', 'covers', ad)).convert('RGB')
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
        d.text((x + 2, y + 3), t, font=f, fill=(0, 0, 0, 170))
    d.text((x, y), t, font=f, fill=renk)


def arkaplan():
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    t = np.clip((xx / W) * 0.7 + (yy / H) * 0.5, 0, 1)
    a = np.stack([18 + (108 - 18) * t * 0.75,
                  18 + (92 - 18) * t * 0.55,
                  40 + (231 - 40) * t * 0.72], axis=2)
    r = np.sqrt(((xx - W * 0.22) / (W * 0.55)) ** 2 + ((yy - H * 0.35) / (H * 0.8)) ** 2)
    a *= np.clip(1.25 - r * 0.45, 0.72, 1.3)[:, :, None]
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def kapak():
    im = arkaplan()
    d = ImageDraw.Draw(im, 'RGBA')
    # ince halkalar: masadaki pulları/taşları anıştıran sessiz bir doku
    for i in range(26):
        x = (i * 211) % W
        y = (i * 137) % H
        r = 26 + (i % 4) * 16
        d.ellipse([x - r, y - r, x + r, y + r], outline=(255, 255, 255, 16), width=2)

    lg = logo().resize((120, 120), Image.LANCZOS)
    im.paste(lg, (int(W / 2 - 60), 52), lg)
    yazi(d, (W // 2, 196), 'MASA OYUNLARI', fnt(FB, 68), (255, 255, 255), ort=True)
    yazi(d, (W // 2, 282), 'Türkiye’nin masası — arkadaşlarınla, ücretsiz',
         fnt(FR, 30), (228, 230, 250), ort=True)

    cap, bosluk = 96, 34
    top = len(ROZETLER) * cap + (len(ROZETLER) - 1) * bosluk
    x, y = (W - top) // 2, 356
    for ad, etiket in ROZETLER:
        r = yuvarlak(ad, cap)
        halka = Image.new('RGBA', (cap + 10, cap + 10), (0, 0, 0, 0))
        ImageDraw.Draw(halka).ellipse([0, 0, cap + 9, cap + 9], outline=(255, 255, 255, 120), width=3)
        im.paste(r, (x, y), r)
        im.paste(halka, (x - 5, y - 5), halka)
        yazi(d, (x + cap // 2, y + cap + 12), etiket, fnt(FR, 22), (232, 234, 250),
             ort=True, golge=False)
        x += cap + bosluk

    yazi(d, (W // 2, H - 72), ALAN_ADI, fnt(FB, 30), ALTIN, ort=True)
    return im


if __name__ == '__main__':
    im = kapak()
    im.save(HEDEF, quality=88, optimize=True, progressive=True)
    print('yazildi', HEDEF, im.size, os.path.getsize(HEDEF) // 1024, 'KB')
