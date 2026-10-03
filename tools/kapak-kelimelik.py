# -*- coding: utf-8 -*-
"""
KELİMELİK KAPAĞI — ahşap ıstaka üzerinde Türkçe harf taşları.

GÜVENLİ ALAN: kapaklar .game-thumb içinde `background-size:cover` ile
gösterilir; kutunun oranı 1.17–2.50 arasında gezdiği için her zaman
yalnız ortadaki %68 × %68'lik bant görünür (bkz. tools/kapak-ortak.py).
Bu yüzden "KELİME" yazan taş dizisi ve ıstaka TAMAMEN o banda sığar;
kenarlardaki dağınık taşlar yalnızca derinlik içindir, kırpılabilir.
Kullanım: python3 tools/kapak-kelimelik.py
"""
import importlib.util, os, sys, math, random
# kapak-ortak.py adında tire olduğu için normal import ile alınamaz
# (tools/kapak-uret.py ile aynı yöntem).
KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_s = importlib.util.spec_from_file_location('ko', os.path.join(KOK, 'tools', 'kapak-ortak.py'))
ko = importlib.util.module_from_spec(_s); _s.loader.exec_module(ko)
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = ko.W, ko.H
CIKTI = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'covers')

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


def tas(gen, harf, puan, aci=0.0):
    """Tek bir harf taşı: fildişi yüz, sıcak kenar, harf + puan."""
    k = int(gen * 1.18)
    im = Image.new('RGBA', (gen, k), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    r = int(gen * 0.14)
    # yan (kalınlık) ve üst yüz
    d.rounded_rectangle([0, int(gen * .12), gen - 1, k - 1], r, fill=(188, 152, 96, 255))
    d.rounded_rectangle([0, 0, gen - 1, k - int(gen * .16)], r, fill=(243, 226, 189, 255))
    # üst parlama
    d.rounded_rectangle([int(gen * .07), int(gen * .05), gen - int(gen * .07), int(gen * .34)],
                        int(r * .7), fill=(252, 241, 214, 160))
    f = yazitipi(int(gen * .56))
    kutu = d.textbbox((0, 0), harf, font=f)
    d.text(((gen - (kutu[2] - kutu[0])) / 2 - kutu[0],
            (k - int(gen * .16) - (kutu[3] - kutu[1])) / 2 - kutu[1] - int(gen * .03)),
           harf, font=f, fill=(44, 32, 14, 255))
    fp = yazitipi(int(gen * .24))
    p = str(puan)
    kp = d.textbbox((0, 0), p, font=fp)
    d.text((gen - int(gen * .14) - (kp[2] - kp[0]), k - int(gen * .34) - (kp[3] - kp[1])),
           p, font=fp, fill=(92, 70, 34, 235))
    if aci:
        im = im.rotate(aci, resample=Image.BICUBIC, expand=True)
    return im


def kelimelik():
    # zemin: koyu mor-lacivert çuha (oyunun kart rengiyle aynı aile)
    kapak = ko.cuha(renk=(58, 40, 86), isik=(0.46, 0.30), guc=1.05, tohum=7).convert('RGBA')
    G = ko.guvenli_kutu()
    cx, cy = (G[0] + G[2]) / 2, (G[1] + G[3]) / 2
    gw = G[2] - G[0]

    rng = random.Random(20261003)
    # arka planda dağınık taşlar (derinlik) — güvenli bandın DIŞINDA
    for _ in range(14):
        g = int(gw * rng.uniform(.085, .115))
        h, p = rng.choice([('A', 1), ('E', 1), ('K', 1), ('R', 1), ('M', 2), ('T', 1),
                           ('Ş', 4), ('Z', 4), ('Ğ', 8), ('J', 10), ('O', 2), ('N', 1)])
        t = tas(g, h, p, rng.uniform(-28, 28))
        x = int(rng.choice([rng.uniform(0, G[0] - g * .4), rng.uniform(G[2] - g * .6, W - g)]))
        y = int(rng.uniform(0, H - g * 1.3))
        kapak = ko.golge(kapak, t.split()[3], (x + 7, y + 11), bulanik=14, koyuluk=120)
        gecici = t.copy(); gecici.putalpha(t.split()[3].point(lambda v: int(v * .72)))
        kapak.paste(gecici, (x, y), gecici)

    # ---- ortada ahşap ıstaka + KELİME dizisi (ana cisim, güvenli bantta)
    kelime = [('K', 1), ('E', 1), ('L', 1), ('İ', 1), ('M', 2), ('E', 1)]
    g = int(gw * 0.133)
    bosluk = int(g * .10)
    toplam = len(kelime) * g + (len(kelime) - 1) * bosluk
    x0 = int(cx - toplam / 2)
    ist_y = int(cy + g * .52)

    # ıstaka tahtası
    ist = Image.new('RGBA', (int(toplam + g * .9), int(g * .58)), (0, 0, 0, 0))
    di = ImageDraw.Draw(ist)
    di.rounded_rectangle([0, 0, ist.width - 1, ist.height - 1], int(g * .16), fill=(96, 62, 28, 255))
    di.rounded_rectangle([0, 0, ist.width - 1, int(ist.height * .62)], int(g * .16), fill=(132, 88, 42, 255))
    di.rounded_rectangle([int(g * .12), int(ist.height * .12), ist.width - int(g * .12), int(ist.height * .40)],
                         int(g * .10), fill=(72, 46, 20, 255))
    ix = int(cx - ist.width / 2)
    kapak = ko.golge(kapak, ist.split()[3], (ix + 6, ist_y + 14), bulanik=20, koyuluk=150)
    kapak.paste(ist, (ix, ist_y), ist)

    for i, (h, p) in enumerate(kelime):
        t = tas(g, h, p, rng.uniform(-1.6, 1.6))
        x = x0 + i * (g + bosluk)
        y = int(cy - g * .62)
        kapak = ko.golge(kapak, t.split()[3], (x + 5, y + 13), bulanik=13, koyuluk=150)
        kapak.paste(t, (x, y), t)

    # ---- bonus kareleri: üstte ince bir şerit (oyunu tanıtır)
    bk = int(gw * .062)
    renkler = [((192, 83, 63), 'K³'), ((138, 90, 176), 'K²'),
               ((47, 159, 168), 'H³'), ((58, 110, 168), 'H²')]
    tg = len(renkler) * bk + (len(renkler) - 1) * int(bk * .22)
    bx = int(cx - tg / 2)
    by = int(cy - g * 1.62)
    d = ImageDraw.Draw(kapak, 'RGBA')
    f = yazitipi(int(bk * .42))
    for i, (renk, et) in enumerate(renkler):
        x = bx + i * (bk + int(bk * .22))
        d.rounded_rectangle([x, by, x + bk, by + bk], int(bk * .18), fill=renk + (242,))
        kutu = d.textbbox((0, 0), et, font=f)
        d.text((x + (bk - (kutu[2] - kutu[0])) / 2 - kutu[0],
                by + (bk - (kutu[3] - kutu[1])) / 2 - kutu[1]), et, font=f, fill=(255, 255, 255, 240))

    return ko.bitir(kapak, os.path.join(CIKTI, 'kelimelik.jpg'))


if __name__ == '__main__':
    print(kelimelik())
