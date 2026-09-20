# Loremaster

Loremaster is a pnpm workspace with two applications and a shared core package:

- `apps/web`: the SvelteKit web application and DBOS client.
- `apps/workflows`: the unbundled Node.js DBOS worker for session analysis and commit workflows.
- `packages/core`: shared Effect-based domain services, ingestion pipeline, AI, vault, and database
  adapters.

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

Set `AUTH_ADMIN_EMAIL` to the email address for the initial administrator, then open
`http://localhost:5173/signup` and register that address without an invite code. Once signed in, the
administrator can open `/admin/invites` to create single-use signup links that expire after seven
days. `AUTH_ALLOWED_EMAILS` and `AUTH_SIGNUP_CODE` remain available for the legacy shared-code
flow. In development, an empty allowlist and signup code are accepted to simplify local setup. The
first account claims any campaigns created before authentication was added, including the seeded
campaign. Every campaign created after that is owned by the account that created it and is only
visible to that owner.

Authentication follows Lucia's database-session guidance: passwords are hashed with Argon2id and
the browser receives an HTTP-only session cookie. This initial testing flow does not yet include
email verification or password recovery.

The local DBOS runtime uses `DBOS_SYSTEM_DATABASE_URL`, falling back to `DATABASE_URL`, and stores
its system tables in the `dbos` schema. The web and workflows applications resolve
`LOREMASTER_DATA_ROOT` from their package directories, so the campaign vault remains in the
repository-level `data/campaigns` directory.

Production deployments must set `LOREMASTER_DATA_ROOT` to an absolute path. The web and workflows
processes must use the same value and mount the same durable directory. Set
`DBOS_APPLICATION_VERSION` only to an immutable deployment identifier; leave it unset to use DBOS
versioning.

Session ingestion is asynchronous. The web app persists an ingestion request and enqueues it in
DBOS. The workflows app checkpoints transcript analysis, event auditing, entity resolution,
chronology, and commit mutations while publishing progress for the review page.

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

After creating the first account, the seeded campaign is available at
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
configuration. Both compiled worker launch paths set `NODE_ENV=production`, which enforces an
absolute `LOREMASTER_DATA_ROOT`; the TypeScript development command retains the local relative
default.

The web application still uses `adapter-auto`. Select a concrete SvelteKit adapter before deploying
it to a specific platform.
