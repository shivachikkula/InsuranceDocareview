import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module.js';
import { ReviewProcessor } from './review.processor.js';
import { REVIEW_QUEUE } from './review.queue.js';
import { ReviewService } from './review.service.js';

@Module({
  imports: [
    AgentModule,
    BullModule.registerQueue({
      name: REVIEW_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    }),
  ],
  providers: [ReviewService, ReviewProcessor],
  exports: [BullModule],
})
export class ReviewModule {}
