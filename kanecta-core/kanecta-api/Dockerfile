# kanecta-api server image.
#
# BUILD FROM THE MONOREPO ROOT (the api depends on @kanecta/* npm workspaces,
# which do not resolve from this directory alone):
#
#   docker build -f kanecta-core/kanecta-api/Dockerfile -t kanecta-api .
#
# bookworm-slim (glibc), not alpine: better-sqlite3 ships glibc prebuilds;
# musl would force a native toolchain build. Dev deps are installed because
# the runtime entrypoint is TypeScript executed via tsx (a devDependency) —
# trading image size for zero build-step drift; a compile-to-dist stage is a
# possible later optimisation, as is copying package manifests before source
# for better layer caching.
FROM node:22-bookworm-slim
WORKDIR /app
COPY . .
RUN npm ci

ENV NODE_ENV=production \
    PORT=3000 \
    KANECTA_API_HOST=0.0.0.0
# Runtime configuration (see .env.example): KANECTA_CONFIG (working sets),
# KEYCLOAK_URL, KEYCLOAK_REALM, KEYCLOAK_AUDIENCE — or AUTH_DISABLED=true for
# a local, never-production container.
EXPOSE 3000
CMD ["npm", "--prefix", "kanecta-core/kanecta-api", "start"]
