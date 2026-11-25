# Da_'s UmaTools — static website

A single static site bundling five Umamusume: Pretty Derby companion tools
plus Torena's Notes, a section for published game insights.
No backend, no build step, no uploads — everything runs in the browser.

## Layout

```
site/
├── index.html            Hub landing page linking all tools
├── assets/
│   ├── theme.css         Shared design system: unified warm-dark palette,
│   │                     shared navbar styles, per-tool variable remapping
│   └── nav.js            Injects the standard navbar (brand + tool links,
│                         active state) into every page
├── eyeuma/               EyeUma — screenshot → trained_chara_data OCR
│   └── vendor/           tesseract.js + wasm core (vendored, offline-capable)
├── completionist/        Completionist Tracker — trophy progress + screenshot scanning
├── umatree/              UmaTree — roster, inheritance loops, run simulator
├── tt-tracker/           Uma Team Trials Tracker — performance ratings to spot & replace underperformers
├── master-browser/       Master Browser — wiki over a user-supplied master.mdb
│   ├── vendor/           sql.js (SQLite compiled to WebAssembly)
│   ├── data.js           Decoder/catalog constants (generated from the Python backend)
│   ├── wiki.js           Client-side port of the FastAPI wiki/generic/catalog services
│   └── app.js            SPA UI (unchanged apart from the local API + file-load gate)
└── torena-notes/         Torena's Notes — published insights into the game
    ├── notes/            One .md file per note (rendered client-side)
    └── app.js            Note index (NOTES array) + minimal markdown renderer
```

## Publishing a Torena's note

1. Drop the markdown file into `torena-notes/notes/`.
2. Add an entry to the `NOTES` array at the top of `torena-notes/app.js`
   (id, file, title, tag, date, summary). It appears on the notes index
   and is readable at `torena-notes/index.html#<id>`.

## Shared design system

Every page loads `assets/theme.css` **after** its own stylesheet and
`assets/nav.js` (deferred). Together they provide:

- One warm-dark palette with a green accent across all five tools and the hub
  (each tool's CSS variables are remapped onto shared `--ut-*` tokens).
- A standard sticky navbar with the site brand and links to every tool; the
  current tool is highlighted. Tool-specific header bars sit directly below it
  (sticky tool headers are offset by the navbar height).
- Consistent fonts, focus rings, scrollbars and header styling.

When refreshing a tool from its source project, keep the two `assets/` includes
in its `index.html` and re-apply any per-tool overrides in `theme.css`.

## Master Browser: bring your own master.mdb

The original `uma_master_browser` project served data from a FastAPI backend.
Here the entire backend (wiki_service / generic_service / catalog / raw tables)
is ported to JavaScript (`wiki.js`) and runs against sql.js in the tab:

- The user drops/selects their `master.mdb`; it is parsed locally by sql.js.
- **Nothing is uploaded.** The file bytes are cached in IndexedDB so the database
  survives closing the tab and auto-loads on the next visit. The header shows the
  cached file's size, version (if the mdb carries a version table), file date and
  cache date; the load gate offers "Use cached copy" / "Forget cached copy".
- All previous features work: search + suggestions, trainees/characters/support
  cards/skills/races/items/NPCs/Team Trials builds, 16 generic categories,
  table catalog and the raw table browser.

## Serving

Any static file server works, e.g.:

```
cd site
python -m http.server 8080
# → http://localhost:8080
```

For deployment, upload the `site/` folder as-is to GitHub Pages, Netlify,
Cloudflare Pages, etc. Paths are relative, so it also works under a subpath
(e.g. `https://user.github.io/UmaTools/`).

Note: `.wasm` files must be served with `Content-Type: application/wasm`
(most hosts do this automatically).

## Provenance / updating

| Site folder      | Source project              | Notes |
|------------------|-----------------------------|-------|
| `eyeuma/`        | `eye_uma/web`               | tesseract vendored from `node_modules`; worker/core/lang paths made relative in `app.js` |
| `completionist/` | `uma_completionist_tracker` | copied as-is (already fully client-side) |
| `umatree/`       | `uma_tree/web` + `uma_tree/img` | portrait path changed `../img/` → `img/` |
| `tt-tracker/`    | `uma_tt_tracker`            | static files only; state lives in localStorage |
| `master-browser/`| `uma_master_browser`        | UI copied; backend ported to `wiki.js`; `data.js` generated from the Python constants |

To refresh a tool after its source project changes, re-copy its static files
and re-apply the small path patches noted above.
