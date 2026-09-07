# syntax=docker/dockerfile:1

# --- Stage 1: build -------------------------------------------------------
# Compiles TypeScript to dist/ and generates the Prisma client. Carries the
# full dependency tree (dev + prod); only the pruned prod tree is copied out.
FROM node:22-slim AS builder
ENV HUSKY=0
WORKDIR /app

# Install deps against the lockfile. `postinstall` runs `prisma generate`, so
# the schema, prisma.config.ts and the tsconfig it infers output settings from
# all have to be present first.
COPY package.json package-lock.json prisma.config.ts tsconfig.json tsconfig.build.json nest-cli.json ./
COPY prisma ./prisma
RUN npm ci

# Build.
COPY src ./src
RUN npm run build

# Drop dev dependencies so the runtime stage copies a minimal node_modules.
RUN npm prune --omit=dev

# --- Stage 2: runtime ---------------------------------------------------------
FROM node:22-slim AS runner
ENV NODE_ENV=production
WORKDIR /app

# node:22-slim ships a non-root `node` user (uid 1000).
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./

USER node
EXPOSE 3000

# PORT is read from the validated env (defaults to 3000). Every other required
# variable must be supplied at run time or the process exits on boot.
CMD ["node", "dist/main"]
