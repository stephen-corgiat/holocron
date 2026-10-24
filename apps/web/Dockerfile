# Multi-stage Alpine image for the Holocron web SPA, served by nginx.

# ---- builder ----
FROM node:24-alpine AS builder
WORKDIR /repo

COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
RUN npm ci --workspaces --include-workspace-root

COPY apps/web ./apps/web
RUN npm --workspace apps/web run build

# ---- runtime ----
FROM nginx:1.29-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
