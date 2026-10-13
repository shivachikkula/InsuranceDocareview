import Anthropic from '@anthropic-ai/sdk';
import { Module } from '@nestjs/common';
import { ANTHROPIC_CLIENT, ClaimReviewAgent } from './claim-review.agent.js';
import { ProviderCheckService } from './provider-check.service.js';

@Module({
  providers: [
    // Reads ANTHROPIC_API_KEY (or another configured credential) from the environment.
    { provide: ANTHROPIC_CLIENT, useFactory: () => new Anthropic() },
    ClaimReviewAgent,
    ProviderCheckService,
  ],
  exports: [ClaimReviewAgent, ProviderCheckService],
})
export class AgentModule {}
