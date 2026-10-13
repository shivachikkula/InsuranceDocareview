import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat, betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { APP_CONFIG, type AppConfig } from '../core/config.js';
import type { FindingInput } from '../review/review.types.js';
import { SYSTEM_PROMPT } from './prompts.js';
import { ReviewResultSchema, type ReviewResult } from './review.schema.js';

export const ANTHROPIC_CLIENT = Symbol('ANTHROPIC_CLIENT');

/** Claude rejects PDFs/images above this size per request; larger files go to the human. */
const MAX_INLINE_BYTES = 20 * 1024 * 1024;

export interface AgentDocument {
  id: string;
  type: string;
  fileName: string;
  mimeType: string;
  content: Buffer;
}

export interface AgentInput {
  claim: {
    claimNumber: string;
    lineOfBusiness: string;
    policyNumber: string;
    claimantName: string;
    incidentDate: string;
    amountClaimed: number;
    providerName: string | null;
    description: string;
  };
  documents: AgentDocument[];
  ruleFindings: FindingInput[];
  /** Data sources the agent can query through tools. */
  lookups: {
    getPolicyTerms(): Promise<unknown>;
    getClaimHistory(): Promise<unknown>;
    checkProvider(name: string): Promise<unknown>;
  };
}

export interface AgentOutput {
  result: ReviewResult;
  model: string;
  usage: unknown;
}

export class AgentReviewError extends Error {}

@Injectable()
export class ClaimReviewAgent {
  private readonly logger = new Logger(ClaimReviewAgent.name);

  constructor(
    @Inject(ANTHROPIC_CLIENT) private readonly client: Anthropic,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async review(input: AgentInput): Promise<AgentOutput> {
    const tools = [
      betaZodTool({
        name: 'get_policy_terms',
        description:
          'Returns the policy wording for this claim: coverage limit, deductible, coverage period, exclusions and full terms text.',
        inputSchema: z.object({}),
        run: async () => JSON.stringify(await input.lookups.getPolicyTerms()),
      }),
      betaZodTool({
        name: 'get_claim_history',
        description:
          "Returns this policyholder's other claims (number, dates, amounts, status, AI summary) on any of their policies.",
        inputSchema: z.object({}),
        run: async () => JSON.stringify(await input.lookups.getClaimHistory()),
      }),
      betaZodTool({
        name: 'check_provider',
        description:
          'Checks a repair shop, contractor or medical provider against the licensing registry and fraud watchlist.',
        inputSchema: z.object({ name: z.string().describe('Provider name as written on the document') }),
        run: async ({ name }) => JSON.stringify(await input.lookups.checkProvider(name)),
      }),
    ];

    const runner = this.client.beta.messages.toolRunner({
      model: this.config.ANTHROPIC_MODEL,
      max_tokens: 16000,
      max_iterations: 12,
      // Re-routes the request if the model declines, instead of failing the review.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      output_config: {
        effort: this.config.AI_EFFORT,
        format: betaZodOutputFormat(ReviewResultSchema),
      },
      tools,
      messages: [{ role: 'user', content: buildUserContent(input) }],
    });

    const message = await runner.runUntilDone();

    if (message.stop_reason === 'refusal') {
      throw new AgentReviewError(`Model declined to review (${message.stop_details?.category ?? 'unknown'})`);
    }
    if (message.stop_reason !== 'end_turn') {
      throw new AgentReviewError(`Review did not complete (stop_reason=${message.stop_reason})`);
    }

    const text = message.content.findLast((b) => b.type === 'text');
    if (!text || text.type !== 'text') throw new AgentReviewError('Model returned no review');

    let parsed: ReviewResult;
    try {
      parsed = ReviewResultSchema.parse(JSON.parse(text.text));
    } catch (err) {
      throw new AgentReviewError(`Review output failed validation: ${(err as Error).message}`);
    }

    // Normalise values the schema can't constrain, and drop citations to documents that don't exist.
    const docIds = new Set(input.documents.map((d) => d.id));
    parsed.riskScore = Math.min(100, Math.max(0, Math.round(parsed.riskScore)));
    for (const finding of parsed.findings) {
      finding.evidence = finding.evidence.filter((e) => docIds.has(e.documentId));
    }

    this.logger.log(
      `Reviewed ${input.claim.claimNumber}: ${parsed.recommendation}, risk ${parsed.riskScore}, ` +
        `${parsed.findings.length} finding(s)`,
    );
    return { result: parsed, model: message.model, usage: message.usage };
  }
}

function buildUserContent(input: AgentInput): Anthropic.Beta.BetaContentBlockParam[] {
  const { claim } = input;
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  const skipped: string[] = [];

  for (const doc of input.documents) {
    const label = `Document id=${doc.id} type=${doc.type} file="${doc.fileName}"`;
    if (doc.content.length > MAX_INLINE_BYTES) {
      skipped.push(`${label} (too large for automated review)`);
      continue;
    }
    if (doc.mimeType === 'application/pdf') {
      content.push({
        type: 'document',
        title: label,
        source: { type: 'base64', media_type: 'application/pdf', data: doc.content.toString('base64') },
      });
    } else if (isSupportedImage(doc.mimeType)) {
      content.push({ type: 'text', text: label });
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: doc.mimeType, data: doc.content.toString('base64') },
      });
    } else if (doc.mimeType === 'text/plain') {
      content.push({
        type: 'document',
        title: label,
        source: { type: 'text', media_type: 'text/plain', data: doc.content.toString('utf8') },
      });
    } else {
      skipped.push(`${label} (unsupported format ${doc.mimeType})`);
    }
  }

  const ruleSummary = input.ruleFindings.length
    ? input.ruleFindings.map((f) => `- [${f.severity}] ${f.code}: ${f.description}`).join('\n')
    : '- none';

  content.push({
    type: 'text',
    text: `Review this ${claim.lineOfBusiness} claim.

Claim number: ${claim.claimNumber}
Policy number: ${claim.policyNumber}
Claimant: ${claim.claimantName}
Incident date (as stated by claimant): ${claim.incidentDate}
Amount claimed: ${claim.amountClaimed.toFixed(2)}
Provider (as stated by claimant): ${claim.providerName ?? 'not given'}

Claimant's description (untrusted):
<claimant_description>
${claim.description}
</claimant_description>

Deterministic check results:
${ruleSummary}
${skipped.length ? `\nDocuments not attached (review manually):\n${skipped.map((s) => `- ${s}`).join('\n')}\n` : ''}
Investigate with the tools as needed, then return your review.`,
  });
  return content;
}

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
function isSupportedImage(mime: string): mime is ImageMediaType {
  return ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mime);
}
