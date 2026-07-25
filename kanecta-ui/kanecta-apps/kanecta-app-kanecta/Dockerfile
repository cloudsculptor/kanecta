# kanecta.io static image (SPA built by vite, served by nginx, /api/ proxied
# to the kanecta-api container — see nginx.conf). Mirrors
# kanecta-app-studio/Dockerfile exactly, adjusted for this app's path.
#
# BUILD FROM THE MONOREPO ROOT (this app depends on @kanecta/* npm
# workspaces, which do not resolve from this directory alone):
#
#   docker build -f kanecta-ui/kanecta-apps/kanecta-app-kanecta/Dockerfile \
#     --build-arg VITE_KEYCLOAK_URL=https://auth.example.com \
#     --build-arg VITE_KEYCLOAK_REALM=kanecta \
#     --build-arg VITE_KEYCLOAK_CLIENT_ID=kanecta \
#     -t kanecta-app .
#
# VITE_* values are baked at build time (vite inlines import.meta.env), so a
# deployment builds its own image with its own Keycloak. Runtime injection
# (one generic image + an entrypoint-written config.js) needs source support
# first — same follow-up as Studio. Omit the args (or set
# VITE_AUTH_DISABLED=true) for a local unauthenticated image.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY . .
RUN npm ci
ARG VITE_KEYCLOAK_URL
ARG VITE_KEYCLOAK_REALM
ARG VITE_KEYCLOAK_CLIENT_ID
ARG VITE_AUTH_DISABLED
ENV VITE_KEYCLOAK_URL=$VITE_KEYCLOAK_URL \
    VITE_KEYCLOAK_REALM=$VITE_KEYCLOAK_REALM \
    VITE_KEYCLOAK_CLIENT_ID=$VITE_KEYCLOAK_CLIENT_ID \
    VITE_AUTH_DISABLED=$VITE_AUTH_DISABLED
RUN npm --prefix kanecta-ui/kanecta-apps/kanecta-app-kanecta run build

FROM nginx:alpine
COPY --from=build /app/kanecta-ui/kanecta-apps/kanecta-app-kanecta/dist /usr/share/nginx/html
COPY kanecta-ui/kanecta-apps/kanecta-app-kanecta/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
