#!/usr/bin/env bash
# Checks that a new image takes over the /data of an older one without losing or changing
# anything, and that the older image still starts on that data afterwards (a rollback).
# Usage: docker/upgrade-test.sh <old image> <new image>
set -euo pipefail

OLD="$1"
NEW="$2"
NAME="precious-upgrade-$$"
VOLUME="precious-upgrade-$$"
PORT="${SMOKE_PORT:-18081}"
BASE="http://127.0.0.1:${PORT}"
JAR="$(mktemp)"
BEFORE="$(mktemp)"
AFTER="$(mktemp)"

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker volume rm "$VOLUME" >/dev/null 2>&1 || true
  rm -f "$JAR" "$BEFORE" "$AFTER"
}
trap cleanup EXIT

fail() {
  echo "FAILED: $*" >&2
  docker logs "$NAME" 2>&1 | tail -40 >&2 || true
  exit 1
}

start() { # image
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker run -d --name "$NAME" -p "127.0.0.1:${PORT}:8080" -v "$VOLUME:/data" -e PUBLIC_URL="$BASE" "$1" >/dev/null
  for _ in $(seq 1 90); do
    if curl -fsS "$BASE/api/health" 2>/dev/null | grep -q '"database":"up"'; then return 0; fi
    sleep 1
  done
  fail "$1 didn't become healthy"
}

stop() {
  docker stop -t 30 "$NAME" >/dev/null
}

api() { # method path [json]
  curl -fsS -X "$1" "$BASE$2" -b "$JAR" -c "$JAR" -H "origin: $BASE" -H 'content-type: application/json' ${3:+--data "$3"}
}

json() { # expression over the JSON on stdin, as `d`
  node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{const d=JSON.parse(s);console.log($1)})"
}

# What must survive an upgrade unchanged: templates as stored, and every item with its cover.
snapshot() {
  {
    api GET /api/templates | json 'JSON.stringify(d.map(t=>({id:t.id,name:t.name,version:t.version,fields:t.fields,card:t.card,itemLayout:t.itemLayout,shelf:t.shelf})).sort((a,b)=>a.id.localeCompare(b.id)))'
    api GET "/api/collections/$COLLECTION/items" | json 'JSON.stringify((d.items??d).map(i=>({id:i.id,title:i.title,data:i.data,cover:i.cover?.id??null})))'
  }
}

echo "-- $OLD: setting up a household with an item and a cover"
start "$OLD"
api POST /api/setup '{"name":"Upgrade Test","email":"upgrade@example.com","password":"correct-horse-battery"}' >/dev/null
api POST /api/auth/sign-in/email '{"email":"upgrade@example.com","password":"correct-horse-battery"}' >/dev/null
TEMPLATE="$(api GET /api/templates | json 'd.find(t=>t.name==="Books").id')"
COLLECTION="$(api POST /api/collections "{\"templateId\":\"$TEMPLATE\",\"name\":\"Books\"}" | json 'd.id')"
COVER="$(curl -fsS -X POST "$BASE/api/images" -b "$JAR" -H "origin: $BASE" -F "file=@apps/web/public/icons/icon-192.png;type=image/png" | json 'd.id')"
api POST "/api/collections/$COLLECTION/items" "{\"title\":\"Rayuela\",\"coverImageId\":\"$COVER\",\"data\":{\"author\":\"Julio Cortázar\",\"pages\":736}}" >/dev/null
api POST /api/server/backups '{}' | grep -q '"ok":true' || fail "backup on $OLD"
snapshot >"$BEFORE"
grep -q '"Rayuela"' "$BEFORE" && grep -q '"Books"' "$BEFORE" || fail "empty snapshot"
stop

echo "-- $NEW: taking over the same /data"
start "$NEW"
# Same app secret, so the session from before still works.
snapshot >"$AFTER"
diff -u "$BEFORE" "$AFTER" || fail "data changed when $NEW started"
curl -fsS -o /dev/null "$BASE/media/$COVER/sm" -b "$JAR" || fail "cover not served by $NEW"
api GET /api/server/backups | grep -q 'precious-.*\.dump' || fail "backups not listed by $NEW"
api POST "/api/collections/$COLLECTION/items" '{"title":"Ficciones","data":{"author":"Jorge Luis Borges"}}' >/dev/null
# Save the template as the new version would (with a shelf order, if it has them), and give the
# collection its own order, then roll back.
api PUT "/api/templates/$TEMPLATE" "$(api GET /api/templates | json 'JSON.stringify((({id,createdBy,version,createdAt,updatedAt,usage,canEdit,...t})=>({...t,shelf:{...t.shelf,arrange:[{ref:"author",marker:true},{ref:"$title"}]}}))(d.find(t=>t.name==="Books")))')" >/dev/null
api PATCH "/api/collections/$COLLECTION" '{"arrangement":[{"ref":"$title","marker":false}]}' >/dev/null || echo "   ($NEW has no collection shelf orders)"
stop

echo "-- $OLD again: rolling back onto data the new version wrote"
start "$OLD"
api GET "/api/collections/$COLLECTION" | grep -q '"Books"' || fail "$OLD can't read the collection after the rollback"
api GET "/api/collections/$COLLECTION/items" | grep -q 'Ficciones' || fail "$OLD lost items after the rollback"
api GET /api/templates | grep -q '"Books"' || fail "$OLD can't read templates after the rollback"
api PUT "/api/templates/$TEMPLATE" "$(api GET /api/templates | json 'JSON.stringify((({id,createdBy,version,createdAt,updatedAt,usage,canEdit,...t})=>t)(d.find(t=>t.name==="Books")))')" >/dev/null \
  || fail "$OLD can't save the template after the rollback"
api PATCH "/api/collections/$COLLECTION" '{"name":"Books again"}' >/dev/null || fail "$OLD can't change the collection after the rollback"
stop

echo "OK: $NEW upgrades from $OLD, and $OLD still runs on its data"
