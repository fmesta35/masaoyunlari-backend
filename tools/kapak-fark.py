# -*- coding: utf-8 -*-
"""
FARK BULMACA KAPAĞI — oyunun kendi sahnesinden iki kopya ve bir büyüteç.

Kapak, oyunun GERÇEK çizimini kullanır: fark-sahneler.js'teki plaj sahnesi
node ile SVG'ye döküldü ve burada PNG'ye çevrildi. Böylece kapak ile oyun
birbirinden ayrı düşemez.

GÜVENLİ ALAN: kapaklar .game-thumb içinde `background-size:cover` ile
gösterilir; her zaman yalnız ortadaki %68 × %68'lik bant görünür. Bu yüzden
iki kopya ve büyüteç o banda sığar.

Kullanım: python3 tools/kapak-fark.py   (önce sahneler PNG'ye dökülür)
"""
import importlib.util, os, subprocess, json, tempfile
KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_s = importlib.util.spec_from_file_location('ko', os.path.join(KOK, 'tools', 'kapak-ortak.py'))
ko = importlib.util.module_from_spec(_s); _s.loader.exec_module(ko)
from PIL import Image, ImageDraw, ImageFilter

W, H = ko.W, ko.H
CIKTI = os.path.join(KOK, 'assets', 'covers')
GEC = os.environ.get('GV_FARK_PNG_DIZIN', '')   # önceden dökülmüş PNG'ler


def sahne_resmi(ad, varsayilan_boy=(800, 520)):
    """Döküm varsa onu aç, yoksa düz bir yer tutucu üret."""
    yol = os.path.join(GEC, ad) if GEC else ''
    if yol and os.path.exists(yol):
        return Image.open(yol).convert('RGBA')
    im = Image.new('RGBA', varsayilan_boy, (20, 70, 110, 255))
    d = ImageDraw.Draw(im)
    d.rectangle([0, varsayilan_boy[1] * .62, varsayilan_boy[0], varsayilan_boy[1]],
                fill=(240, 205, 130, 255))
    return im


def cerceve(im, gen, kose=18, kenar=(255, 255, 255, 60)):
    """Resmi verilen genişliğe ölçekle, yuvarlak köşeli çerçeveye otur."""
    oran = im.height / im.width
    boy = int(gen * oran)
    im = im.resize((int(gen), boy), Image.LANCZOS)
    maske = Image.new('L', im.size, 0)
    ImageDraw.Draw(maske).rounded_rectangle([0, 0, im.size[0] - 1, im.size[1] - 1], kose, fill=255)
    out = Image.new('RGBA', im.size, (0, 0, 0, 0))
    out.paste(im, (0, 0), maske)
    d = ImageDraw.Draw(out)
    d.rounded_rectangle([0, 0, im.size[0] - 1, im.size[1] - 1], kose, outline=kenar, width=4)
    return out


def fark():
    kapak = ko.cuha(renk=(18, 48, 73), isik=(0.5, 0.3), guc=1.0, tohum=83).convert('RGBA')
    G = ko.guvenli_kutu()
    cx, cy = (G[0] + G[2]) / 2, (G[1] + G[3]) / 2
    gw, gh = G[2] - G[0], G[3] - G[1]

    a = cerceve(sahne_resmi('plaj-a.png'), gw * 0.52)
    b = cerceve(sahne_resmi('plaj-b.png'), gw * 0.52)

    # İki kopya hafif eğik, üst üste binen kartlar gibi
    ay = a.rotate(-3.2, resample=Image.BICUBIC, expand=True)
    by = b.rotate(2.6, resample=Image.BICUBIC, expand=True)
    ax = int(cx - gw * 0.52)
    azy = int(cy - ay.height * 0.58)
    bx = int(cx - gw * 0.02)
    bzy = int(cy - by.height * 0.38)
    for im, x, y in ((ay, ax, azy), (by, bx, bzy)):
        kapak = ko.golge(kapak, im.split()[3], (x + 8, y + 16), bulanik=18, koyuluk=160)
        kapak.paste(im, (x, y), im)

    # Farkı işaretleyen halkalar
    d = ImageDraw.Draw(kapak, 'RGBA')
    for (hx, hy, r, renk) in ((cx - gw * .30, cy - gh * .20, gw * .055, (46, 204, 113, 255)),
                              (cx + gw * .26, cy + gh * .10, gw * .050, (46, 204, 113, 255)),
                              (cx + gw * .10, cy + gh * .30, gw * .045, (231, 76, 60, 235))):
        d.ellipse([hx - r, hy - r, hx + r, hy + r], outline=renk, width=max(3, int(gw * .010)))

    # Büyüteç
    bx2, by2 = cx + gw * .30, cy - gh * .30
    rr = gw * .11
    cam = Image.new('RGBA', kapak.size, (0, 0, 0, 0))
    dc = ImageDraw.Draw(cam, 'RGBA')
    dc.ellipse([bx2 - rr, by2 - rr, bx2 + rr, by2 + rr], fill=(200, 235, 255, 60),
               outline=(236, 244, 252, 255), width=max(4, int(gw * .016)))
    dc.line([(bx2 + rr * .70, by2 + rr * .70), (bx2 + rr * 1.75, by2 + rr * 1.75)],
            fill=(236, 244, 252, 255), width=max(6, int(gw * .024)))
    kapak = ko.golge(kapak, cam.split()[3], (7, 13), bulanik=12, koyuluk=150)
    kapak = Image.alpha_composite(kapak, cam)

    return ko.bitir(kapak, os.path.join(CIKTI, 'fark.jpg'), vinyet=0.55)


if __name__ == '__main__':
    print(fark())
