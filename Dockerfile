# Multi-stage build: the runtime image has production dependencies only and
# runs as the unprivileged `node` user. Web and worker share this image;
# PROCESS selects the role in docker/entrypoint.sh.
FROM node:22-alpine AS base
RUN apk add --no-cache openssl
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM deps AS build
COPY . .
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN npm run build && npm run build:worker && rm -rf .next/cache

FROM base AS prod-deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
# postinstall runs `prisma generate` for the production client.
RUN npm ci --omit=dev && npm cache clean --force

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json next.config.ts ./
COPY --chown=node:node prisma ./prisma
COPY --chmod=755 docker/entrypoint.sh /entrypoint.sh
USER node
EXPOSE 3000
ENTRYPOINT ["/entrypoint.sh"]
