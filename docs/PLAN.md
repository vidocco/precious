# Precious: a collection manager where you define the data sources

## Context

Koillection fills items with hard-coded "scrapers": rigid, ugly, and you can't plug in arbitrary APIs. **Precious** (the repo name) makes **user-defined data sources** the core idea. A source can be a REST API, a GraphQL API or a scraped HTML page:

- A household runs one self-hosted instance with many collections (games, books, vinyl…), each with its own custom fields.
- Each collection binds to API endpoints by **role**: *search* (find candidates), *enrich* (fill fields after picking one), *compute* (refresh a field on a schedule, e.g. a daily `value`).
- Adding an item means searching, picking a result, then auto-fill based on the rules; manual entry is the fallback.
- It should look good (cover-first, themed per collection), be installable as a PWA, and ship as **one Docker image (app + PostgreSQL)** on GHCR, ready for Unraid.

The repo `vidocco/precious` is empty (README, LICENSE, .gitignore). Work goes on branch `claude/collection-manager-api-4wwr51`.

**Decisions made:** React · TypeScript · user accounts with private/household/public collections · online-only PWA (installable, no offline data).

---

## Stack

| Concern | Choice | Why |
|---|---|---|
| Runtime / lang | Node 24 LTS, TypeScript, pnpm workspaces | One language across server, web and shared schemas |
| API | Fastify 5 + Zod type provider | Fast, schema-validated routes; Zod schemas shared with the web app |
| DB | PostgreSQL 18 (pinned major) + Drizzle ORM / drizzle-kit migrations | Typed SQL, first-class JSONB |
| Jobs / cron | **pg-boss** | Queue, cron, retries and backoff stored in Postgres, so no Redis and the container stays single |
| Request templating | **LiquidJS** (sandboxed) | `{{ query }}`, `{{ item.fields.platform }}`, filters like `url_encode` / `json_escape` |
| Response mapping | **JSONata** | Expressive, declarative and safe. User-defined JS would need a sandbox; JSONata doesn't |
| Request kinds | **REST** (JSON, or XML via fast-xml-parser), **GraphQL** (query + variables, errors handled), **HTML scraping** (cheerio CSS selectors; XPath via jsdom, loaded only when used) | Covers almost any source. All three turn the response into a JSON tree, and the same mapping layer runs on all of them |
| HTTP | undici + Bottleneck (rate limit per source) + Postgres response cache | Stay within API quotas and avoid repeat calls while you type |
| Images | sharp: thumbnails, WebP/AVIF, dominant-colour extraction | Covers stored locally (links rot), colours drive theming |
| Auth | Better Auth (Drizzle adapter), email+password, admin role | Sessions/cookies solved; no email server needed (admin resets passwords) |
| Web | React 19 + Vite, TanStack Router + Query, **React Aria Components** (unstyled), Tailwind v4, Motion | Accessible primitives with no imposed look, so the design can be bespoke and not "shadcn default" |
| PWA | vite-plugin-pwa (manifest, icons, app-shell SW, network-first) | Installable; online-only as decided |
| Tests | Vitest, undici MockAgent fixtures, Testcontainers (Postgres), Playwright | See Verification |
| Packaging | Multi-stage Dockerfile + **s6-overlay** supervising Postgres and Node; buildx amd64+arm64 → GHCR | s6 is the linuxserver.io convention Unraid users already know; clean shutdown protects Postgres |

## Repo layout

```
apps/server/      Fastify API · src/db (schema, migrations) · src/connectors (engine) · src/jobs · src/routes
apps/web/         React PWA · src/design (tokens, primitives) · src/features/{collections,items,sources,admin}
packages/shared/  Zod schemas: field types, connector/recipe format, API contracts
recipes/          Built-in source presets (JSON): Open Library, Discogs, IGDB, TMDB, BoardGameGeek…
docker/           Dockerfile, s6 service defs (postgres, app, init-migrate), entrypoint
unraid/           Community Apps template XML
.github/workflows ci.yml (lint/type/test/e2e), release.yml (multi-arch build → ghcr.io/vidocco/precious)
```

## Data model (core tables)

- `users`, `sessions`, `households`: Better Auth tables plus a role (admin/member).
- `collections`: owner, name, icon, cover, theme (accent, font pairing, default view), `visibility` (private | household | public-link + slug).
- `field_definitions`: per collection. `key`, `label`, `type` (text, longtext, number, currency, date, boolean, url, image, rating, select, multiselect, tags, item-link), display options, order, plus optional `compute` config.
- `items`: collection, title, cover, **`data JSONB`** (custom field values by key, GIN-indexed), `external_refs JSONB` (`{ igdb: "1942", hltb: "10270" }`), `field_meta JSONB` (where each value came from, plus a **locked** flag), created_by, timestamps.
  - JSONB beats EAV (entity-attribute-value tables) here: a flexible schema, plain SQL for filters/sorts/aggregates, fast enough for household-sized data. Item writes are validated by a Zod schema built at runtime from the field definitions.
