FROM node:22-bookworm-slim

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .

RUN DATABASE_URL="postgresql://curioflow:curioflow@db:5432/curioflow?schema=public" npm run db:generate:prod \
  && npm run build \
  && chmod +x scripts/docker-start.sh

EXPOSE 3000

CMD ["./scripts/docker-start.sh"]
