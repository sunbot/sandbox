"""Intake Grid icon: a 3x3 grid filling up — sage cells, a softer row still to go, one warm apricot cell.
Drawn at 4x and downsampled for smooth edges. Colors are the app's Hearth tokens."""
import sys
from PIL import Image, ImageDraw, ImageFilter

out = sys.argv[1]
BG, BG2 = (18, 21, 20), (30, 36, 33)
SAGE, APRICOT = (134, 191, 174), (227, 161, 120)
SS = 4

def grid(size, area, mono=False, alpha_bg=False):
    """Draw the grid centred in `area` (fraction of size) on a canvas of `size`."""
    W = size * SS
    img = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    g = W * area
    gap = g * 0.085
    cell = (g - 2 * gap) / 3
    x0 = y0 = (W - g) / 2
    r = cell * 0.26
    pattern = [['s', 's', 's'], ['s', 's', 'a'], ['l', 'l', 'l']]
    for row in range(3):
        for col in range(3):
            k = pattern[row][col]
            if mono:
                color = (255, 255, 255, 255 if k != 'l' else 110)
            else:
                color = SAGE + (255,) if k == 's' else APRICOT + (255,) if k == 'a' else SAGE + (85,)
            x, y = x0 + col * (cell + gap), y0 + row * (cell + gap)
            d.rounded_rectangle([x, y, x + cell, y + cell], radius=r, fill=color)
    return img.resize((size, size), Image.LANCZOS)

def background(size, rounded=False):
    W = size * SS
    img = Image.new('RGBA', (W, W), BG + (255,))
    # soft top glow, like the app's Today screen
    glow = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([W * 0.05, -W * 0.45, W * 0.95, W * 0.55], fill=(134, 191, 174, 34))
    glow = glow.filter(ImageFilter.GaussianBlur(W * 0.12))
    img = Image.alpha_composite(img, glow)
    img = img.resize((size, size), Image.LANCZOS)
    if rounded:
        mask = Image.new('L', (size * SS, size * SS), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, size * SS, size * SS], radius=size * SS * 0.22, fill=255)
        img.putalpha(mask.resize((size, size), Image.LANCZOS))
    return img

# App icon (iOS/legacy): full bleed, the OS rounds the corners.
icon = Image.alpha_composite(background(1024), grid(1024, 0.56))
icon.convert('RGB').save(f'{out}/icon.png')
# Android adaptive: background + foreground inside the 66% safe zone, and a monochrome themed-icon layer.
background(512).convert('RGB').save(f'{out}/android-icon-background.png')
grid(512, 0.46).save(f'{out}/android-icon-foreground.png')
grid(432, 0.46, mono=True).save(f'{out}/android-icon-monochrome.png')
# Splash mark (shown on the dark splash background) and favicon (rounded, works on light or dark tabs).
grid(1024, 0.42).save(f'{out}/splash-icon.png')
Image.alpha_composite(background(48, rounded=True), grid(48, 0.62)).save(f'{out}/favicon.png')
# Preview sheet
prev = Image.new('RGB', (1200, 420), (40, 44, 42))
prev.paste(icon.resize((300, 300)), (40, 60))
adaptive = Image.alpha_composite(background(512), grid(512, 0.46)).resize((300, 300))
m = Image.new('L', (300, 300), 0); ImageDraw.Draw(m).ellipse([0, 0, 300, 300], fill=255)
prev.paste(adaptive, (400, 60), m)
mono = Image.new('RGBA', (300, 300), (60, 70, 66, 255)); mono = Image.alpha_composite(mono, grid(300, 0.40, mono=True))
prev.paste(mono, (760, 60), m)
prev.save(f'{out}/preview.png')
print('ok')
