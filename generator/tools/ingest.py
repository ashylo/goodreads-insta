#!/usr/bin/env python3
"""Pull render assets out of a saved Goodreads challenge page.

Reads challenges/<season>/source/ (Web Archive and/or extracted/images).
Never hits the network.

Writes:
  challenges/<season>/icon.png          seasonal mark (leaf, etc.)
  shared/bookmark-empty.png             if missing
  shared/bookmark-mystery.png           if missing
  challenges/<season>/bookmarks/filled-N.png
                                        unique category art not already stored

Usage:
  generator/.venv/bin/python generator/tools/ingest.py challenges/2026-fall
"""
from __future__ import annotations

import hashlib
import os
import plistlib
import re
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SHARED = ROOT / "shared"

SKIP_NAME = re.compile(
    r"badge|SeasonalChallenge|Icon|lettermark|wordmark", re.I
)


def md5_bytes(data: bytes) -> str:
    return hashlib.md5(data).hexdigest()


def md5_file(path: Path) -> str:
    return md5_bytes(path.read_bytes())


def crop_opaque(im: Image.Image) -> Image.Image:
    im = im.convert("RGBA")
    a = np.asarray(im)[..., 3]
    ys, xs = np.where(a > 10)
    if len(xs) == 0:
        return im
    box = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    return im.crop(box)


def save_png(im: Image.Image, dest: Path, overwrite: bool) -> bool:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and not overwrite:
        print(f"keep {dest.relative_to(ROOT)}")
        return False
    im.save(dest)
    print(f"wrote {dest.relative_to(ROOT)} ({im.size[0]}x{im.size[1]})")
    return True


def bright_ratio(im: Image.Image) -> float:
    arr = np.asarray(im.convert("RGBA"))
    a = arr[..., 3] > 10
    n = int(a.sum())
    if n == 0:
        return 0.0
    rgb = arr[..., :3]
    bright = (rgb.min(axis=-1) > 230) & a
    return float(bright.sum()) / n


def webarchive_path(challenge: Path) -> Path | None:
    archives = list(challenge.joinpath("source").glob("*.webarchive"))
    return archives[0] if archives else None


def load_webarchive(challenge: Path) -> dict | None:
    p = webarchive_path(challenge)
    if not p:
        return None
    with p.open("rb") as f:
        return plistlib.load(f)


def images_dir(challenge: Path) -> Path | None:
    extracted = challenge / "source" / "extracted" / "images"
    if extracted.is_dir() and any(extracted.glob("*.png")):
        return extracted
    data = load_webarchive(challenge)
    if not data:
        return None
    dest = challenge / "source" / "extracted" / "images"
    dest.mkdir(parents=True, exist_ok=True)
    n = 0
    for res in data.get("WebSubresources", []):
        url = res.get("WebResourceURL") or ""
        mime = res.get("WebResourceMIMEType") or ""
        blob = res.get("WebResourceData") or b""
        if not blob:
            continue
        ext = None
        if "png" in mime or url.lower().endswith(".png"):
            ext = ".png"
        elif "jpeg" in mime or url.lower().endswith((".jpg", ".jpeg")):
            ext = ".jpg"
        if not ext:
            continue
        name = Path(url.split("?", 1)[0]).name or f"img_{n}{ext}"
        if not name.endswith(ext):
            name = f"{name}{ext}"
        out = dest / name
        if not out.exists():
            out.write_bytes(blob)
            n += 1
    print(f"unpacked {n} images from webarchive → {dest.relative_to(ROOT)}")
    return dest if any(dest.glob("*.png")) else None


def find_icon(images: Path) -> Path | None:
    hits = sorted(images.glob("*SeasonalChallenge*"))
    if not hits:
        hits = sorted(p for p in images.glob("*.png") if "Icon" in p.name)
    return hits[0] if hits else None


def bookmark_groups(images: Path) -> list[tuple[str, list[Path], Image.Image, float]]:
    """Group tall, heavy PNGs by file hash. Returns (hash, paths, crop, bright)."""
    groups: dict[str, list[Path]] = defaultdict(list)
    for p in sorted(images.glob("*.png")):
        if SKIP_NAME.search(p.name):
            continue
        if p.stat().st_size < 80_000:
            continue
        groups[md5_file(p)].append(p)

    out = []
    for h, paths in groups.items():
        im = crop_opaque(Image.open(paths[0]))
        w, hgt = im.size
        if w >= hgt:
            continue
        out.append((h, paths, im, bright_ratio(im)))
    return out


def ingest_icon(challenge: Path) -> None:
    images = images_dir(challenge)
    if not images:
        print("no images in source/; skip icon")
        return
    src = find_icon(images)
    if not src:
        print("no seasonal icon in source/extracted/images")
        return
    save_png(crop_opaque(Image.open(src)), challenge / "icon.png", overwrite=True)


def ingest_bookmarks(challenge: Path) -> None:
    images = images_dir(challenge)
    if not images:
        print("no images in source/; skip bookmarks")
        return
    groups = bookmark_groups(images)
    if not groups:
        print("no bookmark PNGs found")
        return
    groups.sort(key=lambda g: g[3])  # dimmest extra-ink first = empty ribbon
    empty_h, empty_paths, empty_im, _ = groups[0]
    rest = groups[1:]

    save_png(empty_im, SHARED / "bookmark-empty.png", overwrite=False)

    mystery = [g for g in rest if len(g[1]) > 1]
    filled = [g for g in rest if len(g[1]) == 1]
    if mystery:
        save_png(mystery[0][2], SHARED / "bookmark-mystery.png", overwrite=False)
        filled.extend(mystery[1:])

    dest_dir = challenge / "bookmarks"
    dest_dir.mkdir(parents=True, exist_ok=True)
    known = {md5_file(p) for p in dest_dir.iterdir() if p.is_file()}
    n = 1
    while (dest_dir / f"filled-{n}.png").exists():
        n += 1
    for h, paths, im, _ in filled:
        if h in known:
            print(f"keep bookmarks (already have {paths[0].name})")
            continue
        dest = dest_dir / f"filled-{n}.png"
        save_png(im, dest, overwrite=True)
        known.add(h)
        n += 1


def main() -> None:
    if len(sys.argv) != 2:
        print("usage: ingest.py <challenges/YYYY-season>", file=sys.stderr)
        sys.exit(1)
    challenge = Path(sys.argv[1]).expanduser().resolve()
    if not challenge.is_dir():
        print(f"not a directory: {challenge}", file=sys.stderr)
        sys.exit(1)
    os.chdir(ROOT)
    ingest_icon(challenge)
    ingest_bookmarks(challenge)


if __name__ == "__main__":
    main()
