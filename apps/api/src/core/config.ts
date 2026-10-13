import { z } from 'zod';

const ConfigSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  JWT_SECRET: z.string().min(8),
  STORAGE_DIR: z.string().default('./storage'),
  ANTHROPIC_MODEL: z.string().default('claude-opus-5-5'),
  AI_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('high'),
  MANUAL_REVIEW_AMOUNT: z.coerce.number().default(10_000),
  FINAL_APPROVAL_AMOUNT: z.coerce.number().default(25_000),
  MANUAL_REVIEW_RISK_SCORE: z.coerce.number().default(60),
  LATE_FILING_DAYS: z.coerce.number().default(30),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return ConfigSchema.parse(env);
}

export const APP_CONFIG = Symbol('APP_CONFIG');
