# -*- coding: utf-8 -*-
"""
Satranç kapağı: assets/kaynak/satranc-at.png karesinden üretilir.

Bu kapak çizimle değil FOTOĞRAFTAN gelir; burada yapılan iş kadraj ve
pozlama. Parlaklık, gölgeleri ve orta tonları açan bir gamma eğrisiyle
artırılır (düz bir çarpan avizeleri ve altın işlemeleri patlatıyordu).
Kırpma 606x354 oranına göre yapılır ve ana cisimler — atın başı, tahta,
öndeki taşlar — her ekran genişliğinde görünen bantta kalır.

Kullanım:  python3 tools/kapak-satranc-fotograf.py
"""
import os
import numpy as np
from PIL import Image, ImageFilter, ImageEnhance

KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KAYNAK = os.path.join(KOK, 'assets', 'kaynak', 'satranc-at.png')
HEDEF = os.path.join(KOK, 'assets', 'covers', 'chess.jpg')
GEN, BOY = 606, 354
UST = 66                     # kırpmanın üst kenarı: atın tacı kadrajda kalsın

src = Image.open(KAYNAK).convert('RGB')
G, _ = src.size
a = np.asarray(src, np.float32) / 255.0
a = np.power(a, 0.845)                       # karanlık alanlar açılır
a = np.clip(a * 1.05, 0, 1)                  # genel parlaklık
im = Image.fromarray((a * 255).astype(np.uint8))

h = int(G / (GEN / BOY))
im = im.crop((0, UST, G, UST + h)).resize((GEN, BOY), Image.LANCZOS)
im = ImageEnhance.Contrast(im).enhance(1.03)
im = ImageEnhance.Color(im).enhance(1.04)
im = im.filter(ImageFilter.UnsharpMask(radius=1.3, percent=60, threshold=3))
im.save(HEDEF, quality=92, optimize=True, progressive=True)
print('yazildi', HEDEF, im.size)
