import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // Optional here so `prisma generate` (run on npm install) works before .env exists.
    url: process.env.DATABASE_URL ?? '',
  },
});
