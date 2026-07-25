# Docker deployment

Curioflow publishes a production image to the GitHub Container Registry:

```text
ghcr.io/zellux/curioflow-web
```

Every push to `main` publishes `latest` and an immutable `sha-<short-sha>`
tag. Version tags such as `v1.2.3` publish a matching image tag. The workflow
can also be started manually from GitHub Actions.

## Configure

Copy `.env.example` to `.env` and set the required production values. To pin a
deployment to a specific release, set:

```sh
CURIOFLOW_IMAGE=ghcr.io/zellux/curioflow-web:sha-0123456
```

If `CURIOFLOW_IMAGE` is omitted, Compose uses `latest`.

The Compose project name is fixed as `curioflow-web`. Keep that name unchanged
for an existing installation so its `curioflow-postgres` and
`curioflow-storage` volumes remain attached.

## Deploy

```sh
docker compose -f docker-compose.prod.yml pull app worker migrate
docker compose -f docker-compose.prod.yml up -d --remove-orphans
docker compose -f docker-compose.prod.yml ps
```

The one-shot `migrate` service applies PostgreSQL migrations before `app` and
`worker` start. Seeding remains an explicit admin operation:

```sh
docker compose -f docker-compose.prod.yml --profile admin run --rm seed
```

## Roll back

Set `CURIOFLOW_IMAGE` to an earlier immutable `sha-<short-sha>` tag and repeat
the deploy commands. Do not remove the Postgres or storage volumes during a
rollback. Review any already-applied database migration before rolling the
application image back across a schema change.
