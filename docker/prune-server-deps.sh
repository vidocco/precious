#!/bin/sh
# Removes packages the server never loads from its production install. They arrive only
# as optional peers of better-auth (its React, Vite and Vitest integrations, resolved
# from elsewhere in the workspace) or as build tools, and add ~150 MB to the image.
# The smoke test (docker/smoke-test.sh) checks the server still starts and works.
set -eu
cd "$1/node_modules/.pnpm"
for dir in *; do
  case "$dir" in
    esbuild@* | @esbuild+* | @esbuild-kit+* | rolldown@* | @rolldown+* | lightningcss* | \
    vite@* | vitest@* | @vitest+* | react@* | react-dom@* | scheduler@* | drizzle-kit@* | tsx@* | jiti@* | \
    @img+sharp-linuxmusl-* | @img+sharp-libvips-linuxmusl-*)
      rm -rf "$dir" ;;
  esac
done
