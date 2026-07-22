# Curioflow

Curioflow is a self-hosted reading, source-flow, and knowledge-library application. It supports saved articles, RSS and Atom feeds, podcasts, PDFs, annotations, summaries, reading progress, import/export workflows, and sync with the closed-source Curioflow iOS app.

This repository contains the community web/backend application and its open mobile sync protocol. It does not include the iOS application source, Curioflow Cloud billing, commercial plan mappings, managed-service quotas, or private deployment operations.

## Local setup

```bash
npm install
cp .env.example .env
npm run db:migrate
npm run db:seed
USERNAME=reader EMAIL=reader@example.com PASSWORD=replace-me ACCOUNT_ID=account-local USER_ID=user-local LIBRARY_ID=library-local npm run user:create
npm run dev
```

Open `http://localhost:3000/home` and sign in with the provisioned user.

## Production database

Local development uses SQLite through `prisma/schema.prisma`. Self-hosted production uses PostgreSQL through `prisma/postgres/schema.prisma` and its separate migration history.

```bash
export CURIOFLOW_SECRET_KEY="$(openssl rand -base64 32)"
export DATABASE_URL="postgresql://curioflow:password@db:5432/curioflow?schema=public"
npm run db:generate:prod
npm run db:migrate:prod
npm run db:seed:prod
npm run build
npm run start
```

Run `npm run db:generate:prod` before production builds. `CURIOFLOW_SECRET_KEY` is required in production before storing LLM API keys.

## Configuration

Curioflow uses user-provided LLM credentials. Resource and monthly managed-work limits are configurable through environment variables; the self-hosted defaults are intentionally generous.

Password-reset email can be configured through Amazon SES. Operational metrics can optionally be written to an InfluxDB 1.x-compatible endpoint. See [.env.example](.env.example) for available settings.

## Verification

```bash
npm run test:state
npm run typecheck
npm run lint
npm run build
gitleaks git . --config .gitleaks.toml
```

Ask Library also has deterministic offline and optional live-model evaluation suites documented in [docs/ask-evals.md](docs/ask-evals.md).

## Scope

- Next.js App Router with TypeScript.
- SQLite locally and PostgreSQL for self-hosted production.
- Password authentication and account-scoped ownership.
- Authenticated mobile v1 session, sync, source, annotation, and upload APIs for the closed-source iOS client.
- Reading library, archive, RSS/Atom, podcasts, PDFs, notes, and annotations.
- Background ingestion, source refresh, summaries, retries, and job visibility.
- Account export in JSON, Markdown, and OPML formats.

## License

Curioflow Web is available under the [MIT License](LICENSE).
