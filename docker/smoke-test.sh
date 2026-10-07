#!/usr/bin/env bash
# Starts the image with a fresh /data, sets up a household, adds an item, makes a backup,
# restarts the container and checks everything is still there.
# Usage: docker/smoke-test.sh [image] (default precious:test)
set -euo pipefail

IMAGE="${1:-precious:test}"
NAME="precious-smoke-$$"
VOLUME="precious-smoke-$$"
PORT="${SMOKE_PORT:-18080}"
BASE="http://127.0.0.1:${PORT}"
JAR="$(mktemp)"

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker volume rm "$VOLUME" >/dev/null 2>&1 || true
  rm -f "$JAR"
}
trap cleanup EXIT

fail() {
  echo "FAILED: $*" >&2
  docker logs "$NAME" 2>&1 | tail -40 >&2 || true
  exit 1
}

wait_healthy() {
  for _ in $(seq 1 90); do
    if curl -fsS "$BASE/api/health" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  fail "the app didn't become healthy"
}

api() { # method path [json]
  curl -fsS -X "$1" "$BASE$2" -b "$JAR" -c "$JAR" -H "origin: $BASE" -H 'content-type: application/json' ${3:+--data "$3"}
}

echo "-- starting $IMAGE"
docker run -d --name "$NAME" -p "127.0.0.1:${PORT}:8080" -v "$VOLUME:/data" -e PUID=1234 -e PGID=1234 \
  -e PUBLIC_URL="$BASE" "$IMAGE" >/dev/null
wait_healthy
curl -fsS "$BASE/api/health" | grep -q '"database":"up"' || fail "database not up"

echo "-- setting up a household"
api POST /api/setup '{"name":"Smoke Test","email":"smoke@example.com","password":"correct-horse-battery"}' >/dev/null
api POST /api/auth/sign-in/email '{"email":"smoke@example.com","password":"correct-horse-battery"}' >/dev/null
TEMPLATE="$(api GET /api/templates | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).find(t=>t.name==="Books").id))')"
COLLECTION="$(api POST /api/collections "{\"templateId\":\"$TEMPLATE\",\"name\":\"Smoke shelf\"}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).id))')"
api POST "/api/collections/$COLLECTION/items" '{"title":"Rayuela","data":{"author":"Julio Cortázar"}}' >/dev/null

echo "-- uploading a cover (sharp)"
curl -fsS -X POST "$BASE/api/images" -b "$JAR" -H "origin: $BASE" -F "file=@apps/web/public/icons/icon-192.png;type=image/png" \
  | grep -q '"width":192' || fail "image upload"

echo "-- scraping a page (jsdom): the app's own page, so no internet is needed"
SOURCE="$(api POST /api/sources '{"name":"Self","baseUrl":"http://127.0.0.1:8080"}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).id))')"
api POST "/api/sources/$SOURCE/run" '{"endpoint":{"key":"page","name":"Page","role":"lookup","kind":"html","extract":{"title":{"css":"title"}},"map":{"title":"title"}}}' \
  | grep -q '"output":{"title":"Precious"}' || fail "HTML scraping"

echo "-- backing up"
api POST /api/server/backups '{}' | grep -q '"ok":true' || fail "backup failed"

echo "-- checking /data"
docker exec "$NAME" sh -c 'stat -c "%u:%g %n" /data/uploads /data/backups /data/postgres /data/.app-secret' | grep -v '^1234:1234 ' && fail "wrong owner in /data" || true
docker exec "$NAME" sh -c 'ls /data/backups' | grep -q '^precious-.*\.dump$' || fail "no backup file"

echo "-- restarting"
docker restart "$NAME" >/dev/null
wait_healthy
# The app secret was kept, so the session cookie still works after a restart.
api GET "/api/collections/$COLLECTION/items" | grep -q 'Rayuela' || fail "item lost after restart"

echo "-- the web app and its service worker are served"
curl -fsS "$BASE/" | grep -q '<div id="root">' || fail "no web app"
curl -fsSI "$BASE/sw.js" | grep -qi 'cache-control: no-cache' || fail "service worker headers"

echo "OK: $IMAGE works"
