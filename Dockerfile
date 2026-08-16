FROM node:22-alpine AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json tsconfig.build.json ./
COPY apps ./apps
COPY packages ./packages

RUN pnpm build && pnpm prune --prod

FROM node:22-alpine AS runtime

ARG APP_VERSION=development
ENV NODE_ENV=production
ENV APP_VERSION=$APP_VERSION
WORKDIR /app

LABEL org.opencontainers.image.title="NOX" \
      org.opencontainers.image.revision="$APP_VERSION"

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/packages/database/drizzle ./migrations

USER node
EXPOSE 3000

CMD ["node", "dist/server.js"]
