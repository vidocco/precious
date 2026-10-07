# Precious

A self-hosted collection manager for a whole household. You define the data sources (REST, GraphQL or scraped HTML) and Precious uses them to fill in your collections.

See [`docs/PLAN.md`](docs/PLAN.md) for the full plan and [`design/mockups/index.html`](design/mockups/index.html) for the design direction.

## Status

Milestones 1 and 2 are done: a working household collection manager, plus the data source engine.

- First-run setup creates the admin; admins add the rest of the household.
- Templates (five starters included) define each kind of collection: its fields, what shows on and under each cover, the item page layout and the header figures.
- Collections are linked to a template and can be private, shared with the household or shared with a public link.
- Items are added by hand with a cover image, shown as a wall or a table, filtered, sorted and searched (inside a collection or across all of them).
- **Data sources** (Data management → Data sources, admins only): REST, GraphQL and HTML sources with API key, bearer, basic or OAuth2 sign-in, encrypted secrets, default headers, rate limits and caching. Each endpoint has a method, parameters, headers, a body and a JSONata mapping, and can be tested in a console: run it, read the response, click keys to map them, or click elements in a web page to pick them out. Sources are shared as recipe files; presets for Open Library, AniList, IGDB and Wikipedia are included.

Next: using data sources from collections (search when adding an item, fill in fields from the result).

## Layout

```
apps/server       Fastify API (TypeScript, runs directly on Node 22.18+ type stripping in dev)
apps/web          React + Vite front end, Tailwind v4 on top of the design tokens
packages/shared   Zod schemas and types shared by server and web
design/mockups    Static design mockups
docs              Plan and design notes
recipes           Bundled data source presets (recipe files)
e2e               Playwright end-to-end tests and a mock API
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
