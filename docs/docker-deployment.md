# Docker deployment

Curioflow publishes a production image to the GitHub Container Registry:

```text
ghcr.io/zellux/curioflow-web
```

Every push to `main` publishes `latest` and an immutable `sha-<short-sha>`
tag. Version tags such as `v1.2.3` publish a matching image tag. The workflow
can also be started manually from GitHub Actions.

## Configure

Copy `.env.example` to `.env` and set `POSTGRES_PASSWORD`, `DATABASE_URL`,
`CURIOFLOW_APP_URL`, and `CURIOFLOW_SECRET_KEY`. In Compose, the database hostname
is `db`, not `localhost`. The app URL must be the HTTPS address served by your
reverse proxy. The default stack publishes port 3000 and creates its own network;
no pre-existing Docker network is required.

To pin a
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
`worker` start.

## Create your first account

On a fresh installation with no accounts yet, open your Curioflow URL in a
browser and create the owner account on the initial setup page. Once that
account exists, web registration closes automatically.

To create the first account—or additional accounts—from the command line instead,
run `npm run user:create` inside the published image (which includes
`scripts/create-user.mjs` and its dependencies):

```sh
docker compose -f docker-compose.prod.yml run --rm \
  -e USERNAME=reader \
  -e EMAIL=reader@example.com \
  -e PASSWORD='replace-with-a-strong-password' \
  app npm run user:create
```

If `app` is already running, you can also run `docker compose -f docker-compose.prod.yml exec -e ... app npm run user:create`.
When using the external reverse proxy override, include `-f docker-compose.proxy.yml` in the command as well.

> **Do I need the `seed` service?** No. Both first-run setup and `npm run user:create`
> create the account, personal library, and `Saved URLs` source automatically. The
> optional `admin` profile's `seed` service only creates a passwordless placeholder
> workspace for local development:
>
> ```sh
> docker compose -f docker-compose.prod.yml --profile admin run --rm seed
> ```

### External reverse proxy

If a reverse proxy reaches Curioflow over an existing Docker network, include
the proxy override in every Compose command:

```sh
CURIOFLOW_PROXY_NETWORK=docker_default \
  docker compose \
  -f docker-compose.prod.yml \
  -f docker-compose.proxy.yml \
  up -d --remove-orphans
```

The override removes the host port from `app`, exposes port `3000` only to
Docker networks, and attaches `app` to the configured external network. Run
`pull`, `ps`, and admin commands with the same two `-f` arguments.

## Roll back

Set `CURIOFLOW_IMAGE` to an earlier immutable `sha-<short-sha>` tag and repeat
the deploy commands. Do not remove the Postgres or storage volumes during a
rollback. Review any already-applied database migration before rolling the
application image back across a schema change.
