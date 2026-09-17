# Loremaster

Loremaster is a pnpm workspace with two applications:

- `apps/web`: the SvelteKit web application, database schema, and campaign vault services.
- `apps/workflows`: the unbundled Node.js DBOS runtime for durable background workflows.

The repository requires Node.js 20 or later.

## Local setup

Create the local environment file, install dependencies, start PostgreSQL, and apply application
migrations:

```sh
cp .env.example .env
pnpm install
docker compose up -d
pnpm db:migrate
pnpm db:seed
```

The local DBOS runtime uses `DBOS_SYSTEM_DATABASE_URL`, falling back to `DATABASE_URL`, and stores
its system tables in the `dbos` schema. The web and workflows applications resolve
`LOREMASTER_DATA_ROOT` from their package directories, so the campaign vault remains in the
repository-level `data/campaigns` directory.

## Development

Start both applications:

```sh
pnpm dev
```

Start either application independently:

```sh
pnpm dev:web
pnpm dev:workflows
```

The seeded campaign is available at
`http://localhost:5173/campaigns/11111111-1111-4111-8111-111111111111`.

## Database and vault

Seed the test campaign or recreate it:

```sh
pnpm db:seed
pnpm db:seed -- --reset
```

Initialize vault history and rebuild document indexes:

```sh
pnpm db:reindex-vaults
```

Ordinary document reads verify managed Markdown files and do not turn unexpected filesystem edits
into history.

## Validation

Run workspace checks, tests, formatting validation, and builds from the repository root:

```sh
pnpm check
pnpm test
pnpm lint
pnpm build
```

Run only the web server test project:

```sh
pnpm test:server
```

## Deployment

`apps/workflows` is compiled with `tsc` and started with Node.js because DBOS applications and
workflows must not be bundled. Its `dbos-config.yaml` provides the DBOS CLI and DBOS Cloud runtime
configuration.

The web application still uses `adapter-auto`. Select a concrete SvelteKit adapter before deploying
it to a specific platform.
