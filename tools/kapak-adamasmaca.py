# -*- coding: utf-8 -*-
"""
ADAM ASMACA KAPAĞI — ahşap sehpa, ip ve altında açılmış harf kutucukları.

GÜVENLİ ALAN: kapaklar .game-thumb içinde `background-size:cover` ile
gösterilir; kutunun oranı 1.17–2.50 arasında gezdiği için her zaman yalnız
ortadaki %68 × %68'lik bant görünür (bkz. tools/kapak-ortak.py). Bu yüzden
ANA CİSİMLER (sehpa + "ASMACA" kutucukları) tamamen o banda sığar;
kenarlardaki soluk harfler yalnız derinlik içindir, kırpılabilir.

Kullanım: python3 tools/kapak-adamasmaca.py
"""
import importlib.util, os, random, math
KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_s = importlib.util.spec_from_file_location('ko', os.path.join(KOK, 'tools', 'kapak-ortak.py'))
ko = importlib.util.module_from_spec(_s); _s.loader.exec_module(ko)
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = ko.W, ko.H
CIKTI = os.path.join(KOK, 'assets', 'covers')

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


def kutu(gen, harf, acik=True):
    """Tek harf kutucuğu: açıksa harf görünür, kapalıysa boş ve koyu."""
    yuk = int(gen * 1.24)
    im = Image.new('RGBA', (gen, yuk + int(gen * .16)), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    r = int(gen * .16)
    if acik:
        d.rounded_rectangle([0, int(gen * .10), gen - 1, yuk + int(gen * .14)], r, fill=(84, 56, 22, 255))
        d.rounded_rectangle([0, 0, gen - 1, yuk], r, fill=(63, 42, 107, 255))
        d.rounded_rectangle([int(gen * .08), int(gen * .07), gen - int(gen * .08), int(gen * .40)],
                            int(r * .7), fill=(96, 70, 150, 180))
        d.rounded_rectangle([0, yuk - int(gen * .12), gen - 1, yuk], int(gen * .06), fill=(240, 162, 60, 255))
        f = yazitipi(int(gen * .64))
        dx, dy = ortala(d, gen, yuk, harf, f)
        d.text((dx, dy - gen * .04), harf, font=f, fill=(248, 234, 198, 255))
    else:
        d.rounded_rectangle([0, 0, gen - 1, yuk], r, fill=(30, 26, 50, 235))
        d.rounded_rectangle([0, yuk - int(gen * .12), gen - 1, yuk], int(gen * .06), fill=(74, 68, 104, 255))
    return im


def ip_ve_sehpa(kat, G, kalinlik, renk=(150, 104, 52, 255)):
    """Ahşap sehpa (L biçimi) ve ucunda ilmek."""
    d = ImageDraw.Draw(kat, 'RGBA')
    gw, gh = G[2] - G[0], G[3] - G[1]
    taban_y = G[1] + gh * .92
    dikme_x = G[0] + gw * .11
    kol_x = G[0] + gw * .30
    tepe_y = G[1] + gh * .03
    k = int(kalinlik)
    # taban
    d.line([(dikme_x - gw * .08, taban_y), (dikme_x + gw * .09, taban_y)], fill=renk, width=k, joint='curve')
    # dikme
    d.line([(dikme_x, taban_y), (dikme_x, tepe_y)], fill=renk, width=k)
    # kol
    d.line([(dikme_x - k * .4, tepe_y), (kol_x, tepe_y)], fill=renk, width=k)
    # destek payandası
    d.line([(dikme_x, tepe_y + gh * .14), (dikme_x + gw * .10, tepe_y)], fill=renk, width=int(k * .62))
    # ip + ilmek
    ip = (226, 206, 168, 255)
    ip_alt = tepe_y + gh * .13
    d.line([(kol_x, tepe_y), (kol_x, ip_alt)], fill=ip, width=int(k * .34))
    r = gw * .028
    d.ellipse([kol_x - r, ip_alt - r * .4, kol_x + r, ip_alt + r * 1.5],
              outline=ip, width=int(k * .32))
    return (kol_x, ip_alt + r * 1.5), taban_y


def adamasmaca():
    # zemin: derin mor gece çuhası (oyun kartının rengiyle aynı aile)
    kapak = ko.cuha(renk=(46, 34, 86), isik=(0.52, 0.26), guc=1.02, tohum=31).convert('RGBA')
    G = ko.guvenli_kutu()
    cx = (G[0] + G[2]) / 2
    gw, gh = G[2] - G[0], G[3] - G[1]
    rng = random.Random(20261011)

    # ---- arka planda soluk harfler (derinlik) — güvenli bandın DIŞINDA
    f_arka = yazitipi(int(gw * .17))
    d0 = ImageDraw.Draw(kapak, 'RGBA')
    for h in 'ÇĞİÖŞÜABKMRZ':
        x = rng.choice([rng.uniform(-gw * .04, G[0] - gw * .02),
                        rng.uniform(G[2] - gw * .02, W - gw * .10)])
        y = rng.uniform(-gh * .05, H - gh * .22)
        d0.text((x, y), h, font=f_arka, fill=(255, 255, 255, 26))

    # ---- sehpa + ip (ana cisim, güvenli bandın solunda)
    katman = Image.new('RGBA', kapak.size, (0, 0, 0, 0))
    ip_ucu, taban_y = ip_ve_sehpa(katman, G, gw * .028)
    kapak = ko.golge(kapak, katman.split()[3], (10, 16), bulanik=20, koyuluk=150)
    kapak = Image.alpha_composite(kapak, katman)

    # ---- ipin ucunda baş + gövde (çizgi adam)
    d = ImageDraw.Draw(kapak, 'RGBA')
    beyaz = (236, 232, 252, 255)
    kal = int(gw * .016)
    bx, by = ip_ucu
    r = gw * .048
    d.ellipse([bx - r, by, bx + r, by + 2 * r], outline=beyaz, width=kal)
    govde_ust = by + 2 * r
    govde_alt = govde_ust + gh * .26
    d.line([(bx, govde_ust), (bx, govde_alt)], fill=beyaz, width=kal)
    d.line([(bx, govde_ust + gh * .05), (bx - gw * .075, govde_ust + gh * .17)], fill=beyaz, width=kal)
    d.line([(bx, govde_ust + gh * .05), (bx + gw * .075, govde_ust + gh * .17)], fill=beyaz, width=kal)
    d.line([(bx, govde_alt), (bx - gw * .065, govde_alt + gh * .18)], fill=beyaz, width=kal)
    d.line([(bx, govde_alt), (bx + gw * .065, govde_alt + gh * .18)], fill=beyaz, width=kal)

    # ---- sağda "ASMACA" kutucukları: üçü açık, ikisi kapalı
    kelime = [('A', True), ('S', True), ('M', False), ('A', True), ('C', False), ('A', True)]
    kg = int(gw * .081)
    ara = int(kg * .15)
    toplam = len(kelime) * kg + (len(kelime) - 1) * ara
    x0 = int(G[2] - toplam)                        # sağa yaslı ama bant içinde
    y0 = int(G[1] + gh * .54)
    for i, (h, acik) in enumerate(kelime):
        t = kutu(kg, h, acik).rotate(rng.uniform(-1.8, 1.8), resample=Image.BICUBIC, expand=True)
        x = x0 + i * (kg + ara)
        kapak = ko.golge(kapak, t.split()[3], (x + 5, y0 + 12), bulanik=12, koyuluk=150)
        kapak.paste(t, (x, y0), t)

    # ---- kutucukların üstünde kalan canlar (üç kalp)
    d = ImageDraw.Draw(kapak, 'RGBA')
    f_can = yazitipi(int(kg * .52))
    can_y = int(y0 - kg * .88)
    for i in range(6):
        renk = (231, 76, 60, 245) if i < 3 else (255, 255, 255, 52)
        d.text((x0 + i * (kg * .70), can_y), '♥', font=f_can, fill=renk)

    return ko.bitir(kapak, os.path.join(CIKTI, 'adamasmaca.jpg'))


if __name__ == '__main__':
    print(adamasmaca())
