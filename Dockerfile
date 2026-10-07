# syntax=docker/dockerfile:1.7
# Precious in one image: the app, PostgreSQL and a small supervisor (s6-overlay), so it
# runs with a single container and one /data volume (e.g. on Unraid).

ARG NODE_VERSION=24
# Override to build on a different base, e.g. one that trusts a company proxy's certificate.
ARG NODE_IMAGE=node:${NODE_VERSION}-bookworm-slim
ARG PG_MAJOR=18
ARG S6_OVERLAY_VERSION=3.2.1.0

# ---------------------------------------------------------------- build
FROM ${NODE_IMAGE} AS build
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 CI=1
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages packages
COPY apps apps
COPY docker/prune-server-deps.sh docker/
RUN pnpm --filter @precious/web build && pnpm --filter @precious/server build
# The server with its production dependencies only.
RUN pnpm --filter @precious/server --config.inject-workspace-packages=true deploy --prod /out \
  && sh docker/prune-server-deps.sh /out

# ---------------------------------------------------------------- runtime
FROM ${NODE_IMAGE}
ARG PG_MAJOR
ARG S6_OVERLAY_VERSION
ARG TARGETARCH
ARG VERSION=0.0.0-dev

# PostgreSQL from its own repository (Debian's is a version behind). No default cluster:
# the database lives in /data/postgres, created on first start.
ADD https://www.postgresql.org/media/keys/ACCC4CF8.asc /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates tzdata xz-utils \
  && mkdir -p /etc/postgresql-common \
  && echo 'create_main_cluster = false' > /etc/postgresql-common/createcluster.conf \
  && chmod 644 /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends "postgresql-${PG_MAJOR}" \
  && rm -rf /var/lib/apt/lists/*

# s6-overlay starts PostgreSQL, then the app, and stops them cleanly in reverse order.
ADD https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-noarch.tar.xz /tmp/
ADD https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-x86_64.tar.xz /tmp/
ADD https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-aarch64.tar.xz /tmp/
RUN tar -C / -Jxpf /tmp/s6-overlay-noarch.tar.xz \
  && case "${TARGETARCH}" in \
       amd64) tar -C / -Jxpf /tmp/s6-overlay-x86_64.tar.xz ;; \
       arm64) tar -C / -Jxpf /tmp/s6-overlay-aarch64.tar.xz ;; \
       *) echo "unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
     esac \
  && rm /tmp/s6-overlay-*.tar.xz

RUN groupadd -g 1000 precious 2>/dev/null || groupadd precious; \
    useradd -o -u 1000 -g precious -d /data -s /usr/sbin/nologin precious

COPY --from=build /out /app/server
COPY --from=build /src/apps/web/dist /app/web
COPY recipes /app/recipes
COPY docker/rootfs /

ENV PATH="/usr/lib/postgresql/${PG_MAJOR}/bin:${PATH}" \
    PG_MAJOR=${PG_MAJOR} \
    PRECIOUS_VERSION=${VERSION} \
    NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    PUBLIC_URL=http://localhost:8080 \
    UPLOAD_DIR=/data/uploads \
    BACKUP_DIR=/data/backups \
    WEB_DIST_DIR=/app/web \
    MIGRATIONS_DIR=/app/server/drizzle \
    RECIPES_DIR=/app/recipes \
    PUID=1000 \
    PGID=1000 \
    TZ=Etc/UTC \
    S6_BEHAVIOUR_IF_STAGE2_FAILS=2 \
    S6_CMD_WAIT_FOR_SERVICES_MAXTIME=0 \
    S6_SERVICES_GRACETIME=8000 \
    S6_VERBOSITY=1

VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

LABEL org.opencontainers.image.title="Precious" \
      org.opencontainers.image.description="A self-hosted collection manager for a whole household" \
      org.opencontainers.image.source="https://github.com/vidocco/precious" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}"

ENTRYPOINT ["/init"]
