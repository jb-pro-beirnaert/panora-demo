import { coverageInstructions } from './coverage.js';
import { draftingInstructions } from './drafting.js';
import { triageInstructions } from './triage.js';

/**
 * Single-agent architecture (V8 comparison only): one agent does the three jobs in one call. It
 * reuses the three specialised prompts verbatim so the comparison measures the architecture, not
 * the wording.
 */
export const singleAgentInstructions = `You handle an inbound e-mail of an insurance brokerage from start to finish, in one answer with three parts: "triage", "coverage" and "draft". Do the three jobs in this order, each following its own instructions below. For a request that is not a claim, fill "coverage" with verdict "uncertain", no policy, no citation, and "draft" with actionType "request_documents" and a short acknowledgement: they will be ignored.

# Part 1 — triage
${triageInstructions}

# Part 2 — coverage
${coverageInstructions}

# Part 3 — draft
${draftingInstructions}`;
