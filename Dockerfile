FROM node:24-slim AS base

# Install native build dependencies required by better-sqlite3
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    sqlite3 \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy workspace manifests first for better layer caching
COPY package.json ./
COPY packages/entity-matcher/package.json ./packages/entity-matcher/
COPY server/package.json ./server/
COPY ui/package.json ./ui/

# Install root + workspace dependencies
RUN npm install

COPY .git ./.git

# Copy source code
COPY packages/entity-matcher ./packages/entity-matcher
COPY server ./server
COPY ui ./ui
COPY scripts ./scripts

# Build the UI static export
RUN npm run build

# Runtime stage: keep only what we need
FROM node:24-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    sqlite3 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy installed dependencies and built app from base stage
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/packages ./packages
COPY --from=base /app/server ./server
COPY --from=base /app/ui ./ui
COPY --from=base /app/scripts ./scripts
COPY --from=base /app/package.json ./

# Create runtime directories; these should be mounted as volumes in production
RUN mkdir -p /app/server/database /app/server/documents /app/server/logs /app/server/tmp

# Expose the architxt HTTP port
EXPOSE 3000

# Use exec form so node becomes PID 1 and receives signals cleanly
CMD ["node", "server/src/index.js"]
