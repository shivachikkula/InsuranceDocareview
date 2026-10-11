import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { ClaimsModule } from './claims/claims.module.js';
import { APP_CONFIG, type AppConfig } from './core/config.js';
import { CoreModule } from './core/core.module.js';

@Module({
  imports: [
    CoreModule,
    BullModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        connection: { host: config.REDIS_HOST, port: config.REDIS_PORT },
      }),
    }),
    AuthModule,
    ClaimsModule,
  ],
})
export class AppModule {}
