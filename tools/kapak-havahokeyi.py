# -*- coding: utf-8 -*-
"""
HAVA HOKEYİ KAPAĞI — tepeden görünen neon masa, iki tokmak ve disk.

GÜVENLİ ALAN: kapaklar .game-thumb içinde `background-size:cover` ile
gösterilir; her zaman yalnız ortadaki %68 × %68'lik bant görünür
(bkz. tools/kapak-ortak.py). Orta daire, iki tokmak ve disk o banda sığar;
kaleler kırpılabilir.

Kullanım: python3 tools/kapak-havahokeyi.py
"""
import importlib.util, os
KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_s = importlib.util.spec_from_file_location('ko', os.path.join(KOK, 'tools', 'kapak-ortak.py'))
ko = importlib.util.module_from_spec(_s); _s.loader.exec_module(ko)
from PIL import Image, ImageDraw, ImageFilter

W, H = ko.W, ko.H
CIKTI = os.path.join(KOK, 'assets', 'covers')

# Motorun masa ölçüleri (havahokeyi-engine.js ile aynı)
ALAN = dict(sol=48, sag=952, ust=48, alt=552)
KALE_UST, KALE_ALT = 205, 395
DISK_R, TOKMAK_R, DIREK_R = 20, 43, 13


def langirt_yok():
    pass


def havahokeyi():
    kapak = ko.cuha(renk=(10, 40, 66), isik=(0.5, 0.28), guc=0.92, tohum=71).convert('RGBA')
    ol = min(W / 1000.0, H / 600.0)
    ox, oy = (W - 1000 * ol) / 2, (H - 600 * ol) / 2
    def P(x, y): return (ox + x * ol, oy + y * ol)

    kat = Image.new('RGBA', kapak.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(kat, 'RGBA')

    # --- masa kasası ve buz yüzeyi
    d.rounded_rectangle([P(ALAN['sol'] - 26, ALAN['ust'] - 26), P(ALAN['sag'] + 26, ALAN['alt'] + 26)],
                        int(34 * ol), fill=(16, 38, 60, 255))
    d.rounded_rectangle([P(ALAN['sol'], ALAN['ust']), P(ALAN['sag'], ALAN['alt'])],
                        int(18 * ol), fill=(14, 53, 80, 255))
    # yarı saha renkleri
    d.rectangle([P(ALAN['sol'], ALAN['ust']), P(500, ALAN['alt'])], fill=(226, 87, 76, 28))
    d.rectangle([P(500, ALAN['ust']), P(ALAN['sag'], ALAN['alt'])], fill=(59, 130, 246, 28))
    # çizgiler
    cz = (180, 225, 255, 150)
    kal = max(2, int(3 * ol))
    d.rounded_rectangle([P(ALAN['sol'], ALAN['ust']), P(ALAN['sag'], ALAN['alt'])],
                        int(18 * ol), outline=cz, width=kal)
    d.line([P(500, ALAN['ust']), P(500, ALAN['alt'])], fill=cz, width=kal)
    d.ellipse([P(500 - 74, 300 - 74), P(500 + 74, 300 + 74)], outline=cz, width=kal)
    d.ellipse([P(500 - 16, 300 - 16), P(500 + 16, 300 + 16)], fill=cz)
    # kale ağızları
    d.rectangle([P(ALAN['sol'] - 22, KALE_UST), P(ALAN['sol'], KALE_ALT)], fill=(226, 87, 76, 225))
    d.rectangle([P(ALAN['sag'], KALE_UST), P(ALAN['sag'] + 22, KALE_ALT)], fill=(59, 130, 246, 225))
    # direkler
    for px, py in ((ALAN['sol'], KALE_UST), (ALAN['sol'], KALE_ALT),
                   (ALAN['sag'], KALE_UST), (ALAN['sag'], KALE_ALT)):
        d.ellipse([P(px - DIREK_R, py - DIREK_R), P(px + DIREK_R, py + DIREK_R)],
                  fill=(207, 227, 245, 255))

    kapak = Image.alpha_composite(kapak, kat)

    # --- tokmaklar (ko.kure ile hacimli)
    for (tx, ty, renk) in ((300, 300, (226, 87, 76)), (700, 258, (59, 130, 246))):
        cap = int(TOKMAK_R * 2 * ol)
        t = ko.kure(cap, renk, parlaklik=0.9, ambiyans=0.34)
        dt = ImageDraw.Draw(t, 'RGBA')
        ic = cap * 0.46
        dt.ellipse([(cap - ic) / 2, (cap - ic) / 2 - cap * .03,
                    (cap + ic) / 2, (cap + ic) / 2 - cap * .03],
                   fill=(renk[0] // 2, renk[1] // 2, renk[2] // 2, 230))
        x, y = P(tx, ty)
        kapak = ko.golge(kapak, t.split()[3], (int(x - cap / 2) + 5, int(y - cap / 2) + 11),
                         bulanik=14, koyuluk=150)
        kapak.paste(t, (int(x - cap / 2), int(y - cap / 2)), t)

    # --- disk (orta sahanın sağında, hareket izi ile)
    dx, dy = 574, 322
    iz = Image.new('RGBA', kapak.size, (0, 0, 0, 0))
    di = ImageDraw.Draw(iz, 'RGBA')
    for i, a in enumerate((70, 46, 26)):
        r = DISK_R * ol
        gx, gy = P(dx - 46 * (i + 1), dy - 16 * (i + 1))
        di.ellipse([gx - r, gy - r * .88, gx + r, gy + r * .88], fill=(236, 242, 250, a))
    kapak = Image.alpha_composite(kapak, iz.filter(ImageFilter.GaussianBlur(2.5)))

    cap = int(DISK_R * 2 * ol)
    disk = ko.kure(cap, (238, 243, 250), parlaklik=1.1, ambiyans=0.42)
    x, y = P(dx, dy)
    kapak = ko.golge(kapak, disk.split()[3], (int(x - cap / 2) + 4, int(y - cap / 2) + 9),
                     bulanik=10, koyuluk=150)
    kapak.paste(disk, (int(x - cap / 2), int(y - cap / 2)), disk)

    return ko.bitir(kapak, os.path.join(CIKTI, 'havahokeyi.jpg'), vinyet=0.5)


if __name__ == '__main__':
    print(havahokeyi())
