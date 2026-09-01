# sv

Everything you need to build a Svelte project, powered by [`sv`](https://github.com/sveltejs/cli).

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```sh
# create a new project
npx sv create my-app
```

To recreate this project with the same configuration:

```sh
# recreate this project
pnpm dlx sv@0.17.0 create --template minimal --types ts --add prettier vitest="usages:unit" sveltekit-adapter="adapter:auto" drizzle="database:postgresql+postgresql:neon" ai-tools="ide:cursor+tools:mcp,svelte-code-writer,svelte-core-bestpractices,svelte-file-editor+mcpSetup:remote" --install pnpm loremaster
```

## Developing

Install dependencies, start PostgreSQL, and apply migrations:

```sh
pnpm install
docker compose up -d
pnpm db:migrate
pnpm db:seed
```

Seed a test campaign ("Curse of Blackwood") with locations, NPCs, lore, events, and more:

```sh
pnpm db:seed              # skip if already seeded
pnpm db:seed -- --reset   # delete and recreate
```

Open `http://localhost:5173/campaigns/11111111-1111-4111-8111-111111111111` after seeding.

Then start the development server:

```sh
pnpm dev
```

## Building

To create a production version of your app:

```sh
pnpm build
```

You can preview the production build with `pnpm preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.
