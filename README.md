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
- `lib/sources/` — results sources. `standings.js` gathers rows from every source (the event YAML and FIT uploads), merges them (fastest per member, event and segment, warning on duplicates across sources) and hands the model plain `results` rows. A source is `{ name, load(ctx) → rows }`; each row is a YAML `results` row plus `event` and `source` (screenshot | fit | manual). The model doesn't know about sources.
- `lib/leagues.js` — validates `leagues.yml`: **fails the build** on a missing, short (under 10 characters), malformed or duplicate slug, or a duplicate league id
- `lib/fit/`, `lib/submit/`, `netlify/functions/submit/` — FIT uploads (below)
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

## FIT uploads

Riders can submit a ride by uploading the FIT file Zwift saves for it, instead of waiting for a leaderboard screenshot. Each member has a personal link; there are no logins.

1. The rider opens `/l/{slug}/submit/?m={member}&t={token}` (noindex, no links, no analytics, covered by the `/l/*` headers) and uploads one `.fit` file, at most 5 MB.
2. `netlify/functions/submit/` (`POST /api/submit`) checks the token, parses the file with `fit-file-parser`, takes the ride date from the first record (London date), and finds the league's events and challenges whose window contains it. None: rejected ("events can't be ridden late").
3. Each segment on the event's route is timed from the start and end points (`lib/fit/timing.js`, the method in `06-data-formats.md`): a pass of `start` within 25 m, then the first pass of `end` 90–110% of `length_m` further on, interpolated between samples; on a lapped route the fastest lap. Times are rounded **up** to whole seconds, like Strava. A ride with no time on the event's `score_segment` is rejected.
4. Only the derived rows (`event, member, segment, time, date, source: fit`) are stored, in the Netlify Blobs store `submissions`, keyed `{league}/{event}/{member}/{segment}` and holding the fastest so far. A SHA-256 of each file (`hashes/{sha256}`) rejects re-uploads. The file itself, positions, power and heart rate are never stored.
5. If a time improved, the function calls the build hook. The rider sees their own times on the page; the public pages stay places and points only.

At deploy time the `netlify/plugins/submissions` build plugin reads the store into `.submissions/submissions.json` (Blobs credentials are only set automatically in plugins and functions, not in the build command), and `scripts/build-submit-config.js` writes the function's league config (slugs, member ids, event windows, segment points and lengths; no names). A production build fails if the store can't be read, rather than publish standings without uploaded results. Locally and with sample data, `sample-data/submissions.json` is used instead.

Segments need `length_m` in `routes.yml` (from Strava or VeloViewer) as well as `start` and `end`; without it a segment is skipped with a warning, and an event whose score segment can't be timed can't take uploads.

### Environment variables (Netlify: Site configuration → Environment variables)

| Variable | Scope | What it's for |
|---|---|---|
| `SUBMIT_SECRET` | Functions | Signs the upload links: `token = HMAC-SHA256("{league id}:{member id}", SUBMIT_SECRET)`, first 16 hex characters. Long and random (`openssl rand -hex 32`). Changing it invalidates every link. |
| `NETLIFY_BUILD_HOOK` | Functions | Build hook URL the function calls after an upload improves a time. The same hook the data repo's workflow uses (there it's a GitHub secret). |

For `scripts/submissions.js` only, locally: `NETLIFY_SITE_ID` and `NETLIFY_AUTH_TOKEN` (a personal access token), plus `NETLIFY_BUILD_HOOK` to rebuild after a delete.

### Sending out links

With the data repo cloned into `src/_data/league/`:

```sh
SUBMIT_SECRET=… node scripts/submit-links.js --base https://your-site.netlify.app [--league <id>]
```

It prints each member's name and link. Send each rider their own link; anyone with it can upload as that rider. To revoke one rider's link, remove them from the league; to revoke them all, change `SUBMIT_SECRET`.

### Removing a bad submission

```sh
node scripts/submissions.js list [--league <id>] [--event <id>] [--hashes]
node scripts/submissions.js delete <league>/<event>/<member>/<segment>
```

Deleting a result leaves the file's hash, so the same file can't be uploaded again; delete `hashes/<sha256>` too to allow it. A YAML row marked `excluded: true` doesn't stop an uploaded row for the same ride from counting, so delete the submission as well.
