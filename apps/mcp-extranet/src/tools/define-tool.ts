import type { McpTokenScope } from '@demo/shared';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';
import type { Prisma } from '../generated/prisma/client.js';
import type { Db } from '../db.js';

/** Per-request context of a tool call. */
export interface ToolContext {
  db: Db;
  /** Brokerage of the calling token: tools only expose this brokerage's policies. */
  brokerCode: string;
  scope: McpTokenScope;
}

/** A tool either returns data, or an error message written for an LLM (what to try next). */
export type ToolOutcome = { data: Record<string, unknown> } | { error: string };

export interface ToolDefinition<Shape extends z.ZodRawShape> {
  name: string;
  description: string;
  inputSchema: Shape;
  /** When set, results are also returned as `structuredContent` (typed results for code callers). */
  outputSchema?: z.ZodRawShape;
  /** Defaults to a read-only tool. */
  annotations?: ToolAnnotations;
  handler: (args: z.infer<z.ZodObject<Shape>>, ctx: ToolContext) => Promise<ToolOutcome>;
}

export function defineTool<Shape extends z.ZodRawShape>(
  definition: ToolDefinition<Shape>,
): ToolDefinition<Shape> {
  return definition;
}

export async function logCall(
  ctx: ToolContext,
  tool: string,
  params: unknown,
  outcome: ToolOutcome,
  durationMs: number,
): Promise<void> {
  try {
    await ctx.db.callLog.create({
      data: {
        brokerCode: ctx.brokerCode,
        tool,
        params: params as Prisma.InputJsonValue,
        result: ('data' in outcome
          ? outcome.data
          : { error: outcome.error }) as Prisma.InputJsonValue,
        isError: 'error' in outcome,
        durationMs,
      },
    });
  } catch (error) {
    // Logging must never break a tool call.
    console.error(`Failed to write CallLog for ${tool}:`, error);
  }
}

/** Registers a tool that writes one `CallLog` row per call. */
export function registerTool<Shape extends z.ZodRawShape>(
  server: McpServer,
  ctx: ToolContext,
  definition: ToolDefinition<Shape>,
): void {
  // The SDK's generic callback type does not line up with a generic shape; the schema still
  // validates the arguments before the handler runs.
  const callback = async (args: z.infer<z.ZodObject<Shape>>): Promise<CallToolResult> => {
    const startedAt = Date.now();
    let outcome: ToolOutcome;
    try {
      outcome = await definition.handler(args, ctx);
    } catch (error) {
      console.error(`Tool ${definition.name} failed:`, error);
      outcome = { error: 'The extranet had an internal error. Retry the same call once.' };
    }
    await logCall(ctx, definition.name, args, outcome, Date.now() - startedAt);
    if ('error' in outcome) {
      return { isError: true, content: [{ type: 'text', text: outcome.error }] };
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(outcome.data, null, 2) }],
      ...(definition.outputSchema ? { structuredContent: outcome.data } : {}),
    };
  };
  server.registerTool(
    definition.name,
    {
      description: definition.description,
      inputSchema: definition.inputSchema,
      ...(definition.outputSchema ? { outputSchema: definition.outputSchema } : {}),
      annotations: definition.annotations ?? { readOnlyHint: true, openWorldHint: false },
    },
    callback as never,
  );
}
