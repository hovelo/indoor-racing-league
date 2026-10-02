# Hovélo Indoor Racing League

A handicapped, asynchronous virtual cycling league, run by [Hovélo](https://hovelo.co.uk/). Static 11ty site, scored at build time.

## Development

```sh
npm install
npm start        # builds from sample-data/ unless src/_data/league/ exists
npm test         # handicap model, with the worked example as a fixture
```

To build with real data, clone the private data repo into `src/_data/league/` (gitignored).

## Layout

- `lib/model.js` — the handicap model (pure function, see `02-handicap-model.md`)
- `src/_data/standings.js` — loads the YAML, runs the model, strips raw times, returns template data
- `src/index.njk` — public overview
- `src/league.njk` → `/l/{slug}/`, `src/event.njk` → `/l/{slug}/{event}/` (noindex, no-referrer, never linked)
- `sample-data/` — fake riders for working without the private repo

## Design

Takes its look from hovelo.co.uk: Pacifico headings (turquoise `#2ea287` for page titles, red `#db2a44` for section titles), Helvetica body in dark blue `#0c2d3c`, blue `#017db3` links and buttons, `#c5d4df` rules, `#eaf0f3` feature bands, and the turquoise-over-red stripe at the top. The logo in `src/images/` is Hovélo's own. Pacifico is self-hosted from `@fontsource/pacifico`.
