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
# Inlined into the web UI at build time (the URLs the browser uses).
ARG NEXT_PUBLIC_CORE_API_URL=http://localhost:3001
ARG NEXT_PUBLIC_SIMULATOR_URL=http://localhost:3003
ARG NEXT_PUBLIC_LANGFUSE_URL=http://localhost:3100
ARG NEXT_PUBLIC_LANGFUSE_PROJECT_ID=panora-demo
ARG NEXT_PUBLIC_MASTRA_STUDIO_URL=http://localhost:4111
ENV NEXT_PUBLIC_CORE_API_URL=${NEXT_PUBLIC_CORE_API_URL} \
    NEXT_PUBLIC_SIMULATOR_URL=${NEXT_PUBLIC_SIMULATOR_URL} \
    NEXT_PUBLIC_LANGFUSE_URL=${NEXT_PUBLIC_LANGFUSE_URL} \
    NEXT_PUBLIC_LANGFUSE_PROJECT_ID=${NEXT_PUBLIC_LANGFUSE_PROJECT_ID} \
    NEXT_PUBLIC_MASTRA_STUDIO_URL=${NEXT_PUBLIC_MASTRA_STUDIO_URL}
RUN npx turbo run build --filter=@demo/${APP}

FROM base AS runner
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=builder --chown=node:node /repo .
USER node
# The eval reports shown by the web UI's Evals screen (no-op for the other apps).
COPY --chown=node:node evals/reports /repo/evals/reports
CMD npm run start -w apps/${APP}
