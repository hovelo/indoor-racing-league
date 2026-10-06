# Indoor Racing League

A handicapped, asynchronous virtual cycling league. Static 11ty site, scored at build time.

## Development

```sh
npm install
npm start        # builds from sample-data/ unless src/_data/league/ exists
npm test         # handicap model, with the worked example as a fixture
IRL_TODAY=2026-10-20 npm start   # pretend it's another day, to check event statuses
```

"Today" is the date in London (event windows are UK Monday–Sunday weeks). Statuses ("open", "days left") are fixed at build time, so the data repo's workflow also rebuilds the site daily just after midnight.

A production build (`CONTEXT=production`) fails rather than publish sample data: `scripts/fetch-data.sh` refuses without the deploy key or if the clone has no `leagues.yml`, and `standings.js` refuses if it ends up on `sample-data/` anyway.

To build with real data, clone the private data repo ([`mikestreety/indoor-racing-league-data`](https://github.com/mikestreety/indoor-racing-league-data)) into `src/_data/league/` (gitignored). Netlify does this at build time with a read-only deploy key (`DATA_DEPLOY_KEY`, see `scripts/fetch-data.sh`).

## Layout

- `lib/model.js` — the handicap model (pure function, see `02-handicap-model.md`)
- `src/_data/standings.js` — loads the YAML, runs the model, and returns template data through an allowlist of fields (so no raw time can reach a template), plus event labels ("Event 02", "Q", "E2")
- `lib/leagues.js` — validates `leagues.yml`: **fails the build** on a missing, short (under 10 characters), malformed or duplicate slug, or a duplicate league id
- `src/index.njk` — public overview
- `src/league.njk` → `/l/{slug}/`, `src/event.njk` → `/l/{slug}/{event}/` (noindex, no-referrer, never linked)
- `lib/clubs.js` — clubs (name, logo, Strava club) and which league belongs to which
- `src/club.njk` → `/clubs/{id}/` (public club page; leagues aren't listed)
- `lib/members.js` — validates `members.yml`: warns on a missing or invalid `strava_id` (Strava athlete ID) or a Strava name shared by two members, and **fails the build** on a duplicate `strava_id`. Only `display` ever reaches a template.
- `sample-data/` — fake riders for working without the private repo

## Clubs

The league is independent of any club; clubs are users of it. A league can belong to a club (`club:` in `leagues.yml`, an id from `clubs.yml`). The club's logo and name appear in the header, league hero and footer of league and event pages, with a Strava club button on the league page, a join reminder on open and upcoming events, and a Club row in the Rules section. Clubs never appear on the public homepage.

```yaml
# clubs.yml
- id: sample-cc
  name: Sample CC
  logo: sample-cc.svg        # in clubs/ next to clubs.yml, or a full https:// URL
  strava: sample-cc          # Strava club slug or ID, or the full club URL
  url: https://example.com/  # optional, linked from the club page and footer
  description: A made-up club.  # optional, shown on the club page
```

Every club gets a public page at `/clubs/{id}/` (logo, name, description, Strava and website buttons, how to take part). It doesn't list the club's leagues, because league URLs are secret. The header club badge on league and event pages links to it.

Local logos are copied to `/images/clubs/`. Square images work best; they're shown in a circle.

## Design

A "timing screen" look, independent of any club branding:

- Ink (`#14171c`) header, hero and footer over a pale ground (`#eef0eb`), white panels, one lime accent (`#d4f53c`, `--accent` in `src/css/style.css`).
- Barlow Condensed (uppercase) for headings and place numbers, Instrument Sans for body, JetBrains Mono for every time and points figure. All self-hosted from `@fontsource/*`, latin subset only.
- Route types: flat blue, rolling teal, climbing rust. Top three places get skewed "race number" blocks.
- Mobile first: breakpoints at 40rem and 64rem. On phones the event results table hides the points breakdown (gap, place, finish, bonus); the standings table scrolls sideways.

Routes can carry optional `distance_km` and `elevation_m` in `routes.yml`; they're shown on event pages and the events list.
