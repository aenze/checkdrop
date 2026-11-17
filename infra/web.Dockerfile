# The administration and its web server. CHECKDROP_WEB_TARGET=app is the image every installation
# runs; "site" builds the checkdrop.dev marketing website with infra/site/Caddyfile.
ARG CHECKDROP_WEB_TARGET=app
ARG CADDYFILE=infra/web/Caddyfile

FROM node:26-alpine AS build
ARG CHECKDROP_WEB_TARGET
# Only the hosted checkdrop.dev website sets it: the site key of its own inquiry form.
ARG PUBLIC_CHECKDROP_INQUIRY_SITE=
RUN corepack enable
WORKDIR /workspace
COPY . .
RUN pnpm install --frozen-lockfile
RUN CHECKDROP_WEB_TARGET=${CHECKDROP_WEB_TARGET} PUBLIC_CHECKDROP_INQUIRY_SITE=${PUBLIC_CHECKDROP_INQUIRY_SITE} pnpm --filter @checkdrop/web... build

FROM caddy:2.10.2-alpine AS runtime
ARG CADDYFILE
COPY ${CADDYFILE} /etc/caddy/Caddyfile
COPY --from=build /workspace/apps/web/dist /srv
RUN addgroup -g 10001 -S checkdrop \
  && adduser -u 10001 -S -D -H -G checkdrop checkdrop \
  && mkdir -p /config /data \
  && chown -R checkdrop:checkdrop /srv /config /data \
  && setcap -r /usr/bin/caddy
USER checkdrop
EXPOSE 8080
