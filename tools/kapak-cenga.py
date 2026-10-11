# -*- coding: utf-8 -*-
"""
CENGA KAPAĞI — ahşap kule ve yarı çekilmiş taş.

GÜVENLİ ALAN: kapaklar .game-thumb içinde `background-size:cover` ile
gösterilir; her zaman yalnız ortadaki %68 × %68'lik bant görünür
(bkz. tools/kapak-ortak.py). Bu yüzden ANA CİSİM (kule ve çekilen taş)
tamamen o banda sığar.

Kullanım: python3 tools/kapak-cenga.py
"""
import importlib.util, os, random
KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_s = importlib.util.spec_from_file_location('ko', os.path.join(KOK, 'tools', 'kapak-ortak.py'))
ko = importlib.util.module_from_spec(_s); _s.loader.exec_module(ko)
from PIL import Image, ImageDraw, ImageFilter

W, H = ko.W, ko.H
CIKTI = os.path.join(KOK, 'assets', 'covers')


def tas(gen, yuk, koyu=False, vurgu=False):
    """Tek bir cenga taşı: ahşap yüz, üstte ışık, altta gölge payı."""
    im = Image.new('RGBA', (int(gen), int(yuk)), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if vurgu:   ust, alt = (243, 208, 138), (200, 150, 78)
    elif koyu:  ust, alt = (169, 118, 63), (112, 74, 36)
    else:       ust, alt = (201, 145, 85), (140, 94, 48)
    r = max(2, int(min(gen, yuk) * .16))
    d.rounded_rectangle([0, 0, gen - 1, yuk - 1], r, fill=alt)
    d.rounded_rectangle([0, 0, gen - 1, yuk - max(2, int(yuk * .18))], r, fill=ust)
    # damar
    rng = random.Random(int(gen * 7 + yuk * 13))
    for _ in range(3):
        y = rng.uniform(yuk * .2, yuk * .72)
        d.line([(gen * .10, y), (gen * .90, y + rng.uniform(-1, 1))],
               fill=(alt[0], alt[1], alt[2], 110), width=max(1, int(yuk * .06)))
    return im


def cenga():
    """Klasik Cenga görünümü: katlar dönüşümlü olarak 3 DİKEY dilim ve
    1 YATAY blok (lehimli üç dilim) biçiminde, birbirine YAPIŞIK dizilir;
    böylece yığın kule gibi okunur, dağınık tuğla gibi değil."""
    # zemin: sıcak kahve-gri çuha
    kapak = ko.cuha(renk=(58, 40, 26), isik=(0.52, 0.26), guc=1.04, tohum=53).convert('RGBA')
    G = ko.guvenli_kutu()
    cx, cy = (G[0] + G[2]) / 2, (G[1] + G[3]) / 2
    gw, gh = G[2] - G[0], G[3] - G[1]

    KAT = 13
    kule_g = gw * 0.40                 # kulenin eni (ayak izi)
    kat_y = gh * 0.064                 # bir katın yüksekliği
    tas_g = kule_g / 3
    x0 = cx - kule_g / 2
    taban = cy + gh * 0.44

    eksik = {(2, 0), (4, 2), (5, 1), (7, 0), (9, 2)}   # çekilmiş taşlar
    cekilen = (6, 2)                                   # yarı dışarı çekilmiş taş

    for k in range(KAT):
        dikey = (k % 2 == 0)           # çift katlar: 3 dikey dilim
        y = taban - (k + 1) * kat_y
        for sl in range(3):
            if (k, sl) in eksik:
                continue
            vurgu = (k, sl) == cekilen
            if dikey:
                # taşın UCU bize dönük: dar ve kat boyu kadar yüksek
                w, hh = tas_g - 1, kat_y - 1
                x = x0 + sl * tas_g
                dx, dy = (tas_g * 0.52, 0) if vurgu else (0, 0)
            else:
                # taş BOYUNCA bize dönük: kat eni kadar geniş, üçte bir yüksek
                w, hh = kule_g - 1, kat_y / 3 - 0.6
                x = x0
                y2 = y + sl * (kat_y / 3)
                dx, dy = (0, 0)
                t = tas(w, hh, koyu=True, vurgu=vurgu)
                kapak = ko.golge(kapak, t.split()[3], (int(x) + 3, int(y2) + 5),
                                 bulanik=7, koyuluk=120)
                kapak.paste(t, (int(x), int(y2)), t)
                continue
            t = tas(w, hh, koyu=False, vurgu=vurgu)
            kapak = ko.golge(kapak, t.split()[3], (int(x + dx) + 3, int(y + dy) + 5),
                             bulanik=7, koyuluk=120)
            kapak.paste(t, (int(x + dx), int(y + dy)), t)

    # zemin gölgesi: kule bir masanın üstünde dursun
    g = Image.new('RGBA', kapak.size, (0, 0, 0, 0))
    dg = ImageDraw.Draw(g)
    dg.ellipse([x0 - kule_g * .34, taban - kat_y * .20,
                x0 + kule_g + kule_g * .34, taban + kat_y * 1.25], fill=(0, 0, 0, 135))
    kapak = Image.alpha_composite(kapak, g.filter(ImageFilter.GaussianBlur(gw * .020)))

    return ko.bitir(kapak, os.path.join(CIKTI, 'cenga.jpg'))


if __name__ == '__main__':
    print(cenga())
