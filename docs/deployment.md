# Deploying the demo on a VPS (Dokploy)

> **Not maintained since V12**: the demo runs on `localhost` only and has no sign-in, so it must
> not be exposed as is. Kept for reference.

The whole stack runs from `compose.yaml` (profile `apps`): Postgres, Redis, the five apps, and
optionally self-hosted Langfuse (profile `langfuse`). Images are built from the repository with
`infra/docker/app.Dockerfile` (one image per app, `turbo prune --docker`).

## 1. Server

- A VPS with 4 vCPU / 8 GB RAM (16 GB with self-hosted Langfuse), Docker, and
  [Dokploy](https://dokploy.com) installed (`curl -sSL https://dokploy.com/install.sh | sh`).
- Two DNS records pointing to it, on the **same parent domain** so the session cookie is
  same-site: `demo.example.com` (web) and `api.demo.example.com` (Core API); optionally
  `sim.demo.example.com` (simulator, for the demo panel) and `langfuse.demo.example.com`.

## 2. Dokploy project

1. Create a project, then a **Compose** service from this Git repository, compose file
   `compose.yaml`, command `docker compose --profile apps up -d --build` (add `--profile langfuse`
   for self-hosted traces).
2. **Environment**: paste the variables of `.env.example` with real values. On top of the secrets
   (`OPENAI_API_KEY`, `ADMIN_TOKEN`, `CORE_SERVICE_TOKEN`, `MCP_TOKEN_SECRET`,
   `INBOUND_EMAIL_TOKEN`, `MASTRA_API_TOKEN` — 32 random characters each), set the public URLs, which
   are built into the web image:
   ```
   NEXT_PUBLIC_CORE_API_URL=https://api.demo.example.com
   NEXT_PUBLIC_SIMULATOR_URL=https://sim.demo.example.com
   NEXT_PUBLIC_LANGFUSE_URL=https://langfuse.demo.example.com   # or https://cloud.langfuse.com
   WEB_ORIGIN=https://demo.example.com
   COOKIE_SECURE=true
   DEMO_MODE=true
   DEMO_BROKER_PASSWORD=<the password you give Panora>
   ```
3. **Domains** (Dokploy → Domains, HTTPS with Let's Encrypt): `web:3000` → `demo.example.com`,
   `core-api:3001` → `api.demo.example.com`, `simulator:3003` → `sim.demo.example.com`,
   `langfuse-web:3000` → `langfuse.demo.example.com`. Do **not** expose the MCP server, Mastra,
   Postgres or Redis.
4. Deploy. The simulator seeds the databases on start; the demo panel's **Reset** puts everything
   back in its initial state.

## 3. Demo accounts and budget

- The sign-in page lists the seeded brokers; they all use `DEMO_BROKER_PASSWORD`.
- Cap the OpenAI spend of the project's key (OpenAI dashboard → limits): at about $0.0035 per case,
  the e-mail stream at 4 e-mails/min costs about $0.85 per hour of demo. For an unattended public
  demo, `AGENTS_MODE=simulated` keeps everything working at no cost (the agents' answers are then
  deterministic stand-ins).
- Data is on tmpfs, as in development: a redeploy starts from a fresh seed.
