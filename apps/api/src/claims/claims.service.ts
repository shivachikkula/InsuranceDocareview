import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import { randomInt } from 'node:crypto';
import type { AuthUser } from '../auth/auth.decorators.js';
import { AuditService } from '../core/audit.service.js';
import { APP_CONFIG, type AppConfig } from '../core/config.js';
import { PrismaService } from '../core/prisma.service.js';
import { StorageService } from '../core/storage.service.js';
import type { ClaimStatus, DocumentType, Prisma } from '../generated/prisma/client.js';
import { REVIEW_QUEUE, type ReviewJobData } from '../review/review.queue.js';
import type {
  ApproverDecisionDto,
  CreateClaimDto,
  ListClaimsDto,
  ReviewerDecisionDto,
} from './claims.dto.js';
import { approverDecision, isStaff, reviewerDecision, WorkflowError } from './workflow.js';

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'text/plain'];

@Injectable()
export class ClaimsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    @InjectQueue(REVIEW_QUEUE) private readonly queue: Queue<ReviewJobData>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  myPolicies(user: AuthUser) {
    return this.prisma.policy
      .findMany({ where: { holderId: user.id }, orderBy: { policyNumber: 'asc' } })
      .then((policies) =>
        policies.map((p) => ({
          ...p,
          coverageLimit: Number(p.coverageLimit),
          deductible: Number(p.deductible),
        })),
      );
  }

  async create(user: AuthUser, dto: CreateClaimDto) {
    const policy = await this.prisma.policy.findUnique({ where: { id: dto.policyId } });
    if (!policy || policy.holderId !== user.id) throw new NotFoundException('Policy not found');

    const claim = await this.prisma.claim.create({
      data: {
        claimNumber: `CLM-${new Date().getFullYear()}-${randomInt(100000, 999999)}`,
        policyId: policy.id,
        claimantId: user.id,
        incidentDate: new Date(dto.incidentDate),
        description: dto.description,
        amountClaimed: dto.amountClaimed,
        providerName: dto.providerName || null,
      },
    });
    await this.audit.log({ claimId: claim.id, actorType: 'USER', actorId: user.id, action: 'CLAIM_CREATED' });
    return this.get(user, claim.id);
  }

  async addDocument(
    user: AuthUser,
    claimId: string,
    type: DocumentType,
    file: Express.Multer.File | undefined,
  ) {
    if (!file) throw new BadRequestException('File is required');
    if (file.size > MAX_UPLOAD_BYTES) throw new BadRequestException('File exceeds 25 MB');
    const mimeType = sniffMimeType(file.buffer) ?? file.mimetype;
    if (!ALLOWED_MIME.includes(mimeType) || mimeType !== file.mimetype) {
      throw new BadRequestException(
        'Unsupported or mislabelled file type. Upload PDF, JPEG, PNG, WebP, GIF or text.',
      );
    }

    const claim = await this.findOwned(user, claimId);
    if (!['DRAFT', 'PENDING_INFO'].includes(claim.status)) {
      throw new ConflictException(
        'Documents can only be added to draft claims or claims awaiting information',
      );
    }

    // TODO: virus-scan the buffer (e.g. ClamAV) before storing.
    const { storageKey, sha256 } = await this.storage.save(claimId, file.buffer);
    const doc = await this.prisma.claimDocument.create({
      data: {
        claimId,
        type,
        fileName: file.originalname,
        mimeType,
        sizeBytes: file.size,
        sha256,
        storageKey,
      },
    });
    await this.audit.log({
      claimId,
      actorType: 'USER',
      actorId: user.id,
      action: 'DOCUMENT_UPLOADED',
      details: { documentId: doc.id, type, fileName: doc.fileName, sha256 },
    });
    return doc;
  }

  async submit(user: AuthUser, claimId: string) {
    const claim = await this.findOwned(user, claimId);
    if (!['DRAFT', 'PENDING_INFO'].includes(claim.status)) {
      throw new ConflictException(`Claim in status ${claim.status} cannot be submitted`);
    }
    const docs = await this.prisma.claimDocument.count({ where: { claimId } });
    if (docs === 0) throw new BadRequestException('Attach at least one document before submitting');

    await this.prisma.claim.update({
      where: { id: claimId },
      data: { status: 'SUBMITTED', submittedAt: claim.submittedAt ?? new Date() },
    });
    await this.enqueue(claimId);
    await this.audit.log({ claimId, actorType: 'USER', actorId: user.id, action: 'CLAIM_SUBMITTED' });
    return this.get(user, claimId);
  }

  async list(user: AuthUser, q: ListClaimsDto) {
    const where: Prisma.ClaimWhereInput = isStaff(user.role)
      ? { status: { not: 'DRAFT' } }
      : { claimantId: user.id };
    if (q.status) where.status = { in: q.status.split(',') as ClaimStatus[] };

    const orderBy: Prisma.ClaimOrderByWithRelationInput[] =
      q.sort === 'risk'
        ? [{ riskScore: { sort: 'desc', nulls: 'first' } }, { submittedAt: 'asc' }]
        : q.sort === 'amount'
          ? [{ amountClaimed: 'desc' }]
          : [{ submittedAt: { sort: 'asc', nulls: 'last' } }];

    const [total, items] = await Promise.all([
      this.prisma.claim.count({ where }),
      this.prisma.claim.findMany({
        where,
        orderBy,
        skip: q.page * q.pageSize,
        take: q.pageSize,
        include: {
          policy: { select: { policyNumber: true, lineOfBusiness: true } },
          claimant: { select: { name: true } },
          findings: { select: { severity: true } },
        },
      }),
    ]);

    return {
      total,
      items: items.map((c) => ({
        id: c.id,
        claimNumber: c.claimNumber,
        status: c.status,
        policyNumber: c.policy.policyNumber,
        lineOfBusiness: c.policy.lineOfBusiness,
        claimantName: c.claimant.name,
        incidentDate: c.incidentDate,
        submittedAt: c.submittedAt,
        amountClaimed: Number(c.amountClaimed),
        ...(isStaff(user.role) && {
          riskScore: c.riskScore,
          highFindings: c.findings.filter((f) => f.severity === 'HIGH').length,
          totalFindings: c.findings.length,
        }),
      })),
    };
  }

  async get(user: AuthUser, claimId: string) {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
      include: {
        policy: true,
        claimant: { select: { id: true, name: true, email: true } },
        reviewedBy: { select: { name: true } },
        approvedBy: { select: { name: true } },
        documents: { orderBy: { uploadedAt: 'asc' } },
        findings: { orderBy: [{ severity: 'desc' }, { createdAt: 'asc' }] },
        reviews: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!claim) throw new NotFoundException();
    if (!isStaff(user.role) && claim.claimantId !== user.id) throw new NotFoundException();

    const base = {
      id: claim.id,
      claimNumber: claim.claimNumber,
      status: claim.status,
      incidentDate: claim.incidentDate,
      submittedAt: claim.submittedAt,
      description: claim.description,
      amountClaimed: Number(claim.amountClaimed),
      providerName: claim.providerName,
      missingDocuments: claim.missingDocuments,
      decisionComment: claim.decisionComment,
      claimant: claim.claimant,
      policy: {
        id: claim.policy.id,
        policyNumber: claim.policy.policyNumber,
        lineOfBusiness: claim.policy.lineOfBusiness,
        status: claim.policy.status,
        effectiveDate: claim.policy.effectiveDate,
        expiryDate: claim.policy.expiryDate,
        coverageLimit: Number(claim.policy.coverageLimit),
        deductible: Number(claim.policy.deductible),
      },
      documents: claim.documents.map(({ id, type, fileName, mimeType, sizeBytes, sha256, uploadedAt }) => ({
        id,
        type,
        fileName,
        mimeType,
        sizeBytes,
        sha256,
        uploadedAt,
      })),
    };
    if (!isStaff(user.role)) return base; // claimants never see risk scores or fraud flags

    const review = claim.reviews[0];
    return {
      ...base,
      riskScore: claim.riskScore,
      recommendation: claim.recommendation,
      aiSummary: claim.aiSummary,
      extractedFields: review?.extractedFields ?? [],
      aiModel: review?.model ?? null,
      findings: claim.findings,
      reviewedBy: claim.reviewedBy?.name ?? null,
      reviewedAt: claim.reviewedAt,
      approvedBy: claim.approvedBy?.name ?? null,
      approvedAt: claim.approvedAt,
      finalApprovalRequired: Number(claim.amountClaimed) >= this.config.FINAL_APPROVAL_AMOUNT,
    };
  }

  async documentContent(user: AuthUser, claimId: string, documentId: string) {
    await this.get(user, claimId); // access check
    const doc = await this.prisma.claimDocument.findFirst({ where: { id: documentId, claimId } });
    if (!doc) throw new NotFoundException();
    return { doc, buffer: await this.storage.read(doc.storageKey) };
  }

  async reviewerDecide(user: AuthUser, claimId: string, dto: ReviewerDecisionDto) {
    const claim = await this.prisma.claim.findUnique({ where: { id: claimId } });
    if (!claim) throw new NotFoundException();

    const status = this.workflow(() =>
      reviewerDecision({
        status: claim.status,
        action: dto.action,
        amountClaimed: Number(claim.amountClaimed),
        finalApprovalAmount: this.config.FINAL_APPROVAL_AMOUNT,
        actorId: user.id,
        claimantId: claim.claimantId,
      }),
    );

    await this.prisma.$transaction(async (tx) => {
      for (const [findingId, verdict] of Object.entries(dto.findingVerdicts)) {
        await tx.finding.updateMany({ where: { id: findingId, claimId }, data: { verdict } });
      }
      await tx.claim.update({
        where: { id: claimId },
        data: {
          status,
          reviewedById: user.id,
          reviewedAt: new Date(),
          decisionComment: dto.comment || null,
          ...(dto.action === 'REQUEST_INFO' && { missingDocuments: dto.requestedDocuments }),
        },
      });
    });

    await this.audit.log({
      claimId,
      actorType: 'USER',
      actorId: user.id,
      action: `REVIEWER_${dto.action}`,
      details: {
        newStatus: status,
        comment: dto.comment,
        findingVerdicts: dto.findingVerdicts,
        aiRecommendation: claim.recommendation,
        // Overrides are the most useful signal for improving the agent.
        overrodeAi:
          claim.recommendation !== null &&
          (claim.recommendation === 'APPROVE') !== (dto.action === 'APPROVE'),
      },
    });
    return this.get(user, claimId);
  }

  async approverDecide(user: AuthUser, claimId: string, dto: ApproverDecisionDto) {
    const claim = await this.prisma.claim.findUnique({ where: { id: claimId } });
    if (!claim) throw new NotFoundException();

    const status = this.workflow(() =>
      approverDecision({
        status: claim.status,
        action: dto.action,
        actorId: user.id,
        reviewedById: claim.reviewedById,
        claimantId: claim.claimantId,
      }),
    );

    await this.prisma.claim.update({
      where: { id: claimId },
      data: { status, approvedById: user.id, approvedAt: new Date(), decisionComment: dto.comment },
    });
    await this.audit.log({
      claimId,
      actorType: 'USER',
      actorId: user.id,
      action: `FINAL_${dto.action}`,
      details: { newStatus: status, comment: dto.comment },
    });
    return this.get(user, claimId);
  }

  async rerun(user: AuthUser, claimId: string) {
    const claim = await this.prisma.claim.findUnique({ where: { id: claimId } });
    if (!claim) throw new NotFoundException();
    if (!['MANUAL_REVIEW', 'READY_FOR_APPROVAL'].includes(claim.status)) {
      throw new ConflictException(`Claim in status ${claim.status} cannot be re-reviewed`);
    }
    await this.prisma.claim.update({ where: { id: claimId }, data: { status: 'SUBMITTED' } });
    await this.enqueue(claimId);
    await this.audit.log({ claimId, actorType: 'USER', actorId: user.id, action: 'REVIEW_RERUN_REQUESTED' });
    return this.get(user, claimId);
  }

  auditTrail(claimId: string) {
    return this.prisma.auditLog.findMany({ where: { claimId }, orderBy: { createdAt: 'asc' } });
  }

  async stats() {
    const [byStatus, verdicts, overrides, decisions] = await Promise.all([
      this.prisma.claim.groupBy({ by: ['status'], _count: true, where: { status: { not: 'DRAFT' } } }),
      this.prisma.finding.groupBy({
        by: ['source', 'verdict'],
        _count: true,
        where: { verdict: { not: null } },
      }),
      this.prisma.auditLog.count({
        where: { action: { startsWith: 'REVIEWER_' }, details: { path: ['overrodeAi'], equals: true } },
      }),
      this.prisma.auditLog.count({ where: { action: { startsWith: 'REVIEWER_' } } }),
    ]);
    return {
      byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
      findingVerdicts: verdicts.map((v) => ({ source: v.source, verdict: v.verdict, count: v._count })),
      reviewerDecisions: decisions,
      aiOverrides: overrides,
    };
  }

  private async findOwned(user: AuthUser, claimId: string) {
    const claim = await this.prisma.claim.findUnique({ where: { id: claimId } });
    if (!claim || claim.claimantId !== user.id) throw new NotFoundException();
    return claim;
  }

  private enqueue(claimId: string) {
    return this.queue.add('review', { claimId });
  }

  private workflow<T>(fn: () => T): T {
    try {
      return fn();
    } catch (err) {
      if (err instanceof WorkflowError) throw new ForbiddenException(err.message);
      throw err;
    }
  }
}

/** Identify the real file type from its first bytes instead of trusting the browser. */
function sniffMimeType(buf: Buffer): string | null {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'image/png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp';
  }
  if (buf.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  return null;
}
