# Precious

A self-hosted collection manager for a whole household. You define the data sources (REST, GraphQL or scraped HTML) and Precious uses them to fill in your collections.

See [`docs/PLAN.md`](docs/PLAN.md) for the full plan and [`design/mockups/index.html`](design/mockups/index.html) for the design direction.

## Status

All six milestones of the plan are done: the collection manager, the data source engine, adding items by searching data sources, values kept up to date, the polish that makes it feel like an app, and a single Docker image to run it all.

- First-run setup creates the admin; admins add the rest of the household.
- Templates (five starters included) define each kind of collection: its fields, the shape of its covers (book, game case, square for records, or any size; cropped or shown whole), what shows on and under each cover, the item page layout and the header figures.
- Collections are linked to a template and can be private, shared with the household or shared with a public link.
- Items are added by hand with a cover image, shown as a wall, a **shelf** (spines sized by the template's rules: fixed, from fields such as pages and height, or by a field's value such as platform) or a table, filtered, sorted and searched (inside a collection or across all of them). Opening one morphs its cover into the item page.
- **Shelf order**: a template (or a single collection) arranges items like a library, by levels such as Genre, then Author, then Series and Series number. Each level chooses whether a section marker shows where its groups start (a labelled divider on the shelf, a heading on the wall, a row in the table), and marked levels can start each group on a new board, with its label hanging from the board. Markers can have their own size and colour, and a "No genre" marker only appears where there are other genres to tell it apart from. The shelf opens in this order; the wall and table offer it in the sort menu.
- **Data sources** (Data management → Data sources, admins only): REST, GraphQL and HTML sources with API key, bearer, basic or OAuth2 sign-in, encrypted secrets, default headers, rate limits and caching. Each endpoint has a method, parameters, headers, a body and a JSONata mapping, and can be tested in a console: run it, read the response, click keys to map them, or click elements in a web page to pick them out. Sources are shared as recipe files; presets for Open Library, AniList, IGDB, Wikipedia, Discogs (records, with what copies sell for) and eBay (values from the asking prices of live listings, by name or barcode) are included.

- **Search to add**: a template's Data sources tab picks which searches find its items and which lookups fill in its fields, including lookups in other sources that find their own match (and ask you when it's unclear). It can be tried before saving. The **+** on a collection then searches; the picked result opens the item form filled in, with where each value came from. **Refresh** on an item looks it up again and never changes values edited by hand (those can be unlocked). Collections can skip the review with quick add.

- **Keep up to date** (same tab): look a field up again on a schedule (every few hours, daily, weekly or monthly; a price, a rating) or calculate it from other fields with a formula (price per hour). Failed lookups keep the last good value, say why, and retry within the hour; values edited by hand are left alone. Every value is kept as history, charted on the item page and as a collection total.

- **Barcode scanning** in the add sheet: the camera reads an ISBN or EAN into the search (needs https, as browsers only share the camera over secure connections; USB scanners work anywhere).
- **Import & export** (Data management): import a CSV into any collection with column matching and a preview; export each collection as CSV or JSON.
- **Installable** as an app on phones and desktops (needs https). Precious stays online-only: your data is never cached on the device.

- **One container**: the app and its PostgreSQL database in a single image, with nightly backups.

## Running it

Precious runs as one container: the app, its own PostgreSQL and a small supervisor. Everything it keeps (database, covers, backups, the app secret) lives in one folder mounted at `/data`.

### Unraid

1. Copy [`unraid/precious.xml`](unraid/precious.xml) to the flash drive as `/boot/config/plugins/dockerMan/templates-user/my-precious.xml`, then in **Docker → Add Container** pick **Precious** from the template list.
2. Set **Public URL** to the address you'll open it at, e.g. `http://tower.local:8080`, and your **Time zone**. The defaults keep data in `/mnt/user/appdata/precious` with Unraid's usual owner (PUID 99, PGID 100).
3. Start it and open the Web UI. The first visit asks you to create the admin account; add the rest of the household from **Server**.

### Docker

```sh
docker run -d --name precious \
  -p 8080:8080 \
  -v /path/to/precious-data:/data \
  -e PUBLIC_URL=http://your-server:8080 \
  -e TZ=Europe/Madrid \
  --stop-timeout 30 \
  --restart unless-stopped \
  ghcr.io/vidocco/precious:latest
```

Or with Compose:

```yaml
services:
  precious:
    image: ghcr.io/vidocco/precious:latest
    ports: ["8080:8080"]
    volumes: ["./precious-data:/data"]
    environment:
      PUBLIC_URL: http://your-server:8080
      TZ: Europe/Madrid
    stop_grace_period: 30s
    restart: unless-stopped
```

