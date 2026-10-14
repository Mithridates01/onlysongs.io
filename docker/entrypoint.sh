#!/bin/sh
set -e
npx prisma migrate deploy
if [ "$PROCESS" = "worker" ]; then
  exec node dist/worker.js
fi
exec npx next start -H 0.0.0.0 -p 3000
