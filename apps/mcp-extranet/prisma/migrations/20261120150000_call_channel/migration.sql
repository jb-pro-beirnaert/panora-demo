-- V17: calls from the broker's UI (portal) next to the agents' MCP calls.
ALTER TABLE "CallLog" ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'mcp';
