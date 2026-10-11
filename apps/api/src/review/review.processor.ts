import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { REVIEW_QUEUE, type ReviewJobData } from './review.queue.js';
import { ReviewService } from './review.service.js';

@Processor(REVIEW_QUEUE, { concurrency: 4 })
export class ReviewProcessor extends WorkerHost {
  private readonly logger = new Logger(ReviewProcessor.name);

  constructor(private readonly reviews: ReviewService) {
    super();
  }

  async process(job: Job<ReviewJobData>) {
    await this.reviews.reviewClaim(job.data.claimId);
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<ReviewJobData>, error: Error) {
    this.logger.error(`Review job ${job.id} failed (attempt ${job.attemptsMade}): ${error.message}`);
    if (job.attemptsMade >= (job.opts.attempts ?? 1)) {
      await this.reviews.markFailed(job.data.claimId, error.message);
    }
  }
}
