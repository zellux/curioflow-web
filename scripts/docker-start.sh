#!/bin/sh
set -eu

npx prisma migrate deploy --schema prisma/postgres/schema.prisma
npm run db:seed:prod

exec npm run start
