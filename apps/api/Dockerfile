# Multi-stage Alpine image for the Holocron API.
ARG NODE_VERSION=22-alpine

# ---- builder ----
FROM node:${NODE_VERSION} AS builder
WORKDIR /repo

# Workspace manifests first for cache-friendly installs.
COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

# Install all workspace deps so the API can build with its dev deps.
RUN npm ci --workspaces --include-workspace-root

# Then copy the API source and build.
COPY apps/api ./apps/api
RUN npm --workspace apps/api run build

# Prune to production deps only (for the runtime image).
RUN npm ci --workspace apps/api --omit=dev --include-workspace-root

# ---- runtime ----
FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Copy the pruned node_modules + built JS + manifests for npm run scripts.
COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /repo/apps/api/dist ./apps/api/dist
COPY --from=builder /repo/apps/api/package.json ./apps/api/package.json
COPY --from=builder /repo/package.json ./package.json

USER node
EXPOSE 3000
WORKDIR /app/apps/api
CMD ["node", "dist/main.js"]