- `data_sources`: base URL, auth config (none | API key in header/query | bearer | basic | **OAuth2 client credentials** with token caching), default headers, rate limit, **secrets encrypted with AES-256-GCM** using `APP_SECRET`.
- `endpoints`: belong to a source. Role (search | lookup | compute), **kind** (rest | graphql | html), method, path/query/body templates (or a GraphQL query + variables, or an HTML `extract` tree), JSONata mapping, cache TTL.
- `collection_bindings`: links a collection to endpoints: search provider(s) in priority order, the ordered **enrichment pipeline**, and field→endpoint links for computed fields.
- `computed_values`: item, field, value, fetched_at, status/error. This is a **history table**, so the `value` chart over time comes for free. The latest value is mirrored into `items.data`.
- `http_cache`: request hash → response, expires_at.

## The connector engine (the heart of it)

A source plus its endpoints is a **recipe**, exportable/importable as JSON/YAML so people can share them. Example:

```yaml
source: { name: IGDB, baseUrl: https://api.igdb.com/v4,
  auth: { type: oauth2_client_credentials, tokenUrl: https://id.twitch.tv/oauth2/token },
  headers: { Client-ID: "{{ secrets.clientId }}" }, rateLimit: { requests: 4, perSeconds: 1 } }
endpoints:
  - key: search
    role: search
    method: POST
    path: /games
    body: 'search "{{ query | json_escape }}"; fields name,first_release_date,cover.image_id,platforms.name; limit 20;'
    map:                                   # JSONata
      results:  "$"
      id:       "id"
      title:    "name"
      subtitle: "$join(platforms.name, ' · ')"
      year:     "$fromMillis(first_release_date*1000, '[Y]')"
      image:    "'https://images.igdb.com/igdb/image/upload/t_cover_big/' & cover.image_id & '.jpg'"
```

### Three request kinds, one pipeline

The core design rule is that **every kind turns its response into a JSON tree, then the same JSONata mapping and role validation run on it.** Templating, auth, rate limits, caching, the mapping console, the enrichment pipeline and computed fields all work the same whatever the source is.

**1. REST.** JSON as-is; XML is parsed into JSON. (Example above.)

**2. GraphQL.** A first-class kind, not a POST you build by hand:

```yaml
- key: search
  kind: graphql
  role: search
  url: https://graphql.anilist.co
  query: |
    query ($search: String) { Page(perPage: 20) {
      media(search: $search, type: ANIME) { id title { english romaji } coverImage { large } startDate { year } } } }
  variables: { search: "{{ query }}" }
  map: { results: "Page.media", id: "id", title: "title.english ? title.english : title.romaji",
         image: "coverImage.large", year: "startDate.year" }
```

- User input goes into **GraphQL variables**, never pasted into the query text, so quotes and special characters can't break the query.
- GraphQL servers often return HTTP 200 *with* an `errors` array. The engine treats that as a failure (or as a partial result when `data` is also present, if the endpoint allows it). Mapping runs on `data`.
- In the console: a query editor (CodeMirror + cm6-graphql) with autocomplete, using the API's own schema description where the API publishes it.

**3. HTML scraping.** This is Koillection's scraper idea, but declarative and testable. An `extract` tree of selectors turns the page into JSON:

```yaml
- key: details
  kind: html
  role: lookup
  method: GET
  url: "https://example-records.com/release/{{ refs.example }}"
  extract:
    title:   { css: "h1.release-title", value: text }
    cover:   { css: ".artwork img", value: "attr:src", absoluteUrl: true }
    year:    { css: ".meta .year", value: text, regex: "(\\d{4})", as: number }
    genres:  { css: ".genres a", value: text, many: true }
    tracks:                                  # nested lists keep the page's structure
      css: "table.tracklist tr"
      many: true
      fields:
        position: { css: "td:nth-child(1)", value: text }
        name:     { css: "td:nth-child(2)", value: text }
        length:   { xpath: "./td[3]/text()", value: text }   # XPath works wherever CSS doesn't reach
  map: { title: "title", cover: "cover", year: "year", genres: "genres", tracklist: "tracks" }
```

