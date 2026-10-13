import { Inject, Injectable, Logger } from '@nestjs/common';
import { AgentReviewError, ClaimReviewAgent, type AgentOutput } from '../agent/claim-review.agent.js';
import { ProviderCheckService } from '../agent/provider-check.service.js';
import { AuditService } from '../core/audit.service.js';
import { APP_CONFIG, type AppConfig } from '../core/config.js';
import { PrismaService } from '../core/prisma.service.js';
import { StorageService } from '../core/storage.service.js';
import { routeClaim } from './routing.js';
import type { ClaimSnapshot, FindingInput } from './review.types.js';
import { runExtractionChecks, runRules } from './rules.engine.js';

/** The automated review pipeline: rules → AI agent → cross-checks → routing. */
@Injectable()
export class ReviewService {
  private readonly logger = new Logger(ReviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly agent: ClaimReviewAgent,
    private readonly providers: ProviderCheckService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async reviewClaim(claimId: string): Promise<void> {
    const claim = await this.prisma.claim.update({
      where: { id: claimId },
      data: { status: 'PROCESSING' },
      include: { policy: true, documents: true, claimant: true },
    });
    await this.audit.log({ claimId, actorType: 'SYSTEM', action: 'REVIEW_STARTED' });

    // A fresh run replaces findings from earlier runs (e.g. after the claimant added documents).
    // Reviewer verdicts on old findings stay in the audit log.
    await this.prisma.finding.deleteMany({ where: { claimId } });

    // 1. Deterministic rules
    const snapshot = await this.buildSnapshot(claim);
    const rules = runRules(snapshot, { lateFilingDays: this.config.LATE_FILING_DAYS });
    const findings: FindingInput[] = [...rules.findings];

    // 2. AI review. Skipped when documents are missing; the claimant is asked for them first.
    let ai: AgentOutput | null = null;
    if (rules.missingDocuments.length === 0) {
      try {
        ai = await this.agent.review({
          claim: {
            claimNumber: claim.claimNumber,
            lineOfBusiness: claim.policy.lineOfBusiness,
            policyNumber: claim.policy.policyNumber,
            claimantName: claim.claimant.name,
            incidentDate: claim.incidentDate.toISOString().slice(0, 10),
            amountClaimed: Number(claim.amountClaimed),
            providerName: claim.providerName,
            description: claim.description,
          },
          documents: await Promise.all(
            claim.documents.map(async (d) => ({
              id: d.id,
              type: d.type,
              fileName: d.fileName,
              mimeType: d.mimeType,
              content: await this.storage.read(d.storageKey),
            })),
          ),
          ruleFindings: rules.findings,
          lookups: {
            getPolicyTerms: async () => ({
              policyNumber: claim.policy.policyNumber,
              lineOfBusiness: claim.policy.lineOfBusiness,
              status: claim.policy.status,
              effectiveDate: claim.policy.effectiveDate,
              expiryDate: claim.policy.expiryDate,
              coverageLimit: Number(claim.policy.coverageLimit),
              deductible: Number(claim.policy.deductible),
              exclusions: claim.policy.exclusions,
              terms: claim.policy.terms,
            }),
            getClaimHistory: () => this.claimHistory(claim.claimantId, claim.id),
            checkProvider: (name) => this.providers.check(name),
          },
        });
      } catch (err) {
        // Fail safe: an AI outage or bad output sends the claim to a human, never auto-approves it.
        const reason =
          err instanceof AgentReviewError ? err.message : `AI call failed: ${(err as Error).message}`;
        this.logger.warn(`AI review failed for ${claim.claimNumber}: ${reason}`);
        findings.push({
          source: 'AI',
          code: 'AI_REVIEW_UNAVAILABLE',
          severity: 'MEDIUM',
          description: `Automated document review could not be completed (${reason}). Review all documents manually.`,
          evidence: [],
        });
        await this.audit.log({ claimId, actorType: 'AI', action: 'AI_REVIEW_FAILED', details: { reason } });
      }
    }

    // 3. Cross-check AI-extracted values in code
    if (ai) {
      findings.push(
        ...ai.result.findings.map((f) => ({ ...f, source: 'AI' as const })),
        ...runExtractionChecks(
          { amountClaimed: snapshot.amountClaimed, incidentDate: snapshot.incidentDate },
          ai.result,
        ),
      );
    }

    // 4. Route
    const missingDocuments = [
      ...new Set([...rules.missingDocuments, ...(ai?.result.missingDocuments ?? [])]),
    ];
    const route = routeClaim({
      amountClaimed: snapshot.amountClaimed,
      riskScore: ai?.result.riskScore ?? null,
      aiRecommendation: ai?.result.recommendation ?? null,
      findings,
      // AI-suggested documents are advisory; only rule-required documents block the claim.
      missingDocuments: rules.missingDocuments,
      thresholds: {
        manualReviewAmount: this.config.MANUAL_REVIEW_AMOUNT,
        manualReviewRiskScore: this.config.MANUAL_REVIEW_RISK_SCORE,
      },
    });

    // 5. Persist
    await this.prisma.$transaction(async (tx) => {
      const aiReview = ai
        ? await tx.aiReview.create({
            data: {
              claimId,
              model: ai.model,
              recommendation: ai.result.recommendation,
              riskScore: ai.result.riskScore,
              summary: ai.result.summary,
              extractedFields: ai.result.extractedFields,
              missingDocuments: ai.result.missingDocuments,
              usage: ai.usage as object,
            },
          })
        : null;
      await tx.finding.createMany({
        data: findings.map((f) => ({
          claimId,
          aiReviewId: f.source === 'AI' ? aiReview?.id : undefined,
          source: f.source,
          code: f.code,
          severity: f.severity,
          description: f.description,
          evidence: f.evidence as object[],
        })),
      });
      await tx.claim.update({
        where: { id: claimId },
        data: {
          status: route.status,
          riskScore: ai?.result.riskScore ?? null,
          recommendation: ai?.result.recommendation ?? null,
          aiSummary: ai?.result.summary ?? null,
          missingDocuments,
        },
      });
    });

    await this.audit.log({
      claimId,
      actorType: 'SYSTEM',
      action: 'REVIEW_COMPLETED',
      details: { status: route.status, reasons: route.reasons, findings: findings.length, model: ai?.model },
    });
  }

  /** Marks a claim for manual review when the job itself has failed all retries. */
  async markFailed(claimId: string, error: string) {
    await this.prisma.claim.update({ where: { id: claimId }, data: { status: 'MANUAL_REVIEW' } });
    await this.audit.log({ claimId, actorType: 'SYSTEM', action: 'REVIEW_FAILED', details: { error } });
  }

  private async buildSnapshot(claim: {
    id: string;
    policyId: string;
    incidentDate: Date;
    submittedAt: Date | null;
    amountClaimed: unknown;
    policy: {
      lineOfBusiness: ClaimSnapshot['lineOfBusiness'];
      status: ClaimSnapshot['policy']['status'];
      effectiveDate: Date;
      expiryDate: Date;
      coverageLimit: unknown;
      deductible: unknown;
    };
    documents: Array<{ id: string; type: string; sha256: string; fileName: string }>;
  }): Promise<ClaimSnapshot> {
    const [reused, otherClaims] = await Promise.all([
      this.prisma.claimDocument.findMany({
        where: { sha256: { in: claim.documents.map((d) => d.sha256) }, claimId: { not: claim.id } },
        select: { sha256: true, claim: { select: { claimNumber: true } } },
      }),
      this.prisma.claim.findMany({
        where: { policyId: claim.policyId, id: { not: claim.id }, status: { not: 'DRAFT' } },
        select: { claimNumber: true, incidentDate: true, amountClaimed: true },
      }),
    ]);

    return {
      id: claim.id,
      lineOfBusiness: claim.policy.lineOfBusiness,
      incidentDate: claim.incidentDate,
      submittedAt: claim.submittedAt ?? new Date(),
      amountClaimed: Number(claim.amountClaimed),
      policy: {
        status: claim.policy.status,
        effectiveDate: claim.policy.effectiveDate,
        expiryDate: claim.policy.expiryDate,
        coverageLimit: Number(claim.policy.coverageLimit),
        deductible: Number(claim.policy.deductible),
      },
      documents: claim.documents,
      reusedDocuments: reused.flatMap((r) =>
        claim.documents
          .filter((d) => d.sha256 === r.sha256)
          .map((d) => ({ documentId: d.id, otherClaimNumber: r.claim.claimNumber })),
      ),
      otherClaims: otherClaims.map((c) => ({ ...c, amountClaimed: Number(c.amountClaimed) })),
    };
  }

  private async claimHistory(claimantId: string, excludeClaimId: string) {
    const claims = await this.prisma.claim.findMany({
      where: { claimantId, id: { not: excludeClaimId }, status: { not: 'DRAFT' } },
      orderBy: { incidentDate: 'desc' },
      take: 20,
      select: {
        claimNumber: true,
        incidentDate: true,
        amountClaimed: true,
        status: true,
        description: true,
        aiSummary: true,
        policy: { select: { policyNumber: true } },
      },
    });
    return claims.map((c) => ({ ...c, amountClaimed: Number(c.amountClaimed) }));
  }
}
