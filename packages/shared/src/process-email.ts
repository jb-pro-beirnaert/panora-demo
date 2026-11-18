import { z } from 'zod';
import { LocaleSchema, RequestTypeSchema } from './domain.js';
import { ProposedActionSchema } from './drafting.js';
import { InboundEmailInputSchema } from './inbound-email.js';

/** The brokerage whose claims inbox received the e-mail. */
export const BrokerageContextSchema = z.object({
  /** Scopes the MCP extranet tokens: the agents only see this brokerage's policies. */
  brokerCode: z.string().min(1),
  /** Language of the internal note written for the broker. */
  locale: LocaleSchema,
});
export type BrokerageContext = z.infer<typeof BrokerageContextSchema>;

/** Input of the Mastra workflow `process-email`. */
export const ProcessEmailInputSchema = z.object({
  email: InboundEmailInputSchema,
  brokerage: BrokerageContextSchema,
});
export type ProcessEmailInput = z.infer<typeof ProcessEmailInputSchema>;

/** Final output of `process-email`. */
export const ProcessEmailResultSchema = z.discriminatedUnion('outcome', [
  /** Not a claim: classified, no coverage analysis, no draft. */
  z.object({
    outcome: z.literal('classified'),
    requestType: RequestTypeSchema.exclude(['claim']),
  }),
  /** Approved `file_claim`: the claim now exists at the insurer. */
  z.object({
    outcome: z.literal('claim_filed'),
    claimNumber: z.string(),
    action: ProposedActionSchema,
    approvedBy: z.string(),
  }),
  /** Approved e-mail (documents request or denial): ready to be sent (sending is out of scope). */
  z.object({
    outcome: z.literal('ready_to_send'),
    action: ProposedActionSchema,
    approvedBy: z.string(),
  }),
]);
export type ProcessEmailResult = z.infer<typeof ProcessEmailResultSchema>;
