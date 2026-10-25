# Production image for crm.n3rdlabs.dev (deploy/compose.yml builds it on the netcup box).
# The full node_modules stays in the image on purpose: the Prisma CLI (migrate deploy) and tsx
# (seed, email worker, scripts/create-admin.ts) all run from it.
FROM node:22-bookworm-slim

WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates tzdata \
  && rm -rf /var/lib/apt/lists/*

# prisma.config.ts reads DATABASE_URL eagerly, so install/generate/build need a placeholder.
# Nothing connects at build time, and an ARG never reaches the runtime image.
ARG DATABASE_URL="postgresql://build:build@localhost:5432/build"

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
# storage/ is where uploads, finding photos and report PDFs land (see README); compose mounts a
# volume over it, and a fresh named volume takes this directory's ownership.
RUN npx prisma generate && npm run build \
  && mkdir -p .next/cache storage \
  && chown -R node:node .next storage

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1
USER node
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
