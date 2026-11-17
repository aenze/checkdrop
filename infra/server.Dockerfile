FROM node:26-alpine AS build
RUN corepack enable
WORKDIR /workspace
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @checkdrop/server... build
RUN pnpm --filter @checkdrop/server deploy --prod --legacy /output

FROM node:26-alpine AS runtime
RUN apk add --no-cache unzip
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /output ./
EXPOSE 8787
USER node
CMD ["node", "dist/server.js"]
