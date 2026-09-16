#!/usr/bin/env python3
"""Prepare shared brand assets from shared/originals/.

- Crops empty/mystery bookmark PNGs to their opaque bounding box.
- Derives a transparent-background Goodreads "g" glyph (original has beige).
- Prints body-rectangle metrics for the bookmark artwork (fractions of the
  cropped image) used by the layout spec in render.js.

Seasonal icons and filled category bookmarks come from ingest.py.

Run:  generator/.venv/bin/python generator/tools/prep_assets.py
"""
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "shared" / "originals"
DST = ROOT / "shared"
DST.mkdir(parents=True, exist_ok=True)


def crop_opaque(name, out):
    im = Image.open(SRC / name).convert("RGBA")
    a = np.asarray(im)[..., 3]
    ys, xs = np.where(a > 10)
    box = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    cropped = im.crop(box)
    cropped.save(DST / out)
    print(f"{out}: {cropped.size[0]}x{cropped.size[1]} (from {name} box {box})")
    return cropped


def body_metrics(im, label):
    """Body = the solid bookmark rectangle (excludes tassel and hang loop)."""
    a = np.asarray(im)[..., 3] > 128
    w, h = im.size
    colsum = a.sum(axis=0)
    body_cols = np.where(colsum > 0.7 * colsum.max())[0]
    sub = a[:, body_cols.min() : body_cols.max() + 1]
    rowsum = sub.sum(axis=1)
    body_rows = np.where(rowsum > 0.9 * sub.shape[1])[0]
    x0, x1 = int(body_cols.min()), int(body_cols.max())
    y0, y1 = int(body_rows.min()), int(body_rows.max())
    print(
        f"{label} body: x[{x0}..{x1}] y[{y0}..{y1}] "
        f"fractions: left={x0/w:.4f} width={(x1-x0+1)/w:.4f} "
        f"top={y0/h:.4f} height={(y1-y0+1)/h:.4f}"
    )


em = crop_opaque("Goodreads-empty-bookmark.png", "bookmark-empty.png")
body_metrics(em, "bookmark-empty")
my = crop_opaque("Goodreads-mystery-bookmark.png", "bookmark-mystery.png")
body_metrics(my, "bookmark-mystery")

# Logo: keep dark glyph, make the beige background transparent.
im = Image.open(SRC / "Goodreads-logo.png").convert("RGBA")
arr = np.asarray(im).astype(float)
rgb = arr[..., :3]
bg = rgb[0, 0]
dist = np.sqrt(((rgb - bg) ** 2).sum(axis=-1))
alpha = np.clip((dist - 20) / 100.0, 0, 1) * 255
out = arr.copy()
out[..., :3] = 35, 26, 20
out[..., 3] = alpha
glyph = Image.fromarray(out.astype(np.uint8))
a = np.asarray(glyph)[..., 3]
ys, xs = np.where(a > 10)
glyph = glyph.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
glyph.save(DST / "goodreads-logo-glyph.png")
print(f"goodreads-logo-glyph.png: {glyph.size[0]}x{glyph.size[1]}")
