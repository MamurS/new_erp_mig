# Images of the deployment (BACKEND_SPEC §11), built from the repository root:
#
#   docker build -f deploy/Dockerfile --target api   -t mig-api .
#   docker build -f deploy/Dockerfile --target caddy -t mig-caddy .
#
# - build:  npm ci, the API bundle (esbuild → apps/api/dist/{server,worker}.js) and the web app built for the real
#           backend (VITE_USE_MOCKS=false, VITE_DEMO_MODE=false: no demo code in the bundle at all);
# - api:    Node 20 (Alpine) with the bundle, the production node_modules of the API (fastify, pg), the help
#           articles and the deploy scripts; runs as the unprivileged `node` user; the worker is the same image
#           with `node apps/api/dist/worker.js`;
# - caddy:  Caddy with the built web app and deploy/Caddyfile.
#
# Behind a TLS-intercepting proxy: `--build-arg HTTPS_PROXY=…` and `--secret id=npm_ca,src=<CA bundle>`.

ARG NODE_IMAGE=node:20.20.2-alpine3.23
ARG CADDY_IMAGE=caddy:2.11.7-alpine

# ---------------------------------------------------------------- build
FROM ${NODE_IMAGE} AS build
WORKDIR /src
ENV CI=true NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false NPM_CONFIG_UPDATE_NOTIFIER=false
# Manifests first: the dependency layer is reused while package-lock.json does not change.
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY packages/contracts/package.json packages/contracts/
COPY packages/domain/package.json packages/domain/
COPY packages/i18n/package.json packages/i18n/
COPY packages/seed/package.json packages/seed/
RUN --mount=type=secret,id=npm_ca,required=false \
    if [ -s /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca npm_config_cafile=/run/secrets/npm_ca; fi; \
    npm ci --ignore-scripts
COPY . .
ENV VITE_USE_MOCKS=false VITE_DEMO_MODE=false
RUN npm run api:build \
 && npm run build -w @mig/web \
 && rm -f apps/web/dist/mockServiceWorker.js apps/web/dist/_headers
# Production dependencies of the API only (the bundle keeps fastify, pg and sharp external).
RUN --mount=type=secret,id=npm_ca,required=false \
    if [ -s /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca npm_config_cafile=/run/secrets/npm_ca; fi; \
    mkdir -p /out && cp package.json package-lock.json /out/ && mkdir -p /out/apps/api && cp apps/api/package.json /out/apps/api/ \
 && for p in contracts domain i18n seed; do mkdir -p /out/packages/$p && cp packages/$p/package.json /out/packages/$p/; done \
 && mkdir -p /out/apps/web && cp apps/web/package.json /out/apps/web/ \
 && cd /out && npm ci --omit=dev --ignore-scripts --workspace=@mig/api --include-workspace-root=false \
 && rm -rf /out/node_modules/@mig /out/node_modules/.package-lock.json

# ---------------------------------------------------------------- api (and worker)
FROM ${NODE_IMAGE} AS api
ENV NODE_ENV=production APP_ENV=production HOST=0.0.0.0 PORT=8787
WORKDIR /app
COPY --from=build --chown=root:root /out/node_modules ./node_modules
COPY --from=build --chown=root:root /src/apps/api/dist/server.js /src/apps/api/dist/server.js.map /src/apps/api/dist/worker.js /src/apps/api/dist/worker.js.map /src/apps/api/dist/provision-demo.js ./apps/api/dist/
COPY --from=build --chown=root:root /src/docs/help ./docs/help
COPY --from=build --chown=root:root /src/deploy/scripts/create-admin.mjs ./deploy/scripts/
# The image is read-only for the process: the code belongs to root, the process runs as `node`.
USER node
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/auth/me').then(r=>process.exit(r.status<500?0:1),()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "apps/api/dist/server.js"]

# ---------------------------------------------------------------- caddy (TLS, the web app, /api → api)
FROM ${CADDY_IMAGE} AS caddy
COPY --from=build /src/apps/web/dist /srv/web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
