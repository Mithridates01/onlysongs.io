#!/bin/sh
set -e
# A command given to the container (Railway's pre-deploy step, `docker run ... cmd`) runs as is.
if [ "$#" -gt 0 ]; then
  exec "$@"
fi
# Railway runs migrations once per deploy as a pre-deploy command
# (.railway/railway.ts). Self-hosted Compose sets RUN_MIGRATIONS=1 instead.
if [ "$RUN_MIGRATIONS" = "1" ]; then
  node_modules/.bin/prisma migrate deploy
fi
if [ "$PROCESS" = "worker" ]; then
  exec node dist/worker.js
fi
exec node_modules/.bin/next start -H 0.0.0.0 -p "${PORT:-3000}"