- **What a selector can return:** `text`, `ownText`, `html`, `attr:<name>`. **Clean-up options:** `trim`, `regex` capture, `as: number|date|boolean`, `absoluteUrl`, `default`. **Nesting:** `many` and nested `fields` give lists of objects. Anything fancier happens in the JSONata step.
- **Built-in shortcuts**, because they often beat hand-written selectors:
  - `jsonld`: the schema.org data many shops and book sites embed in the page.
  - `meta`: OpenGraph and Twitter card tags.
  - `scriptJson`: parse the JSON inside a `<script>` tag. Many modern sites built with Next.js put the page's full data in `<script id="__NEXT_DATA__">`.
- **Search pages work too:** a `role: search` HTML endpoint extracts `results: { css: ".result", many: true, fields: {...} }`.
- **Point-and-click selector picker** in the console:
  - The server fetches the page and strips its scripts, then shows it in a locked-down (sandboxed) frame.
  - Clicking an element generates a selector (via @medv/finder), highlights every element it matches, and shows the match count.
  - The extracted JSON updates live next to it.
- **Polite by default:** long cache times, a low per-site rate limit, a configurable User-Agent.

**Scraping limits, bluntly:**
- A plain fetch gets the HTML the server sends, *before* JavaScript runs. Sites that build their content in the browser return an empty shell.
- **Workarounds:**
  - Use `scriptJson`/`jsonld` if the data is embedded in the page.
  - Or open the browser's devtools Network tab, find the JSON request the page itself makes, and point a REST endpoint at that instead. This is usually more robust anyway.
- A headless-browser option (Playwright + Chromium) would add a few hundred MB to the image. It stays out of v1; if it's ever needed, it becomes a separate `:full` image tag.
- Sites behind bot protection (e.g. Cloudflare challenges) will block it. Getting around that is out of scope.

### Execution

Render the templates (context: `query`, `item`, `refs`, `secrets`, `previous` step output) → authenticate (token fetched and cached) → rate-limit → cache check → request (timeout, retry with backoff) → **turn the response into JSON according to the kind** (JSON / XML → JSON / GraphQL `data` + error check / HTML `extract`) → JSONata with a time limit → validate against the role's output shape (search → `{id,title,subtitle,image,year}[]`; lookup → `{fieldKey: value}`; compute → a single value).

**The mapping console** is what decides whether this feels better than Koillection or worse. On the endpoint editor: sample input → **Run** → raw response on the left (a JSON tree you click to insert paths, a GraphQL result, or the HTML page preview with the selector picker) → extract/mapping editor in the middle → live mapped output on the right, with errors inline. Without this, "flexible" means "write JSONata blind", and nobody in the household but you will use it.

**Security:** only admins can define sources. A source makes the server request any URL you give it, so it's a trusted-admin feature by design. Secrets are never sent back to the browser. Image downloads have size and type limits.

## Add-item flow

1. In a collection, **Add** opens a search sheet ("Search IGDB…"), debounced, showing result cards with covers. Optional barcode scan via the camera (BarcodeDetector API with a zxing fallback) for ISBN/EAN on books and vinyl.
2. Picking a result runs the server's **enrichment pipeline**: each lookup step can use earlier outputs (`{{ previous.igdb.name }}`, `{{ refs.igdb }}`).
3. **Match problem:** cross-source lookups by title are fuzzy (an HLTB search for "Zelda" gives 30 hits). Each step scores its candidates. Below a set score, the review screen shows a "pick the right match for HLTB" chooser. The chosen external ID is saved in `external_refs`, so later refreshes and computes use the ID, not the title.
4. A **review screen** shows the pre-filled form with a per-field source badge. Edit, then save. A per-collection "quick add" toggle skips the review.
5. **No result / not what I want** opens the manual form with the same fields and the title pre-filled from the query.
6. Later, **Refresh metadata** reruns the pipeline using the stored refs and never overwrites **locked** (user-edited) fields.

## Computed fields

- Config: endpoint + input template + JSONata mapping + cron (`0 4 * * *`) + "also run on create".
- A pg-boss dispatcher finds due (item, field) pairs and fans out jobs that respect each source's rate limit. On failure the last good value is kept and the error shows as a subtle badge on the field.
- **Local derived fields** need no API, just JSONata over the item (e.g. `value / hltb_main` = cost per hour). This is cheap because the engine already exists.
- Collection dashboard: count, total value (SQL SUM over the JSONB field), a value-over-time chart from `computed_values`.

## Aesthetic direction