Images are published for amd64 and arm64.

### Settings

| Variable | Default | What it does |
|---|---|---|
| `PUBLIC_URL` | `http://localhost:8080` | The address people open Precious at. Other addresses of the same server (its IP, a hostname) work too. With an `https://` address, cookies are marked secure. |
| `TZ` | `Etc/UTC` | Time zone for scheduled lookups and the nightly backup. |
| `PUID`, `PGID` | `1000` | Owner of the files in `/data` (Unraid: 99 and 100). |
| `BACKUP_TIME` | `03:30` | When the nightly backup runs. |
| `BACKUP_KEEP` | `14` | How many backups to keep. |
| `TRUST_PROXY` | `false` | Set to `true` behind a reverse proxy, so sign-in limits apply per visitor rather than to the proxy. |
| `DATABASE_URL` | bundled | A `postgres://` address to use your own PostgreSQL (version 16 or later, with the `pg_trgm` extension available); the bundled one then stays off. |
| `APP_SECRET` | generated | Signs sessions and encrypts data source secrets. Generated on first start into `/data/.app-secret`; changing it signs everyone out and makes saved secrets unreadable. |
| `LOG_LEVEL` | `info` | `warn` for quieter logs, `debug` for more. |

### HTTPS, installing as an app, scanning barcodes

Browsers only let a site be installed as an app, or use the camera, over `https://` (or on `localhost`). On a home network, put Precious behind a reverse proxy with a certificate, such as Nginx Proxy Manager, SWAG, Caddy or Tailscale Serve; set `PUBLIC_URL` to the `https://` address and `TRUST_PROXY=true`. Everything else works over plain `http://`, and USB barcode scanners work anywhere because they type into the search box.

### Backups and restoring

Every night the whole database is saved to `/data/backups` (`precious-YYYY-MM-DD-HHMM.dump`); the newest 14 are kept. **Server → Backups** lists them, makes one on demand and downloads them. Covers live in `/data/uploads`, so back up the whole `/data` folder (on Unraid, the appdata backup plugin does this).

To restore a backup into the bundled database:

```sh
docker stop precious
mv /path/to/precious-data/postgres /path/to/precious-data/postgres.old   # keep it until you're happy
docker start precious                                                     # starts with an empty database
docker exec precious pg_restore -h /run/postgresql -U precious -d precious \
  --clean --if-exists --no-owner /data/backups/precious-2026-10-07-0330.dump
docker restart precious
```

Collections can also be exported one by one as CSV or JSON from **Data management → Import & export**.

### Updating

Pull the new image and recreate the container (on Unraid: **Check for updates**, then **Apply update**). Database changes are applied automatically when the app starts. Every release is checked before it's published: it takes over the previous release's `/data` without changing anything, and the previous release still runs on that data afterwards, so going back is possible too.

PostgreSQL itself is pinned to one major version (18). If a future release moves to a new major version, its release notes will say so, and the container refuses to start on the old data rather than risk it: make a backup first, then restore it into a fresh `/data/postgres` as above.

## Layout

```
apps/server       Fastify API (TypeScript, runs directly on Node 22.18+ type stripping in dev)
apps/web          React + Vite front end, Tailwind v4 on top of the design tokens
packages/shared   Zod schemas and types shared by server and web
design/mockups    Static design mockups
docs              Plan and design notes
recipes           Bundled data source presets (recipe files)
e2e               Playwright end-to-end tests and a mock API
docker            The image's service scripts (s6-overlay) and its smoke test
unraid            The Unraid container template
```

## Development

Requirements: Node 22.18+ (24 recommended, see `.nvmrc`), pnpm 10, Docker.

```sh
pnpm install
cp .env.example .env
pnpm db:up          # Postgres 18 on localhost:5432
pnpm dev            # server on :3000, web on :5173 (proxies /api to the server)
```

Checks (the same ones CI runs):

```sh
pnpm lint           # Biome: lint + format check (pnpm format to fix)
pnpm typecheck
pnpm test           # server tests need DATABASE_URL (pnpm db:up provides it)
pnpm build
pnpm e2e            # Playwright, against the built app and a fresh database
```

The first time you open the app it asks you to create the admin account. API docs are at `/api/docs`.

To build and check the image locally:

```sh
docker build -t precious:test .
docker/smoke-test.sh precious:test   # starts it, sets it up, backs up, restarts, checks nothing was lost
docker/upgrade-test.sh ghcr.io/vidocco/precious:latest precious:test   # upgrades from the last release and back
```

Releases: push a tag like `v1.0.0`; GitHub Actions smoke-tests the image, checks it upgrades from the previous release, and publishes `ghcr.io/vidocco/precious` for amd64 and arm64.
