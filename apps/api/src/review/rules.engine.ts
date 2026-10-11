import type { ClaimSnapshot, FindingInput } from './review.types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Document types each line of business needs before a claim can be decided. */
export const REQUIRED_DOCUMENTS: Record<ClaimSnapshot['lineOfBusiness'], string[][]> = {
  // Each inner array is "one of these" (e.g. an invoice OR an estimate).
  AUTO: [['CLAIM_FORM'], ['INVOICE', 'ESTIMATE'], ['PHOTO']],
  PROPERTY: [['CLAIM_FORM'], ['INVOICE', 'ESTIMATE', 'RECEIPT'], ['PHOTO']],
  HEALTH: [['CLAIM_FORM'], ['INVOICE', 'RECEIPT'], ['MEDICAL_REPORT']],
};

export interface RuleOptions {
  lateFilingDays: number;
  now?: Date;
}

export interface RuleResult {
  findings: FindingInput[];
  missingDocuments: string[];
}

/**
 * Deterministic checks. Anything that is arithmetic, a date comparison, or a
 * lookup belongs here — not in the LLM.
 */
export function runRules(claim: ClaimSnapshot, opts: RuleOptions): RuleResult {
  const findings: FindingInput[] = [];
  const add = (code: string, severity: FindingInput['severity'], description: string) =>
    findings.push({ source: 'RULE', code, severity, description, evidence: [] });
  const now = opts.now ?? new Date();
  const { policy } = claim;

  if (policy.status !== 'ACTIVE') {
    add('POLICY_NOT_ACTIVE', 'HIGH', `Policy status is ${policy.status}.`);
  }

  if (claim.incidentDate > now) {
    add('FUTURE_INCIDENT_DATE', 'HIGH', 'Incident date is in the future.');
  }

  if (claim.incidentDate < policy.effectiveDate || claim.incidentDate > policy.expiryDate) {
    add(
      'OUTSIDE_COVERAGE_PERIOD',
      'HIGH',
      `Incident date ${isoDate(claim.incidentDate)} is outside the coverage period ` +
        `${isoDate(policy.effectiveDate)} – ${isoDate(policy.expiryDate)}.`,
    );
  }

  if (claim.amountClaimed > policy.coverageLimit) {
    add(
      'AMOUNT_EXCEEDS_LIMIT',
      'HIGH',
      `Claimed ${money(claim.amountClaimed)} exceeds the coverage limit of ${money(policy.coverageLimit)}.`,
    );
  }

  if (claim.amountClaimed <= policy.deductible) {
    add(
      'BELOW_DEDUCTIBLE',
      'MEDIUM',
      `Claimed ${money(claim.amountClaimed)} does not exceed the deductible of ${money(policy.deductible)}.`,
    );
  }

  const filingDelayDays = Math.floor((claim.submittedAt.getTime() - claim.incidentDate.getTime()) / DAY_MS);
  if (filingDelayDays > opts.lateFilingDays) {
    add(
      'LATE_FILING',
      'MEDIUM',
      `Claim filed ${filingDelayDays} days after the incident (limit ${opts.lateFilingDays}).`,
    );
  }

  for (const reused of claim.reusedDocuments) {
    findings.push({
      source: 'RULE',
      code: 'DOCUMENT_REUSED',
      severity: 'HIGH',
      description: `An identical file was already submitted with claim ${reused.otherClaimNumber}.`,
      evidence: [{ documentId: reused.documentId, quote: 'Identical file hash' }],
    });
  }

  for (const other of claim.otherClaims) {
    const daysApart = Math.abs(other.incidentDate.getTime() - claim.incidentDate.getTime()) / DAY_MS;
    if (daysApart <= 7 && Math.abs(other.amountClaimed - claim.amountClaimed) < 0.01) {
      add(
        'POSSIBLE_DUPLICATE_CLAIM',
        'HIGH',
        `Claim ${other.claimNumber} on the same policy has the same amount and an incident date within 7 days.`,
      );
    }
  }

  const lastYear = claim.otherClaims.filter(
    (c) => claim.incidentDate.getTime() - c.incidentDate.getTime() <= 365 * DAY_MS,
  );
  if (lastYear.length >= 2) {
    add('FREQUENT_CLAIMS', 'MEDIUM', `${lastYear.length} other claims on this policy in the past 12 months.`);
  }

  const present = new Set(claim.documents.map((d) => d.type));
  const missingDocuments = REQUIRED_DOCUMENTS[claim.lineOfBusiness]
    .filter((oneOf) => !oneOf.some((type) => present.has(type)))
    .map((oneOf) => oneOf.join(' or '));

  return { findings, missingDocuments };
}

/**
 * Cross-checks on values the AI extracted from documents. The AI reads the
 * numbers; code compares them.
 */
export function runExtractionChecks(
  claim: Pick<ClaimSnapshot, 'amountClaimed' | 'incidentDate'>,
  extracted: { documentTotal: number | null; incidentDateOnDocuments: string | null },
): FindingInput[] {
  const findings: FindingInput[] = [];
  if (extracted.documentTotal !== null) {
    const diff = Math.abs(extracted.documentTotal - claim.amountClaimed);
    if (diff > Math.max(1, claim.amountClaimed * 0.02)) {
      findings.push({
        source: 'RULE',
        code: 'AMOUNT_MISMATCH',
        severity: 'HIGH',
        description:
          `Claimed ${money(claim.amountClaimed)} but supporting documents total ` +
          `${money(extracted.documentTotal)}.`,
        evidence: [],
      });
    }
  }
  if (extracted.incidentDateOnDocuments) {
    const docDate = new Date(extracted.incidentDateOnDocuments);
    if (!Number.isNaN(docDate.getTime()) && isoDate(docDate) !== isoDate(claim.incidentDate)) {
      findings.push({
        source: 'RULE',
        code: 'DATE_MISMATCH',
        severity: 'HIGH',
        description:
          `Claim states incident date ${isoDate(claim.incidentDate)} but documents state ` +
          `${isoDate(docDate)}.`,
        evidence: [],
      });
    }
  }
  return findings;
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function money(n: number) {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
