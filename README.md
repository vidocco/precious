# Precious

A self-hosted collection manager for a whole household. You define the data sources (REST, GraphQL or scraped HTML) and Precious uses them to fill in your collections.

See [`docs/PLAN.md`](docs/PLAN.md) for the full plan and [`design/mockups/index.html`](design/mockups/index.html) for the design direction.

## Status

Milestone 0 (foundations): workspace, tooling, CI, dev database, design tokens and mockups. Nothing usable yet.

## Layout

```
apps/server       Fastify API (TypeScript, runs directly on Node 22.18+ type stripping in dev)
apps/web          React + Vite front end, Tailwind v4 on top of the design tokens
packages/shared   Zod schemas and types shared by server and web
design/mockups    Static design mockups
docs              Plan and design notes
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
pnpm test           # set DATABASE_URL to also run the database tests
pnpm build
```
