import { runExtractionChecks, runRules } from './rules.engine.js';
import type { ClaimSnapshot } from './review.types.js';

const NOW = new Date('2026-06-15T00:00:00Z');

function claim(overrides: Partial<ClaimSnapshot> = {}): ClaimSnapshot {
  return {
    id: 'c1',
    lineOfBusiness: 'AUTO',
    incidentDate: new Date('2026-06-01'),
    submittedAt: new Date('2026-06-05'),
    amountClaimed: 4200,
    policy: {
      status: 'ACTIVE',
      effectiveDate: new Date('2026-01-01'),
      expiryDate: new Date('2026-12-31'),
      coverageLimit: 50_000,
      deductible: 500,
    },
    documents: [
      { id: 'd1', type: 'CLAIM_FORM', sha256: 'a', fileName: 'form.pdf' },
      { id: 'd2', type: 'INVOICE', sha256: 'b', fileName: 'invoice.pdf' },
      { id: 'd3', type: 'PHOTO', sha256: 'c', fileName: 'damage.jpg' },
    ],
    reusedDocuments: [],
    otherClaims: [],
    ...overrides,
  };
}

const codes = (c: ClaimSnapshot) => runRules(c, { lateFilingDays: 30, now: NOW }).findings.map((f) => f.code);

describe('runRules', () => {
  it('passes a clean claim', () => {
    const result = runRules(claim(), { lateFilingDays: 30, now: NOW });
    expect(result.findings).toEqual([]);
    expect(result.missingDocuments).toEqual([]);
  });

  it('flags an inactive policy', () => {
    expect(codes(claim({ policy: { ...claim().policy, status: 'LAPSED' } }))).toContain('POLICY_NOT_ACTIVE');
  });

  it('flags an incident outside the coverage period', () => {
    expect(codes(claim({ incidentDate: new Date('2025-12-20') }))).toContain('OUTSIDE_COVERAGE_PERIOD');
  });

  it('flags a future incident date', () => {
    expect(codes(claim({ incidentDate: new Date('2026-07-01') }))).toContain('FUTURE_INCIDENT_DATE');
  });

  it('flags amounts over the limit and under the deductible', () => {
    expect(codes(claim({ amountClaimed: 60_000 }))).toContain('AMOUNT_EXCEEDS_LIMIT');
    expect(codes(claim({ amountClaimed: 300 }))).toContain('BELOW_DEDUCTIBLE');
  });

  it('flags late filing', () => {
    expect(codes(claim({ submittedAt: new Date('2026-07-10') }))).toContain('LATE_FILING');
  });

  it('flags reused documents and likely duplicate claims', () => {
    const found = codes(
      claim({
        reusedDocuments: [{ documentId: 'd2', otherClaimNumber: 'CLM-1' }],
        otherClaims: [{ claimNumber: 'CLM-2', incidentDate: new Date('2026-06-03'), amountClaimed: 4200 }],
      }),
    );
    expect(found).toContain('DOCUMENT_REUSED');
    expect(found).toContain('POSSIBLE_DUPLICATE_CLAIM');
  });

  it('flags frequent claims', () => {
    const otherClaims = [
      { claimNumber: 'CLM-3', incidentDate: new Date('2026-02-01'), amountClaimed: 100 },
      { claimNumber: 'CLM-4', incidentDate: new Date('2025-11-01'), amountClaimed: 200 },
    ];
    expect(codes(claim({ otherClaims }))).toContain('FREQUENT_CLAIMS');
  });

  it('lists missing required documents, accepting any of the alternatives', () => {
    const result = runRules(
      claim({ documents: [{ id: 'd1', type: 'ESTIMATE', sha256: 'x', fileName: 'estimate.pdf' }] }),
      { lateFilingDays: 30, now: NOW },
    );
    expect(result.missingDocuments).toEqual(['CLAIM_FORM', 'PHOTO']);
  });
});

describe('runExtractionChecks', () => {
  const base = { amountClaimed: 4200, incidentDate: new Date('2026-06-01') };

  it('accepts matching values and small rounding differences', () => {
    expect(runExtractionChecks(base, { documentTotal: 4210, incidentDateOnDocuments: '2026-06-01' })).toEqual(
      [],
    );
  });

  it('flags a total that does not match the claimed amount', () => {
    const [f] = runExtractionChecks(base, { documentTotal: 3100, incidentDateOnDocuments: null });
    expect(f.code).toBe('AMOUNT_MISMATCH');
  });

  it('flags a different incident date on the documents', () => {
    const [f] = runExtractionChecks(base, { documentTotal: null, incidentDateOnDocuments: '2026-05-20' });
    expect(f.code).toBe('DATE_MISMATCH');
  });
});