- **Cover-first:** collections and items are mainly images. The dominant cover colour tints the item page and the collection header.
- **Per-collection identity:** accent colour, type pairing (variable fonts) and default view chosen per collection, so the vinyl shelf and the game shelf feel different.
- **Views:** Wall (big covers, masonry), **Shelf** (generated spines from the cover colour and title, which suits books, vinyl and boxed games), Table (spreadsheet-like bulk editing), List.
- Motion: View Transitions API shared-element morph from card to item page. Dark mode first-class.
- **Phase 0 makes 3–4 static mockups** (collection wall, shelf, item page, mapping console) to agree on the look *before* building components.

## Docker / Unraid

- One image: Node 24 + PostgreSQL 18 + s6-overlay. Services: `postgres` → `init` (migrations) → `app`. Healthcheck at `/api/health`. Port 8080.
- Volume `/data` → `/data/postgres`, `/data/uploads`, `/data/backups`. On Unraid, map it to `/mnt/user/appdata/precious`.
- `PUID`/`PGID` (Unraid 99/100), `TZ`, `APP_SECRET` (generated on first run if missing and saved to `/data`).
- **`DATABASE_URL` escape hatch:** if set, the bundled Postgres doesn't start and the app uses the external DB.
- **Nightly `pg_dump`** to `/data/backups` with retention, plus collection export to JSON/CSV. This matters because a Postgres *major* upgrade inside an all-in-one image needs a dump/restore. The PG major is pinned, and an upgrade gets its own documented release.
- GitHub Actions: on tag, buildx multi-arch → `ghcr.io/vidocco/precious:{semver,latest}`. Ship an Unraid template XML.

## Milestones (each one usable on its own)

0. **Foundations:** monorepo, lint/format/typecheck, CI, docker-compose dev Postgres, design tokens and mockups.
1. **Collection manager without APIs:** auth/users/roles, collections, custom fields, item CRUD, image upload, Wall/Table views, filter/sort/search, visibility and public links.
2. **Connector engine:** sources, auth types (including OAuth2 client credentials), endpoints of all three kinds (REST, GraphQL, HTML `extract` with CSS/XPath, jsonld/meta/scriptJson), templating, JSONata, cache, rate limits, encrypted secrets, **mapping console with HTML selector picker**, recipe import/export plus bundled presets that cover each kind (e.g. Open Library REST, AniList GraphQL, one HTML scrape recipe).
3. **Search-to-add:** bindings UI, search sheet, enrichment pipeline, match chooser, review screen, manual fallback, refresh plus locked fields.
4. **Computed fields:** pg-boss scheduler, history, error states, derived fields, collection dashboards.
5. **Polish and PWA:** manifest/install, Shelf view, per-collection theming, view transitions, barcode scan, CSV import.
6. **Ship:** all-in-one image, s6, backups, GHCR release pipeline, Unraid template, README/docs.

## Risks, bluntly

- **Flexibility vs usability:** a generic API mapper is a power-user tool. Presets, the mapping console and click-to-map aren't optional polish; they're what make the product work.
- **HowLongToBeat has no official API.** Its internal search endpoint changes often and breaks community libraries. You'll be able to fix a recipe in the UI without a code release (the whole point), but expect to. Game-value APIs (e.g. PriceCharting) usually need a paid key.
- **Scope:** milestones 1–3 are the product; 4–6 make it great. Ship 1–3 before adding view modes.

## Verification

- **Unit (Vitest):** templating (escaping), JSONata mapping per role, OAuth token caching/refresh, rate limiter, XML parsing, using recorded API fixtures via undici MockAgent (no live calls in CI).
  - **GraphQL:** variables are sent as variables (not string-spliced into the query), an `errors` array with HTTP 200 fails, and partial `data` + `errors` follows the endpoint setting.
  - **HTML:** saved HTML fixture pages exercise every `extract` feature: text/attr/html, regex, number casting, absolute URLs, nested `many` lists, XPath, jsonld, meta, `__NEXT_DATA__` scriptJson, and a selector with zero matches falling back to `default`.
- **Integration:** Testcontainers Postgres. Migrations, JSONB filters/aggregates, the pg-boss computed-field run end to end against a local mock HTTP server.
- **E2E (Playwright):** create collection → add fields → import a recipe pointing at a mock API → search → pick → match chooser → save → trigger compute → value and history appear. Run it three times, with the search step as REST, as GraphQL and as an HTML scrape against a local mock server, plus one test that builds an HTML extract by clicking in the selector picker.
- **Container smoke test in CI:** build the image → run with an empty `/data` volume → `/api/health` OK → run the Playwright suite against the container → restart the container → data persists → a backup file exists.
- **Manual:** install as a PWA on a phone, add a book by barcode, deploy on Unraid from the template.
