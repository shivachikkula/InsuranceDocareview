import { Injectable } from '@nestjs/common';
import type { ActorType } from '../generated/prisma/client.js';
import { PrismaService } from './prisma.service.js';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(entry: {
    claimId?: string;
    actorType: ActorType;
    actorId?: string;
    action: string;
    details?: Record<string, unknown>;
  }) {
    await this.prisma.auditLog.create({
      data: {
        claimId: entry.claimId,
        actorType: entry.actorType,
        actorId: entry.actorId,
        action: entry.action,
        details: (entry.details ?? {}) as object,
      },
    });
  }
}
