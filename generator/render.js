#!/usr/bin/env node
/**
 * Goodreads reading-challenge Instagram post generator.
 *
 * Renders a 4:5 post from a JSON config via HTML/CSS + headless Chrome.
 * All layout math lives here. Every render is produced from scratch
 * from the spec — never by editing a previous output image.
 *
 * Usage:
 *   node generator/tools/init.js 2026-fall
 *   node generator/render.js challenges/2026-fall
 *   node generator/render.js generator/experiments/sample-v1.json
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const GEN_DIR = __dirname;
const REPO_ROOT = path.resolve(GEN_DIR, "..");
const SHARED_DIR = path.join(REPO_ROOT, "shared");
const CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let CHALLENGE_DIR = REPO_ROOT;

// Progress-count achievements, not category slots. Never drawn.
const QUANTITATIVE_CAPTIONS = new Set([
  "Page-Turner",
  "Speed Reader",
  "Book Boss",
]);

const FONT_PACKS = {
  atkinson: {
    title: {
      family: "Atkinson Hyperlegible Next",
      fallback: '"Helvetica Neue", sans-serif',
      weight: 600,
      size: 100,
      letterSpacing: "-0.03em",
    },
    caption: {
      family: "Atkinson Hyperlegible Next",
      fallback: '"Helvetica Neue", sans-serif',
      weight: 500,
      letterSpacing: "-0.015em",
    },
    faces: [
      {
        family: "Atkinson Hyperlegible Next",
        src: "AtkinsonHyperlegibleNext-SemiBold.otf",
        weight: 600,
      },
      {
        family: "Atkinson Hyperlegible Next",
        src: "AtkinsonHyperlegibleNext-Medium.otf",
        weight: 500,
      },
    ],
  },
  goodreads: {
    title: {
      family: "Copernicus",
      fallback: '"Libre Baskerville", Georgia, serif',
      weight: 600,
      size: 106,
      letterSpacing: "0",
    },
    caption: {
      family: "Proxima Nova",
      fallback: 'Montserrat, Arial, sans-serif',
      weight: 400,
      letterSpacing: "0",
    },
    faces: [
      {
        family: "Copernicus",
        src: "GalaxieCopernicus-Semibold.woff2",
        weight: 600,
      },
      {
        family: "Proxima Nova",
        src: "ProximaNova-Regular.woff",
        weight: 400,
      },
      {
        family: "Proxima Nova",
        src: "ProximaNova-Semibold.woff",
        weight: 600,
      },
    ],
  },
};

// ---------------------------------------------------------------- geometry
// Bookmark artwork metrics, fractions of the cropped (opaque-bbox) PNGs.
// Measured by tools/prep_assets.py; empty + mystery share these within ~0.2%.
const BM = {
  aspect: 583 / 1384, // width / height of the cropped artwork (incl. tassel)
  bodyLeft: 0.2367,   // solid rectangle (no tassel) left edge, frac of width
  bodyWidth: 0.7633,
  bodyTop: 0.0491,    // hang-loop excluded
  bodyHeight: 0.9458,
  bodyBottom: 0.9949, // bodyTop + bodyHeight
};

function defaults(fontPackName = "atkinson") {
  const pack = FONT_PACKS[fontPackName];
  if (!pack) throw new Error(`unknown fontPack: ${fontPackName}`);
  // Reference scale: canvas 2160x2700 (2x the 1080x1350 ground-truth JPGs).
  return {
    canvas: { width: 2160, height: 2700 },
    background: "#FFFFFF",
    fontPack: fontPackName,
    header: {
      height: 244,
      background: "#FAF8F6", // rgb(250,248,246) — Goodreads page token
      // Goodreads token 0 1px 2px rgba(0,0,0,.15), scaled to canvas px so it
      // matches the visible shadow band in the ground-truth JPGs.
      shadow: "0 4px 10px rgba(0, 0, 0, 0.15)",
      textColor: "#1E1915", // Goodreads charcoal
      titleFontSize: pack.title.size,
      titleLetterSpacing: pack.title.letterSpacing,
      logo: { height: 116, left: 96 },
    },
    grid: {
      perRow: 3,
      columnPitch: 480,
      // Vertical packing: outer pads are the air. Bookmark height is fitted
      // to whatever remains so we don't end up with empty fields.
      // Original 1080×1350 JPG, ×2: padTop 106, padBottom ~134, bmH 512.
      // That sample is tight against the header; we add a bit of outer air
      // and let bookmarks take the rest (~495 instead of 360).
      padTop: 168,
      padBottom: 184,
      bookmarkHeight: 497,   // locked after the air/size pass
      rowGap: 140,           // caption block → next bookmark
      captionGap: 56,        // bookmark bottom → caption ink top
      captionFontSize: 52,
      captionColor: "#1E1915",
      captionFontWeight: pack.caption.weight,
      captionLetterSpacing: pack.caption.letterSpacing,
    },
    cover: {
      // Relative to the bookmark BODY (no tassel / hang loop):
      //   inside   = how much of the body the jacket covers (was 0.5)
      //   overhang = how much sticks out past the body right edge (kept 0.5)
      //   width    = (inside + overhang) × body width
      //   height   = width × hardcoverRatio, or native jacket aspect
      //   bottom   = bookmark artwork bottom
      inside: 2 / 3,
      overhang: 0.5,
      hardcoverRatio: 3 / 2,
      radius: 18,
      shadow: "0 4px 18px rgba(0, 0, 0, 0.22)",
      lockedStyle: "wash", // dash | wash
    },
  };
}

function deepMerge(base, over) {
  if (over === undefined) return base;
  if (Array.isArray(over) || typeof over !== "object" || over === null)
    return over;
  const out = { ...base };
  for (const k of Object.keys(over)) out[k] = deepMerge(base?.[k], over[k]);
  return out;
}

function fontFile(packName, filename) {
  if (packName === "goodreads")
    return path.join(SHARED_DIR, "fonts", "vendor", filename);
  return path.join(GEN_DIR, "fonts", filename);
}

function resolveAsset(p) {
  if (path.isAbsolute(p)) return p;
  const tries = [
    path.join(CHALLENGE_DIR, p),
    path.join(SHARED_DIR, p),
    path.join(GEN_DIR, p),
  ];
  for (const t of tries) if (fs.existsSync(t)) return t;
  return path.join(CHALLENGE_DIR, p);
}

function fileUrl(p) {
  return "file://" + resolveAsset(p);
}

function resolvePath(p) {
  return resolveAsset(p);
}

const _imgSizeCache = new Map();
function imageSize(p) {
  const abs = resolvePath(p);
  if (_imgSizeCache.has(abs)) return _imgSizeCache.get(abs);
  const out = execFileSync(
    "sips",
    ["-g", "pixelWidth", "-g", "pixelHeight", abs],
    { encoding: "utf8" }
  );
  const w = +/pixelWidth:\s*(\d+)/.exec(out)[1];
  const h = +/pixelHeight:\s*(\d+)/.exec(out)[1];
  const size = { width: w, height: h };
  _imgSizeCache.set(abs, size);
  return size;
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

// ------------------------------------------------------------------ layout
function layout(cfg) {
  const { canvas, header, grid } = cfg;
  const rows = [];
  for (let i = 0; i < cfg.units.length; i += grid.perRow)
    rows.push(cfg.units.slice(i, i + grid.perRow));
  const nRows = rows.length;

  const capBlockH = grid.captionGap + grid.captionFontSize * 1.05;
  const padTop = grid.padTop ?? 168;
  const padBottom = grid.padBottom ?? 184;
  let bmH = grid.bookmarkHeight;
  if (!bmH) {
    const avail =
      canvas.height - header.height - padTop - padBottom -
      nRows * capBlockH - (nRows - 1) * grid.rowGap;
    bmH = avail / nRows;
    grid.bookmarkHeight = bmH;
  }
  const bmW = Math.round(bmH * BM.aspect);
  const bodyW = Math.round(bmW * BM.bodyWidth);
  const inside = cfg.cover.inside ?? 2 / 3;
  const overhang = cfg.cover.overhang ?? 0.5;
  const coverW = Math.round(bodyW * (inside + overhang));
  const coverH = Math.round(
    coverW * (cfg.cover.hardcoverRatio || 1.5)
  );
  const unitH = bmH + capBlockH;
  const gridTop = header.height + padTop;

  const items = [];
  rows.forEach((row, ri) => {
    const unitTop = Math.round(gridTop + ri * (unitH + grid.rowGap));
    const rowW = (row.length - 1) * grid.columnPitch;
    row.forEach((unit, ci) => {
      const cellCX = canvas.width / 2 - rowW / 2 + ci * grid.columnPitch;
      const blockW = bodyW * (1 + overhang);
      const bodyLeft = Math.round(cellCX - blockW / 2);
      const bmLeft = Math.round(bodyLeft - BM.bodyLeft * bmW);
      const item = {
        unit,
        bmLeft,
        bmTop: unitTop,
        bmW,
        bmH,
        cellCX,
        captionTop: unitTop + bmH + grid.captionGap,
      };
      if (unit.cover) {
        let w = coverW;
        let h = coverH;
        if (unit.cover.src) {
          const { width: iw, height: ih } = imageSize(unit.cover.src);
          h = Math.round(w * (ih / iw));
        }
        item.cover = {
          left: Math.round(bodyLeft + (1 - inside) * bodyW),
          width: w,
          height: h,
          top: unitTop + bmH - h,
        };
      }
      items.push(item);
    });
  });
  return items;
}

// -------------------------------------------------------------------- html
function coverKind(unit) {
  if (unit.cover?.src) return "image";
  if (unit.cover?.kind) return unit.cover.kind;
  if (unit.cover?.placeholder?.kind) return unit.cover.placeholder.kind;
  if (unit.type === "mystery") return "locked"; // no longlist yet
  return "open"; // named slot, book not picked
}

function coverHtml(unit, c, cfg) {
  const box =
    `left:${c.left}px;top:${c.top}px;width:${c.width}px;height:${c.height}px;` +
    `border-radius:${cfg.cover.radius}px;`;
  const kind = coverKind(unit);
  if (kind === "image") {
    return (
      `<img class="cover" style="${box}box-shadow:${cfg.cover.shadow};" ` +
      `src="${fileUrl(unit.cover.src)}">`
    );
  }
  if (kind === "locked") {
    const variant = cfg.cover.lockedStyle === "wash" ? "wash" : "dash";
    return `<div class="cover locked ${variant}" style="${box}"></div>`;
  }
  const ph = unit.cover.placeholder || {};
  const bg = ph.color || "#A8968C";
  const markSize = Math.round(c.height * 0.46);
  return (
    `<div class="cover placeholder" style="${box}box-shadow:${cfg.cover.shadow};background:${bg};">` +
    `<span class="mark" style="font-size:${markSize}px;">?</span>` +
    `</div>`
  );
}

function dropQuantitative(units) {
  const kept = [];
  for (const u of units) {
    if (QUANTITATIVE_CAPTIONS.has(u.caption)) {
      console.warn(`skipping quantitative achievement: ${u.caption}`);
      continue;
    }
    kept.push(u);
  }
  return kept;
}

function faceCss(pack, packName) {
  const faces = pack.faces
    .map(
      (f) => `  @font-face {
    font-family: "${f.family}";
    src: url("${fileUrl(fontFile(packName, f.src))}");
    font-weight: ${f.weight};
    font-style: normal;
  }`
    )
    .join("\n");
  return `${faces}
  @font-face {
    font-family: "Montserrat";
    src: url("${fileUrl(path.join(GEN_DIR, "fonts", "Montserrat-var.ttf"))}");
    font-weight: 100 900;
  }`;
}

function buildHtml(cfg) {
  const { canvas, header, grid } = cfg;
  const pack = FONT_PACKS[cfg.fontPack || "atkinson"];
  const items = layout(cfg);

  const unitHtml = items
    .map((it) => {
      const u = it.unit;
      const src =
        u.type === "mystery" && !it.cover
          ? path.join(SHARED_DIR, "bookmark-mystery.png")
          : u.type === "filled"
            ? u.bookmarkSrc
            : path.join(SHARED_DIR, "bookmark-empty.png");
      const mono = u.type === "mystery" ? " mono" : "";
      let h =
        `<img class="bookmark${mono}" src="${fileUrl(src)}" ` +
        `style="left:${it.bmLeft}px;top:${it.bmTop}px;` +
        `width:${it.bmW}px;height:${it.bmH}px;">`;
      if (it.cover) h += coverHtml(u, it.cover, cfg);
      h +=
        `<div class="caption" style="left:${it.cellCX}px;` +
        `top:${it.captionTop}px;">${esc(u.caption)}</div>`;
      return h;
    })
    .join("\n");

  const icon = cfg.seasonalIcon;
  const iconW = icon.width || "auto";
  const titleStack = `"${pack.title.family}", ${pack.title.fallback}`;
  const captionStack = `"${pack.caption.family}", ${pack.caption.fallback}`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
${faceCss(pack, cfg.fontPack || "atkinson")}
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${canvas.width}px; height: ${canvas.height}px; }
  body { background: ${cfg.background}; position: relative;
         overflow: hidden; }
  .header {
    position: absolute; left: 0; top: 0; width: 100%;
    height: ${header.height}px;
    background: ${header.background};
    box-shadow: ${header.shadow};
    z-index: 2;
  }
  .logo {
    position: absolute; left: ${header.logo.left}px;
    top: ${(header.height - header.logo.height) / 2}px;
    height: ${header.logo.height}px; z-index: 3;
  }
  .title {
    position: absolute; left: 50%; top: ${header.height / 2}px;
    transform: translate(-50%, -50%);
    font-family: ${titleStack};
    font-weight: ${pack.title.weight};
    font-size: ${header.titleFontSize}px;
    letter-spacing: ${header.titleLetterSpacing || "0"};
    color: ${header.textColor};
    white-space: nowrap; z-index: 3;
  }
  .icon {
    position: absolute; right: ${icon.right}px; top: ${icon.top}px;
    height: ${icon.height}px; width: ${iconW}; z-index: 4;
  }
  .bookmark { position: absolute; z-index: 1; }
  .bookmark.mono { filter: url(#bm-cool-gray); }
  .cover { position: absolute; z-index: 2; object-fit: fill; }
  .cover.placeholder {
    display: flex; align-items: center; justify-content: center;
    text-align: center; overflow: hidden;
  }
  .cover.placeholder span.mark {
    font-family: ${titleStack};
    font-weight: ${pack.title.weight};
    color: rgba(255, 255, 255, 0.92);
    line-height: 1;
    transform: translateY(-0.04em);
  }
  .cover.locked {
    box-sizing: border-box;
    box-shadow: none;
  }
  .cover.locked.dash {
    background: transparent;
    border: 5px dashed rgba(72, 76, 84, 0.48);
  }
  .cover.locked.wash {
    background: rgba(108, 112, 120, 0.36);
    border: none;
  }
  .caption {
    position: absolute; transform: translateX(-50%);
    font-family: ${captionStack};
    font-weight: ${grid.captionFontWeight};
    font-size: ${grid.captionFontSize}px;
    letter-spacing: ${grid.captionLetterSpacing};
    color: ${grid.captionColor};
    line-height: 1; white-space: nowrap; z-index: 1;
  }
</style></head>
<body>
  <svg width="0" height="0" style="position:absolute">
    <filter id="bm-cool-gray" color-interpolation-filters="sRGB">
      <feColorMatrix type="matrix" values="
        0.18 0.42 0.07 0 0.22
        0.18 0.44 0.07 0 0.23
        0.20 0.46 0.12 0 0.28
        0    0    0    1 0"/>
    </filter>
  </svg>
  <div class="header"></div>
  <img class="logo" src="${fileUrl(path.join(SHARED_DIR, "goodreads-logo-glyph.png"))}">
  <div class="title">${esc(cfg.title)}</div>
  <img class="icon" src="${fileUrl(icon.src)}">
${unitHtml}
</body></html>`;
}

function nextIterationPng(dir, stem) {
  const unversioned = path.join(dir, `${stem}.png`);
  const unversionedHtml = path.join(dir, `${stem}.html`);
  const v1 = path.join(dir, `${stem}-v1.png`);
  if (!fs.existsSync(v1) && (fs.existsSync(unversioned) || fs.existsSync(unversionedHtml))) {
    if (fs.existsSync(unversioned)) fs.renameSync(unversioned, v1);
    if (fs.existsSync(unversionedHtml))
      fs.renameSync(unversionedHtml, path.join(dir, `${stem}-v1.html`));
  }
  let n = 1;
  while (fs.existsSync(path.join(dir, `${stem}-v${n}.png`))) n++;
  return path.join(dir, `${stem}-v${n}.png`);
}

function resolveInput(arg) {
  const abs = path.resolve(arg);
  if (!fs.existsSync(abs)) throw new Error(`not found: ${arg}`);
  if (fs.statSync(abs).isDirectory()) {
    return {
      challengeDir: abs,
      cfgPath: path.join(abs, "config.json"),
      stem: path.basename(abs),
      outDir: path.join(abs, "output"),
    };
  }
  const dir = path.dirname(abs);
  if (path.basename(abs) === "config.json") {
    return {
      challengeDir: dir,
      cfgPath: abs,
      stem: path.basename(dir),
      outDir: path.join(dir, "output"),
    };
  }
  return {
    challengeDir: dir,
    cfgPath: abs,
    stem: path.basename(abs).replace(/\.json$/, ""),
    outDir: path.join(dir, "output"),
  };
}

// -------------------------------------------------------------------- main
function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("usage: node render.js <challenge-dir|config.json> [output.png]");
    process.exit(1);
  }
  const input = resolveInput(arg);
  CHALLENGE_DIR = input.challengeDir;
  const user = JSON.parse(fs.readFileSync(input.cfgPath, "utf8"));
  const cfg = deepMerge(defaults(user.fontPack || "atkinson"), user);
  if (!cfg.title || !cfg.units || !cfg.seasonalIcon)
    throw new Error("config needs: title, seasonalIcon, units");
  cfg.units = dropQuantitative(cfg.units);
  if (!cfg.units.length) throw new Error("no units left after dropping quantitative achievements");

  fs.mkdirSync(input.outDir, { recursive: true });
  const outPng = path.resolve(process.argv[3] || nextIterationPng(input.outDir, input.stem));
  const outHtml = outPng.replace(/\.png$/i, ".html");
  fs.writeFileSync(outHtml, buildHtml(cfg));

  execFileSync(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      `--window-size=${cfg.canvas.width},${cfg.canvas.height}`,
      "--default-background-color=FFFFFFFF",
      "--virtual-time-budget=10000",
      `--screenshot=${outPng}`,
      "file://" + outHtml,
    ],
    { stdio: ["ignore", "ignore", "inherit"] }
  );
  console.log(`rendered ${outPng} (${cfg.canvas.width}x${cfg.canvas.height})`);
  console.log(`html kept at ${outHtml}`);
  console.log(
    `bookmarkHeight=${cfg.grid.bookmarkHeight.toFixed(1)} padTop=${cfg.grid.padTop} padBottom=${cfg.grid.padBottom}`
  );
}

main();
