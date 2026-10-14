#!/bin/sh
# Health, signup, login, and worker heartbeat against a running OnlySongs stack.
set -eu
cd "$(dirname "$0")/.."

BASE="${BASE_URL:-http://127.0.0.1:3000}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.ci.yml}"

echo "waiting for ${BASE}/api/health"
ready=0
i=0
while [ "$i" -lt 60 ]; do
  if curl -fsS "${BASE}/api/health" >/dev/null 2>&1; then
    ready=1
    break
  fi
  i=$((i + 1))
  sleep 2
done
if [ "$ready" -ne 1 ]; then
  echo "health check did not succeed" >&2
  exit 1
fi

body=$(curl -fsS "${BASE}/api/health")
printf '%s' "$body" | grep -q '"ok":true'

email="smoke-$(date +%s)@example.com"
password="smoke-pass-1"
signup=$(curl -fsS -c /tmp/onlysongs-smoke-cookies \
  -H "content-type: application/json" \
  -d "{\"email\":\"${email}\",\"password\":\"${password}\"}" \
  "${BASE}/api/auth/signup")
printf '%s' "$signup" | grep -q '"ok":true'
grep -q pb_session /tmp/onlysongs-smoke-cookies

login=$(curl -fsS -c /tmp/onlysongs-smoke-login \
  -H "content-type: application/json" \
  -d "{\"email\":\"${email}\",\"password\":\"${password}\"}" \
  "${BASE}/api/auth/login")
printf '%s' "$login" | grep -q '"ok":true'
grep -q pb_session /tmp/onlysongs-smoke-login

code=$(curl -s -o /tmp/onlysongs-smoke-status -w "%{http_code}" "${BASE}/api/status")
if [ "$code" != "401" ]; then
  echo "signed-out status returned ${code}" >&2
  exit 1
fi

echo "waiting for worker heartbeat"
i=0
while [ "$i" -lt 30 ]; do
  beat=$(docker compose -f "$COMPOSE_FILE" exec -T redis redis-cli GET worker:heartbeat | tr -d "\r")
  if [ -n "$beat" ] && [ "$beat" != "(nil)" ]; then
    echo "smoke checks passed"
    exit 0
  fi
  i=$((i + 1))
  sleep 2
done

echo "worker heartbeat was missing" >&2
exit 1
