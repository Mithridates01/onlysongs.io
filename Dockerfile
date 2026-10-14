FROM node:22-alpine
WORKDIR /app

RUN apk add --no-cache openssl

COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci

COPY . .
ENV DATABASE_URL=postgresql://blocker:blocker@localhost:5432/blocker
RUN npx prisma generate && npm run build && npm run build:worker

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["/entrypoint.sh"]
