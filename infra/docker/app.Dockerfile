# One image per app, built from the repository root:
#   docker build -f infra/docker/app.Dockerfile --build-arg APP=mcp-extranet .
FROM node:24-slim AS base
ARG APP
ENV APP=${APP}

FROM base AS pruner
WORKDIR /repo
COPY . .
RUN npx --yes turbo@2.11.12 prune @demo/${APP} --docker

FROM base AS builder
WORKDIR /repo
COPY --from=pruner /repo/out/json/ .
RUN npm ci
COPY --from=pruner /repo/out/full/ .
RUN npx turbo run build --filter=@demo/${APP}

FROM base AS runner
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=builder --chown=node:node /repo .
USER node
CMD npm run start -w apps/${APP}
