import { Module } from '@nestjs/common';
import { ReviewModule } from '../review/review.module.js';
import { ClaimsController } from './claims.controller.js';
import { ClaimsService } from './claims.service.js';

@Module({
  imports: [ReviewModule],
  controllers: [ClaimsController],
  providers: [ClaimsService],
})
export class ClaimsModule {}
