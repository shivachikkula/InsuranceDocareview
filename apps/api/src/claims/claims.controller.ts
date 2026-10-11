import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentUser, Roles, type AuthUser } from '../auth/auth.decorators.js';
import { ZodValidationPipe } from '../core/zod-validation.pipe.js';
import {
  ApproverDecisionSchema,
  CreateClaimSchema,
  ListClaimsSchema,
  ReviewerDecisionSchema,
  UploadDocumentSchema,
  type ApproverDecisionDto,
  type CreateClaimDto,
  type ListClaimsDto,
  type ReviewerDecisionDto,
} from './claims.dto.js';
import { ClaimsService } from './claims.service.js';

const Id = new ParseUUIDPipe();

@Controller()
export class ClaimsController {
  constructor(private readonly claims: ClaimsService) {}

  // ---- Claimant -------------------------------------------------------------

  @Get('policies/mine')
  @Roles('CLAIMANT')
  myPolicies(@CurrentUser() user: AuthUser) {
    return this.claims.myPolicies(user);
  }

  @Post('claims')
  @Roles('CLAIMANT')
  create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(CreateClaimSchema)) dto: CreateClaimDto) {
    return this.claims.create(user, dto);
  }

  @Post('claims/:id/documents')
  @Roles('CLAIMANT')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }))
  upload(
    @CurrentUser() user: AuthUser,
    @Param('id', Id) id: string,
    @Body(new ZodValidationPipe(UploadDocumentSchema)) body: z.infer<typeof UploadDocumentSchema>,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.claims.addDocument(user, id, body.type, file);
  }

  @Post('claims/:id/submit')
  @Roles('CLAIMANT')
  submit(@CurrentUser() user: AuthUser, @Param('id', Id) id: string) {
    return this.claims.submit(user, id);
  }

  // ---- Shared (scoped by role in the service) -------------------------------

  @Get('claims')
  list(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(ListClaimsSchema)) q: ListClaimsDto) {
    return this.claims.list(user, q);
  }

  @Get('claims/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', Id) id: string) {
    return this.claims.get(user, id);
  }

  @Get('claims/:id/documents/:docId/content')
  async content(
    @CurrentUser() user: AuthUser,
    @Param('id', Id) id: string,
    @Param('docId', Id) docId: string,
    @Res() res: Response,
  ) {
    const { doc, buffer } = await this.claims.documentContent(user, id, docId);
    res.set({
      'Content-Type': doc.mimeType,
      'Content-Disposition': `inline; filename="${encodeURIComponent(doc.fileName)}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    res.send(buffer);
  }

  // ---- Staff ---------------------------------------------------------------

  @Post('claims/:id/decision')
  @Roles('REVIEWER', 'ADMIN')
  decide(
    @CurrentUser() user: AuthUser,
    @Param('id', Id) id: string,
    @Body(new ZodValidationPipe(ReviewerDecisionSchema)) dto: ReviewerDecisionDto,
  ) {
    return this.claims.reviewerDecide(user, id, dto);
  }

  @Post('claims/:id/final-decision')
  @Roles('APPROVER', 'ADMIN')
  finalDecision(
    @CurrentUser() user: AuthUser,
    @Param('id', Id) id: string,
    @Body(new ZodValidationPipe(ApproverDecisionSchema)) dto: ApproverDecisionDto,
  ) {
    return this.claims.approverDecide(user, id, dto);
  }

  @Post('claims/:id/rerun')
  @Roles('REVIEWER', 'ADMIN')
  rerun(@CurrentUser() user: AuthUser, @Param('id', Id) id: string) {
    return this.claims.rerun(user, id);
  }

  @Get('claims/:id/audit')
  @Roles('REVIEWER', 'APPROVER', 'ADMIN')
  audit(@Param('id', Id) id: string) {
    return this.claims.auditTrail(id);
  }

  @Get('stats')
  @Roles('REVIEWER', 'APPROVER', 'ADMIN')
  stats() {
    return this.claims.stats();
  }
}
