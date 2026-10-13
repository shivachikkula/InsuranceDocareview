import { routeClaim } from './routing.js';
import type { FindingInput } from './review.types.js';

const thresholds = { manualReviewAmount: 10_000, manualReviewRiskScore: 60 };
const base = {
  amountClaimed: 2000,
  riskScore: 10,
  aiRecommendation: 'APPROVE' as const,
  findings: [] as FindingInput[],
  missingDocuments: [] as string[],
  thresholds,
};
const finding = (f: Partial<FindingInput>): FindingInput => ({
  source: 'AI',
  code: 'X',
  severity: 'LOW',
  description: '',
  evidence: [],
  ...f,
});

describe('routeClaim', () => {
  it('sends a clean, low-value, low-risk claim to one-click approval', () => {
    expect(routeClaim(base).status).toBe('READY_FOR_APPROVAL');
  });

  it('tolerates LOW AI findings', () => {
    expect(routeClaim({ ...base, findings: [finding({ severity: 'LOW' })] }).status).toBe(
      'READY_FOR_APPROVAL',
    );
  });

  it('asks for missing documents first', () => {
    expect(routeClaim({ ...base, missingDocuments: ['PHOTO'] }).status).toBe('PENDING_INFO');
  });

  it.each([
    ['high-severity finding', { findings: [finding({ severity: 'HIGH' })] }],
    ['failed rule', { findings: [finding({ source: 'RULE', severity: 'MEDIUM' })] }],
    ['high risk score', { riskScore: 75 }],
    ['large amount', { amountClaimed: 10_000 }],
    ['AI recommends manual review', { aiRecommendation: 'MANUAL_REVIEW' as const }],
    ['AI unavailable', { aiRecommendation: null, riskScore: null }],
  ])('sends to manual review on %s', (_, overrides) => {
    expect(routeClaim({ ...base, ...overrides }).status).toBe('MANUAL_REVIEW');
  });
});
