import type Anthropic from '@anthropic-ai/sdk';
import { loadConfig } from '../core/config.js';
import { AgentReviewError, ClaimReviewAgent, type AgentInput } from './claim-review.agent.js';
import type { ReviewResult } from './review.schema.js';

const config = loadConfig({ DATABASE_URL: 'postgres://x', JWT_SECRET: 'test-secret' } as NodeJS.ProcessEnv);

const input: AgentInput = {
  claim: {
    claimNumber: 'CLM-1',
    lineOfBusiness: 'AUTO',
    policyNumber: 'AUTO-1',
    claimantName: 'Alice',
    incidentDate: '2026-06-01',
    amountClaimed: 4200,
    providerName: 'Main St Auto',
    description: 'Rear-ended at a stop light on Main St.',
  },
  documents: [
    {
      id: 'doc-1',
      type: 'INVOICE',
      fileName: 'invoice.pdf',
      mimeType: 'application/pdf',
      content: Buffer.from('%PDF-1.4'),
    },
  ],
  ruleFindings: [],
  lookups: {
    getPolicyTerms: async () => ({}),
    getClaimHistory: async () => [],
    checkProvider: async () => ({}),
  },
};

const validResult: ReviewResult = {
  recommendation: 'MANUAL_REVIEW',
  riskScore: 140,
  summary: 'Invoice date differs from the claim.',
  extractedFields: [],
  documentTotal: 4200,
  incidentDateOnDocuments: '2026-05-20',
  findings: [
    {
      code: 'DATE_MISMATCH',
      severity: 'HIGH',
      description: 'Invoice dated before the incident.',
      evidence: [
        { documentId: 'doc-1', page: 1, quote: 'Date: 2026-05-20' },
        { documentId: 'made-up', page: null, quote: 'hallucinated' },
      ],
    },
  ],
  missingDocuments: [],
};

function agentReturning(message: Partial<Anthropic.Beta.BetaMessage>) {
  const toolRunner = vi.fn().mockReturnValue({
    runUntilDone: async () => ({
      model: 'claude-opus-5-5',
      usage: {},
      content: [],
      stop_reason: 'end_turn',
      ...message,
    }),
  });
  const client = { beta: { messages: { toolRunner } } } as unknown as Anthropic;
  return { agent: new ClaimReviewAgent(client, config), toolRunner };
}

describe('ClaimReviewAgent', () => {
  it('parses, clamps and sanitises the structured review', async () => {
    const { agent, toolRunner } = agentReturning({
      content: [{ type: 'text', text: JSON.stringify(validResult), citations: null }],
    });

    const { result } = await agent.review(input);

    expect(result.riskScore).toBe(100);
    expect(result.findings[0].evidence).toEqual([
      { documentId: 'doc-1', page: 1, quote: 'Date: 2026-05-20' },
    ]);

    const params = toolRunner.mock.calls[0][0];
    expect(params.model).toBe('claude-opus-5-5');
    expect(params.tools.map((t: { name: string }) => t.name)).toEqual([
      'get_policy_terms',
      'get_claim_history',
      'check_provider',
    ]);
    const blocks = params.messages[0].content;
    expect(blocks[0]).toMatchObject({ type: 'document', source: { media_type: 'application/pdf' } });
    expect(blocks.at(-1).text).toContain('<claimant_description>');
  });

  it('throws on refusal so the claim goes to a human', async () => {
    const { agent } = agentReturning({ stop_reason: 'refusal' });
    await expect(agent.review(input)).rejects.toBeInstanceOf(AgentReviewError);
  });

  it('throws when the run ends without a final answer', async () => {
    const { agent } = agentReturning({ stop_reason: 'tool_use' });
    await expect(agent.review(input)).rejects.toBeInstanceOf(AgentReviewError);
  });

  it('throws on output that fails validation', async () => {
    const { agent } = agentReturning({
      content: [{ type: 'text', text: '{"recommendation":"YES"}', citations: null }],
    });
    await expect(agent.review(input)).rejects.toBeInstanceOf(AgentReviewError);
  });
});
