# -*- coding: utf-8 -*-
"""
Oyun kapak görselleri için ortak çizim yardımcıları.

NEDEN YORDAMSAL ÜRETİM?
Kapaklar dışarıdan indirilen fotoğraflar değil; bu dosyadaki yardımcılarla
çizilir. Böylece kadraj bizim denetimimizde kalır ve "GUVENLI_ORAN"
kuralına uyulur.

GÜVENLİ ALAN KURALI (çok önemli):
Kapaklar .game-thumb içinde `background-size:cover` ile gösterilir.
Kutunun eni 140px (mobil) ile ~300px (geniş ekran) arasında değişir,
boyu ise sabit 120px'tir. Yani en/boy oranı 1.17 ile 2.50 arasında gezer;
kapağın oranı ise 606/354 = 1.71'dir. `cover` fazlalığı kırptığı için
her iki uçta da ortadaki ~%68'lik bant her zaman görünür.
Bu yüzden ANA CİSİMLER daima ortadaki %68 x %68'lik kutuya sığmalıdır.
"""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance

GEN, BOY = 606, 354          # yayınlanan kapak ölçüsü
OLCEK = 2                    # önce 2 katı çizip küçültüyoruz (kenarlar pürüzsüz olsun)
W, H = GEN * OLCEK, BOY * OLCEK
GUVENLI = 0.68               # her zaman görünen orta bant


def guvenli_kutu(w=W, h=H):
    """Her ekran genişliğinde görünmesi garanti olan dikdörtgen."""
    gw, gh = w * GUVENLI, h * GUVENLI
    return ((w - gw) / 2, (h - gh) / 2, (w + gw) / 2, (h + gh) / 2)


# ----------------------------------------------------------------- dokular
def _gurultu(h, w, siddet, tohum=0, bulanik=0.0):
    rng = np.random.default_rng(tohum)
    g = rng.normal(0, siddet, (h, w, 1))
    if bulanik:
        g = np.asarray(Image.fromarray(
            np.clip(g[:, :, 0] + 128, 0, 255).astype(np.uint8)
        ).filter(ImageFilter.GaussianBlur(bulanik))).astype(np.float32)[:, :, None] - 128
    return g


def cuha(w=W, h=H, renk=(24, 96, 62), isik=(0.52, 0.38), guc=1.0, tohum=3):
    """Bilardo/kağıt masası çuhası: kadifemsi, ortası aydınlık."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    r = np.sqrt(((xx - w * isik[0]) / (w * .82))**2 + ((yy - h * isik[1]) / (h * 1.02))**2)
    l = np.clip(1.28 - r * 1.10, 0.20, 1.0) * guc
    taban = np.stack([renk[0] * .55 + renk[0] * 1.15 * l,
                      renk[1] * .40 + renk[1] * 1.25 * l,
                      renk[2] * .45 + renk[2] * 1.20 * l], axis=2)
    taban += _gurultu(h, w, 5.0, tohum)                      # kumaş lifi
    return Image.fromarray(np.clip(taban, 0, 255).astype(np.uint8))


def ahsap(w=W, h=H, koyu=(120, 78, 40), acik=(196, 148, 92), damar=26, tohum=11):
    """Oyun tahtası için ahşap: yatay damarlı, ortası aydınlık."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    rng = np.random.default_rng(tohum)
    faz = rng.normal(0, 1, (h, 1)) * 6
    t = 0.5 + 0.5 * np.sin(yy / damar + np.sin(xx / (w * .35)) * 1.6 + faz)
    t = t ** 1.5
    taban = np.stack([koyu[i] + (acik[i] - koyu[i]) * t for i in range(3)], axis=2)
    r = np.sqrt(((xx - w * .5) / (w * .85))**2 + ((yy - h * .42) / (h * 1.0))**2)
    taban *= np.clip(1.20 - r * .55, .58, 1.12)[:, :, None]
    taban += _gurultu(h, w, 4.0, tohum + 1)
    return Image.fromarray(np.clip(taban, 0, 255).astype(np.uint8))


