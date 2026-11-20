-- V17: what the tool returned to the agent ("what the agent saw").
ALTER TABLE "AgentEvent" ADD COLUMN "result" JSONB;
