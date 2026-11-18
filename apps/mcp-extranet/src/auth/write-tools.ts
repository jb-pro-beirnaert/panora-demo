/** Tools that change the insurer's data: registered only for `write` tokens. */
export const WRITE_TOOLS = new Set(['file_claim']);

interface JsonRpcMessage {
  id?: string | number | null;
  method?: unknown;
  params?: { name?: unknown; arguments?: unknown };
}

/**
 * JSON-RPC ids of the `tools/call` requests in `body` that target a write tool. The body is a
 * single message or a batch.
 */
export function writeToolCalls(
  body: unknown,
): { id: string | number | null; tool: string; args: unknown }[] {
  const messages = (Array.isArray(body) ? body : [body]) as JsonRpcMessage[];
  return messages.flatMap((message) =>
    message &&
    message.method === 'tools/call' &&
    typeof message.params?.name === 'string' &&
    WRITE_TOOLS.has(message.params.name)
      ? [
          {
            id: message.id ?? null,
            tool: message.params.name,
            args: message.params.arguments ?? {},
          },
        ]
      : [],
  );
}