# ------------------------------------------------------------------ cisimler
def golge(kat, maske, kaydir=(0, 0), bulanik=18, koyuluk=150):
    """Verilen maskeden yumuşak gölge basar (kat: RGBA tuval)."""
    g = Image.new('RGBA', kat.size, (0, 0, 0, 0))
    s = Image.new('RGBA', maske.size, (0, 0, 0, koyuluk))
    s.putalpha(maske)
    g.paste(s, kaydir, s)
    return Image.alpha_composite(kat, g.filter(ImageFilter.GaussianBlur(bulanik)))


def kure(cap, renk, parlaklik=1.0, isik=(-0.34, -0.40), ambiyans=0.20):
    """Işık alan bir küre (bilardo topu) — RGBA."""
    n = int(cap)
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    u = (xx - n / 2) / (n / 2); v = (yy - n / 2) / (n / 2)
    d2 = u * u + v * v
    ic = d2 <= 1.0
    z = np.sqrt(np.clip(1 - d2, 0, 1))
    lx, ly = isik; lz = 0.86
    nrm = np.sqrt(lx * lx + ly * ly + lz * lz)
    lam = np.clip((u * lx + v * ly + z * lz) / nrm, 0, 1)
    spek = lam ** 34 * 1.35 * parlaklik                      # keskin parlama
    kenar = np.clip(1 - (1 - z) * 1.25, 0.18, 1)             # kenar kararması
    taban = np.stack([np.asarray(renk, np.float32)[i] * (ambiyans + 0.92 * lam) * kenar
                      for i in range(3)], axis=2)
    taban += (spek * 255)[:, :, None]
    a = (np.clip((1.0 - d2) * n * 0.55, 0, 1) * 255)
    im = np.concatenate([np.clip(taban, 0, 255), a[:, :, None]], axis=2).astype(np.uint8)
    return Image.fromarray(im, 'RGBA')


def pul(gen, yuk, ust, yan, kalinlik, kenar=None):
    """Tepeden hafif eğik görünen yuvarlak pul/taş (reversi, connect4, gomoku)."""
    im = Image.new('RGBA', (int(gen) + 4, int(yuk + kalinlik) + 6), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.ellipse([2, 2 + kalinlik, gen + 2, yuk + 2 + kalinlik], fill=yan)   # yan yüzey
    d.ellipse([2, 2, gen + 2, yuk + 2], fill=ust)                        # üst yüzey
    if kenar:
        d.ellipse([2, 2, gen + 2, yuk + 2], outline=kenar, width=max(1, int(gen * .012)))
    # üstten gelen ışık
    p = Image.new('RGBA', im.size, (0, 0, 0, 0))
    ImageDraw.Draw(p).ellipse([gen * .18, yuk * .12, gen * .62, yuk * .52],
                              fill=(255, 255, 255, 70))
    p = p.filter(ImageFilter.GaussianBlur(gen * .06))
    im = Image.alpha_composite(im, p)
    return im


# ------------------------------------------------------------------- bitiriş
def bitir(kapak, dosya, vinyet=0.60, netlik=70, kontrast=1.05):
    """Vinyet + keskinleştirme + 606x354 JPEG."""
    w, h = kapak.size
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    v = np.clip(1.06 - np.sqrt(((xx - w / 2) / (w * .74))**2 +
                               ((yy - h / 2) / (h * .74))**2) * vinyet, 0.52, 1.0)
    arr = np.asarray(kapak.convert('RGB')).astype(np.float32) * v[:, :, None]
    im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    im = ImageEnhance.Contrast(im).enhance(kontrast)
    im = im.resize((GEN, BOY), Image.LANCZOS)
    im = im.filter(ImageFilter.UnsharpMask(radius=1.3, percent=netlik, threshold=3))
    im.save(dosya, quality=90, optimize=True, progressive=True)
    return im
