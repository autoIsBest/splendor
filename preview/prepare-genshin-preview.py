"""Generate review atlas only; originals and runtime files remain unchanged."""
from pathlib import Path
import sys
from PIL import Image, ImageDraw, ImageFont

source = Path(sys.argv[1])
out = Path(__file__).resolve().parent / 'thumbs' / 'themes'
out.mkdir(parents=True, exist_ok=True)
# Individually chosen square crops in source pixels, keeping faces above center.
entries = [
    ('温迪', (160, 255, 920, 1015)),
    ('钟离', (160, 285, 920, 1045)),
    ('雷电将军', (165, 355, 925, 1115)),
    ('纳西妲', (185, 480, 1025, 1320)),
    ('芙宁娜', (160, 280, 1000, 1120)),
    ('玛薇卡', (15, 265, 735, 985)),
    ('旅行者-空', (140, 270, 980, 1110)),
    ('旅行者-荧', (140, 285, 980, 1125)),
    ('派蒙', (65, 0, 665, 600)),
]
size = 256
atlas = Image.new('RGB', (size * 3, size * 3), '#e9e8e3')
for i, (name, box) in enumerate(entries):
    im = Image.open(source / (name + '.png')).convert('RGBA')
    bg = Image.new('RGBA', im.size, '#e9e8e3')
    bg.alpha_composite(im)
    tile = bg.convert('RGB').crop(box).resize((size, size), Image.Resampling.LANCZOS)
    atlas.paste(tile, ((i % 3) * size, (i // 3) * size))
atlas.save(out / 'genshin-review-atlas.jpg', quality=65, optimize=True)
review = Image.new('RGB', (804, 930), '#17273e')
draw = ImageDraw.Draw(review)
font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 19)
for i, (name, _) in enumerate(entries):
    x, y = 12 + (i % 3) * 264, 12 + (i // 3) * 306
    review.paste(atlas.crop(((i % 3)*size, (i // 3)*size, (i % 3+1)*size, (i // 3+1)*size)), (x, y))
    draw.text((x + 8, y + 266), name.replace('-', '·'), font=font, fill='#fff0cc')
review.save(out / 'genshin-crop-review.jpg', quality=88, optimize=True)
image_bytes = (out / 'genshin-review-atlas.jpg').stat().st_size
print(f'Atlas: {image_bytes} bytes; Base64 estimate: {(image_bytes + 2)//3*4} bytes')
print(out / 'genshin-crop-review.jpg')
