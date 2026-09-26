"""Compress generated demo photos into seed/media with stable filenames."""
from __future__ import annotations

import hashlib
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = Path(r"C:\Users\GliTc\.cursor\projects\d-Zlobin-zlobin-mvp-zlobin-beauty\assets")
DST = ROOT / "seed" / "media"
MAX_SIDE = 1600
QUALITY = 82


def save_jpeg(im: Image.Image, dest: Path, *, unique: bytes = b"") -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    work = im.convert("RGB")
    w, h = work.size
    scale = min(1.0, MAX_SIDE / max(w, h))
    if scale < 1:
        work = work.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)
    if unique:
        # Tiny unique crop so copied variants are distinct files, not byte-identical.
        n = int.from_bytes(hashlib.sha1(unique).digest()[:2], "big")
        dx, dy = n % 9, (n // 9) % 9
        if dx or dy:
            work = work.crop((dx, dy, work.width, work.height)).resize(work.size, Image.Resampling.LANCZOS)
    work.save(dest, "JPEG", quality=QUALITY, optimize=True, progressive=True)
    print(f"{dest.relative_to(ROOT)}  {dest.stat().st_size // 1024} KiB")


def copy(name: str, dest: Path, unique: str = "") -> None:
    src = SRC / name
    if not src.exists():
        raise SystemExit(f"missing source {src}")
    with Image.open(src) as im:
        save_jpeg(im, dest, unique=unique.encode())


def main() -> None:
    masters = {
        "seed-master-anna.jpg": "masters/master1.jpg",
        "seed-master-ivan.jpg": "masters/master2.jpg",
        "seed-master-olga.jpg": "masters/master3.jpg",
        "seed-master-dmitry.jpg": "masters/master4.jpg",
        "seed-master-elena.jpg": "masters/employee1.jpg",
        "seed-master-maria.jpg": "masters/mobile1.jpg",
        "seed-master-ksenia.jpg": "masters/premium1.jpg",
        "seed-master-svetlana.jpg": "masters/expired1.jpg",
        "seed-master-victoria.jpg": "masters/chain1.jpg",
    }
    salons = {
        "seed-salon-volkova.jpg": "salons/volkova.jpg",
        "seed-salon-belov.jpg": "salons/belov.jpg",
        "seed-salon-novikova.jpg": "salons/novikova.jpg",
        "seed-salon-orlov.jpg": "salons/orlov.jpg",
        "seed-salon-premium.jpg": "salons/premium.jpg",
    }
    services = {
        "seed-service-haircut.jpg": "services/стрижка.jpg",
        "seed-service-coloring.jpg": "services/окрашивание.jpg",
        "seed-service-care.jpg": "services/уход.jpg",
        "seed-service-menscut.jpg": "services/мужская-стрижка.jpg",
        "seed-service-styling.jpg": "services/укладка.jpg",
        "seed-service-manicure.jpg": "services/маникюр.jpg",
        "seed-service-pedicure.jpg": "services/педикюр.jpg",
        "seed-service-naildesign.jpg": "services/дизайн-ногтей.jpg",
        "seed-service-brows.jpg": "services/коррекция-бровей.jpg",
        "seed-service-lashes.jpg": "services/ламинирование-ресниц.jpg",
        "seed-service-home.jpg": "services/окрашивание-на-дому.jpg",
        "seed-service-workshop.jpg": "services/авторский-мастер-класс-по-окрашиванию.jpg",
    }
    articles = {
        "seed-article-coloring.jpg": "articles/coloring.jpg",
        "seed-article-care.jpg": "articles/care.jpg",
        "seed-article-home.jpg": "articles/home.jpg",
        "seed-article-styling.jpg": "articles/styling.jpg",
        "seed-article-salon.jpg": "articles/salon.jpg",
        "seed-article-inline.jpg": "articles/inline.jpg",
    }
    products = {
        "S1-LOR-MAJ-001": "seed-product-dye.jpg",
        "S1-LOR-OX-9": "seed-product-ox.jpg",
        "S1-LOR-AR-SH": "seed-product-shampoo.jpg",
        "S1-WEL-KOL-001": "seed-product-dye2.jpg",
        "S1-WEL-OR-SH": "seed-product-shampoo.jpg",
        "S1-OLA-N3": "seed-product-olaplex.jpg",
        "S1-EST-ESX-001": "seed-product-dye.jpg",
        "S1-EST-CTX-MSK": "seed-product-mask.jpg",
        "S1-LOR-PRO-FIB": "seed-product-ampoule.jpg",
        "S1-WEL-EIMI-SS": "seed-product-spray.jpg",
        "S1-OLA-N6": "seed-product-cream.jpg",
        "S2-LOR-DIA-001": "seed-product-toner.jpg",
        "S2-WEL-FUS-MSK": "seed-product-mask.jpg",
        "S2-EST-OTA-SH": "seed-product-shampoo.jpg",
        "S2-OLA-N4": "seed-product-olaplex.jpg",
    }

    for src, rel in {**masters, **salons, **services, **articles}.items():
        copy(src, DST / rel)

    # Shared fallbacks expected by older seed helpers.
    copy("seed-article-coloring.jpg", DST / "articles/cover.jpg")
    copy("seed-article-inline.jpg", DST / "articles/inline.jpg", unique="inline-alias")

    for sku, src in products.items():
        copy(src, DST / "products" / f"{sku}.jpg", unique=sku)

    print("done")


if __name__ == "__main__":
    main()
