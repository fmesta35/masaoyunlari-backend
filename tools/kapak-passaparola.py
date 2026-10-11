# -*- coding: utf-8 -*-
"""
PASSAPAROLA KAPAĞI — yarışma sahnesinde harf çarkı.

GÜVENLİ ALAN: kapaklar .game-thumb içinde `background-size:cover` ile
gösterilir; her zaman yalnız ortadaki %68 × %68'lik bant görünür
(bkz. tools/kapak-ortak.py). Bu yüzden ANA CİSİM (harf çarkı ve ortadaki
soru rozeti) tamamen o banda sığar; kenarlardaki soluk harfler yalnız
derinlik içindir, kırpılabilir.

Kullanım: python3 tools/kapak-passaparola.py
"""
import importlib.util, os, math, random
KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_s = importlib.util.spec_from_file_location('ko', os.path.join(KOK, 'tools', 'kapak-ortak.py'))
ko = importlib.util.module_from_spec(_s); _s.loader.exec_module(ko)
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = ko.W, ko.H
CIKTI = os.path.join(KOK, 'assets', 'covers')

HARFLER = list("ABCÇDEFGHIİKLMNOÖPRSŞTUÜVYZ")      # oyunun 27 harfi
# Çarkın durumu: doğru (yeşil), yanlış (kırmızı), pas (mavi), bekleyen (koyu)
DOGRU = set("ABDEHKMRST")
YANLIS = set("FÖÜ")
PAS = set("CGP")

FONT_ADAYLAR = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
]
def yazitipi(boy):
    for y in FONT_ADAYLAR:
        if os.path.exists(y):
            try: return ImageFont.truetype(y, boy)
            except Exception: pass
    return ImageFont.load_default()

def ortala(d, g, y, metin, f):
    k = d.textbbox((0, 0), metin, font=f)
    return ((g - (k[2] - k[0])) / 2 - k[0], (y - (k[3] - k[1])) / 2 - k[1])


def rozet(cap, harf, renk, yazi):
    """Harf rozeti: ışık alan yuvarlak disk."""
    im = ko.kure(cap, renk, parlaklik=0.75, ambiyans=0.42)
    d = ImageDraw.Draw(im, 'RGBA')
    f = yazitipi(int(cap * .52))
    dx, dy = ortala(d, cap, cap, harf, f)
    d.text((dx, dy - cap * .02), harf, font=f, fill=yazi + (255,))
    return im


def passaparola():
    # zemin: stüdyo mavisi çuha
    kapak = ko.cuha(renk=(16, 62, 96), isik=(0.5, 0.30), guc=1.05, tohum=47).convert('RGBA')
    G = ko.guvenli_kutu()
    cx, cy = (G[0] + G[2]) / 2, (G[1] + G[3]) / 2
    gw, gh = G[2] - G[0], G[3] - G[1]
    rng = random.Random(20261011)

    # ---- arka planda soluk harfler (derinlik) — güvenli bandın DIŞINDA
    d0 = ImageDraw.Draw(kapak, 'RGBA')
    f_arka = yazitipi(int(gw * .15))
    for h in 'ŞÇĞİÖÜZVKN':
        x = rng.choice([rng.uniform(-gw * .03, G[0] - gw * .03),
                        rng.uniform(G[2] - gw * .01, W - gw * .09)])
        y = rng.uniform(-gh * .04, H - gh * .20)
        d0.text((x, y), h, font=f_arka, fill=(255, 255, 255, 24))

    # ---- harf çarkı: 27 rozet, bir halka üzerinde
    yaricap = min(gw, gh) * 0.44
    cap = int(min(gw, gh) * 0.125)
    for i, h in enumerate(HARFLER):
        aci = -math.pi / 2 + i * (2 * math.pi / len(HARFLER))
        x = cx + math.cos(aci) * yaricap - cap / 2
        y = cy + math.sin(aci) * yaricap - cap / 2
        if h in DOGRU:      renk, yazi = (46, 204, 113), (6, 36, 15)
        elif h in YANLIS:   renk, yazi = (231, 76, 60), (255, 255, 255)
        elif h in PAS:      renk, yazi = (59, 154, 225), (4, 32, 47)
        else:               renk, yazi = (38, 54, 80), (176, 196, 216)
        t = rozet(cap, h, renk, yazi)
        kapak = ko.golge(kapak, t.split()[3], (int(x) + 5, int(y) + 10), bulanik=11, koyuluk=140)
        kapak.paste(t, (int(x), int(y)), t)

    # ---- sırası gelen harf: büyük sarı rozet (çarkın üstünde)
    aktif = 'N'
    i = HARFLER.index(aktif)
    aci = -math.pi / 2 + i * (2 * math.pi / len(HARFLER))
    bcap = int(cap * 1.55)
    bx = cx + math.cos(aci) * yaricap - bcap / 2
    by = cy + math.sin(aci) * yaricap - bcap / 2
    t = rozet(bcap, aktif, (234, 179, 8), (42, 31, 2))
    kapak = ko.golge(kapak, t.split()[3], (int(bx) + 6, int(by) + 12), bulanik=14, koyuluk=165)
    kapak.paste(t, (int(bx), int(by)), t)

    # ---- ortada soru rozeti + maske çizgileri
    d = ImageDraw.Draw(kapak, 'RGBA')
    kg, ky = gw * .40, gh * .34
    kx0, ky0 = cx - kg / 2, cy - ky / 2
    d.rounded_rectangle([kx0, ky0, kx0 + kg, ky0 + ky], int(kg * .09),
                        fill=(8, 28, 46, 232), outline=(234, 179, 8, 215), width=max(2, int(gw * .006)))
    f_soru = yazitipi(int(kg * .22))
    dx, dy = ortala(d, kg, ky * .52, '?', f_soru)
    d.text((kx0 + dx, ky0 + dy), '?', font=f_soru, fill=(234, 179, 8, 255))
    # maske: beş harf yuvası, ikisi dolu
    n, mw = 5, kg * .11
    ara = mw * .26
    toplam = n * mw + (n - 1) * ara
    mx = cx - toplam / 2
    my = ky0 + ky * .64
    f_m = yazitipi(int(mw * .74))
    for j in range(n):
        x = mx + j * (mw + ara)
        dolu = j in (0, 3)
        d.line([(x, my + mw * .95), (x + mw, my + mw * .95)],
               fill=(234, 179, 8, 255) if dolu else (120, 150, 176, 220), width=max(2, int(mw * .11)))
        if dolu:
            harf = 'K' if j == 0 else 'E'
            ddx, ddy = ortala(d, mw, mw, harf, f_m)
            d.text((x + ddx, my + ddy - mw * .08), harf, font=f_m, fill=(240, 232, 206, 255))

    return ko.bitir(kapak, os.path.join(CIKTI, 'passaparola.jpg'))


if __name__ == '__main__':
    print(passaparola())
