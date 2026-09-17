# goodreads-insta

Local generator for 4:5 Instagram collages of a Goodreads reading challenge. Layout lives in `generator/render.js`. It always draws from spec + JSON, never by painting over a previous PNG.

Your challenge pages, book covers, renders, and Goodreads brand art stay on your machine (see `.gitignore`). This repo is the tool.

## Setup

macOS only: Node, Chrome from `/Applications` (headless screenshot; override with `CHROME`), Python 3 with Pillow + numpy for ingest. Image sizes come from `sips`.

```
python3 -m venv generator/.venv
generator/.venv/bin/pip install pillow numpy
node generator/tools/init.js 2026-fall
```

`init` only creates empty folders (and a starter `config.json` if you pass a season). It does not download anything.

1. Save the Goodreads challenge page as a **Web Archive** into `challenges/<season>/source/`.
2. The Goodreads **g** is SVG on the site, not in the archive. Put the beige PNG at `shared/originals/Goodreads-logo.png` and run `generator/.venv/bin/python generator/tools/prep_assets.py` once.
3. `generator/.venv/bin/python generator/tools/ingest.py challenges/<season>`  
   Reads the archive from disk (no CDN). Fills `icon.png`, empty/mystery ribbons in `shared/` if missing, and unique filled bookmarks.
4. Edit `config.json`, drop jackets in `covers/`.
5. `node generator/render.js challenges/<season>`

Keep `"fontPack": "atkinson"` (OFL, in the repo). Proprietary Goodreads fonts stay off this path.

## JSON

Paths are relative to the challenge folder.

```json
{
  "title": "Fall Challenge",
  "fontPack": "atkinson",
  "cover": { "lockedStyle": "wash" },
  "seasonalIcon": { "src": "icon.png", "height": 330, "right": 66, "top": 110 },
  "units": [
    { "type": "empty", "caption": "Named Shelf",
      "cover": { "src": "covers/book.jpg" } },
    { "type": "empty", "caption": "Still choosing",
      "cover": { "placeholder": { "color": "#C2A36B" } } },
    { "type": "mystery", "caption": "Mystery",
      "cover": { "placeholder": {} } }
  ]
}
```

Three cover states: jacket file, open slot (`?` on a color plate), locked mystery (cool-gray ribbon + wash). Skip **Page-Turner / Speed Reader / Book Boss** — they are progress counts, not categories; the renderer drops them.

Filled ribbon later: `"type": "filled", "bookmarkSrc": "bookmarks/oprahs-picks.png"`. Unique category art lives in the season folder; empty/mystery stay in `shared/`.

Starter file: `generator/examples/config.json`.

## License

Code is [MIT](LICENSE). Bundled Atkinson Hyperlegible Next and Montserrat are SIL OFL (see `generator/fonts/`).
