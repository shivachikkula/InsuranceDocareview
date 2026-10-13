import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service.js';
import { APP_CONFIG, loadConfig } from './config.js';
import { PrismaService } from './prisma.service.js';
import { StorageService } from './storage.service.js';

@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: () => loadConfig() },
    PrismaService,
    StorageService,
    AuditService,
  ],
  exports: [APP_CONFIG, PrismaService, StorageService, AuditService],
})
export class CoreModule {}
