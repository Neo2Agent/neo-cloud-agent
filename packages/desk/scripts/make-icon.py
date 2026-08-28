#!/usr/bin/env python3
from pathlib import Path
import sys

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    raise SystemExit("Pillow is required to draw the Desk icon")

dest = Path(sys.argv[1] if len(sys.argv) > 1 else "icon.png")
size = 512
img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)
draw.rounded_rectangle((28, 28, 484, 484), radius=108, fill=(17, 17, 16, 255))
draw.rounded_rectangle((86, 150, 426, 362), radius=36, outline=(250, 250, 248, 255), width=18)
try:
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 210)
except OSError:
    font = ImageFont.load_default()
draw.text((256, 248), "N", fill=(250, 250, 248, 255), font=font, anchor="mm")
dest.parent.mkdir(parents=True, exist_ok=True)
img.save(dest)
print(dest)
