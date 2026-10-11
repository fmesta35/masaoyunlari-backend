# -*- coding: utf-8 -*-
"""
LANGIRT KAPAĞI — tepeden görünen masa futbolu sahası, çubuklar ve top.

GÜVENLİ ALAN: kapaklar .game-thumb içinde `background-size:cover` ile
gösterilir; her zaman yalnız ortadaki %68 × %68'lik bant görünür
(bkz. tools/kapak-ortak.py). Bu yüzden ANA CİSİMLER (orta daire, iki takımın
adamları ve top) o banda sığar; kaleler kırpılabilir.

Kullanım: python3 tools/kapak-langirt.py
"""
import importlib.util, os
KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_s = importlib.util.spec_from_file_location('ko', os.path.join(KOK, 'tools', 'kapak-ortak.py'))
ko = importlib.util.module_from_spec(_s); _s.loader.exec_module(ko)
from PIL import Image, ImageDraw, ImageFilter

W, H = ko.W, ko.H
CIKTI = os.path.join(KOK, 'assets', 'covers')

# Motorun saha ölçüleri (langirt-engine.js ile aynı) — kapak da aynı düzeni
# gösterirse oyuncu kapaktaki sahayı masada birebir tanır.
SAHA = dict(sol=108, sag=892, ust=92, alt=508, kaleUst=220, kaleAlt=380)
CUBUKLAR = {
    'kirmizi': [(158, 1, 0), (340, 2, 86), (535, 5, 57), (760, 3, 82)],
    'mavi':    [(842, 1, 0), (660, 2, 86), (465, 5, 57), (240, 3, 82)],
}
# Her çubuğun kapaktaki yüksekliği (hareket hâlinde görünsün diye farklı)
YERLER = {'kirmizi': [300, 268, 318, 282], 'mavi': [312, 330, 276, 322]}


def langirt():
    # Zemin: koyu yeşil çuha (saha dışı ahşap kasa yerine sade bir fon)
    kapak = ko.cuha(renk=(14, 70, 42), isik=(0.5, 0.30), guc=0.95, tohum=61).convert('RGBA')
    # Motorun 1000×600 saha koordinatlarını kapağın tuvaline ölçekle
    ol = min(W / 1000.0, H / 600.0)
    ox, oy = (W - 1000 * ol) / 2, (H - 600 * ol) / 2
    def P(x, y): return (ox + x * ol, oy + y * ol)

    kat = Image.new('RGBA', kapak.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(kat, 'RGBA')

    # --- saha zemini
    d.rounded_rectangle([P(SAHA['sol'] - 34, SAHA['ust'] - 34),
                         P(SAHA['sag'] + 34, SAHA['alt'] + 34)],
                        int(22 * ol), fill=(12, 64, 38, 255))
    d.rectangle([P(SAHA['sol'], SAHA['ust']), P(SAHA['sag'], SAHA['alt'])],
                fill=(21, 122, 68, 255))
    # çim şeritleri
    sw = (SAHA['sag'] - SAHA['sol']) / 8.0
    for i in range(0, 8, 2):
        d.rectangle([P(SAHA['sol'] + i * sw, SAHA['ust']),
                     P(SAHA['sol'] + (i + 1) * sw, SAHA['alt'])], fill=(255, 255, 255, 12))
    # çizgiler
    cz = (255, 255, 255, 150)
    kal = max(2, int(3 * ol))
    d.rectangle([P(SAHA['sol'], SAHA['ust']), P(SAHA['sag'], SAHA['alt'])], outline=cz, width=kal)
    d.line([P(500, SAHA['ust']), P(500, SAHA['alt'])], fill=cz, width=kal)
    d.ellipse([P(500 - 62, 300 - 62), P(500 + 62, 300 + 62)], outline=cz, width=kal)
    # kaleler
    d.rectangle([P(SAHA['sol'] - 34, SAHA['kaleUst']), P(SAHA['sol'], SAHA['kaleAlt'])],
                fill=(0, 0, 0, 120))
    d.rectangle([P(SAHA['sag'], SAHA['kaleUst']), P(SAHA['sag'] + 34, SAHA['kaleAlt'])],
                fill=(0, 0, 0, 120))

    # --- çubuklar ve adamlar
    for taraf, renk, koyu in (('kirmizi', (226, 87, 76), (141, 46, 38)),
                              ('mavi', (59, 130, 246), (30, 77, 155))):
        for ci, (x, adet, aralik) in enumerate(CUBUKLAR[taraf]):
            merkez = YERLER[taraf][ci]
            # mil
            d.line([P(x, SAHA['ust'] - 32), P(x, SAHA['alt'] + 32)],
                   fill=(214, 220, 232, 170), width=max(2, int(5 * ol)))
            ilk = merkez - ((adet - 1) * aralik) / 2.0
            for k in range(adet):
                y = ilk + k * aralik
                r = 15 * ol
                # gölge + gövde + parlama
                d.ellipse([P(x - 15, y - 22 + 5), P(x + 15, y + 22 + 5)], fill=(0, 0, 0, 90))
                d.ellipse([P(x - 15, y - 22), P(x + 15, y + 22)], fill=koyu + (255,))
                d.ellipse([P(x - 13, y - 20), P(x + 13, y + 18)], fill=renk + (255,))
                d.ellipse([P(x - 9, y - 14), P(x - 1, y - 4)], fill=(255, 255, 255, 70))
            void = (ci, r)

    # --- top (orta sahanın biraz sağında, kırmızının ayağında)
    tx, ty = 575, 288
    d.ellipse([P(tx - 12 + 3, ty - 11 + 5), P(tx + 12 + 3, ty + 13 + 5)], fill=(0, 0, 0, 110))
    d.ellipse([P(tx - 12, ty - 12), P(tx + 12, ty + 12)], fill=(246, 248, 252, 255))
    d.ellipse([P(tx - 8, ty - 8), P(tx + 1, ty + 1)], fill=(255, 255, 255, 220))
    d.ellipse([P(tx - 4, ty + 1), P(tx + 6, ty + 9)], fill=(40, 48, 62, 180))

    kapak = Image.alpha_composite(kapak, kat)
    return ko.bitir(kapak, os.path.join(CIKTI, 'langirt.jpg'), vinyet=0.5)


if __name__ == '__main__':
    print(langirt())
