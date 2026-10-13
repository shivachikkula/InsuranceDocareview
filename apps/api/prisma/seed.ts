import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '../src/generated/prisma/client.js';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

const PASSWORD = 'Password123!';

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const users = [
    { email: 'alice@example.com', name: 'Alice Claimant', role: 'CLAIMANT' as const },
    { email: 'bob@example.com', name: 'Bob Claimant', role: 'CLAIMANT' as const },
    { email: 'rita@insurer.example', name: 'Rita Reviewer', role: 'REVIEWER' as const },
    { email: 'raj@insurer.example', name: 'Raj Reviewer', role: 'REVIEWER' as const },
    { email: 'anna@insurer.example', name: 'Anna Approver', role: 'APPROVER' as const },
    { email: 'admin@insurer.example', name: 'Admin', role: 'ADMIN' as const },
  ];
  const byEmail: Record<string, string> = {};
  for (const u of users) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { ...u, passwordHash },
    });
    byEmail[u.email] = user.id;
  }

  const year = new Date().getFullYear();
  const policies = [
    {
      policyNumber: 'AUTO-100234',
      holderId: byEmail['alice@example.com'],
      lineOfBusiness: 'AUTO' as const,
      status: 'ACTIVE' as const,
      effectiveDate: new Date(`${year}-01-01`),
      expiryDate: new Date(`${year}-12-31`),
      coverageLimit: 50_000,
      deductible: 500,
      exclusions: [
        'Racing or speed testing',
        'Commercial ride-share use',
        'Wear and tear',
        'Driver under the influence',
      ],
      terms:
        'Collision and comprehensive cover for the insured vehicle (2021 Toyota Camry, VIN 4T1B11HK5MU123456). ' +
        'Repairs must be carried out by a licensed repair shop. Rental car reimbursement up to $40/day for 30 days.',
    },
    {
      policyNumber: 'HOME-200871',
      holderId: byEmail['alice@example.com'],
      lineOfBusiness: 'PROPERTY' as const,
      status: 'ACTIVE' as const,
      effectiveDate: new Date(`${year}-03-01`),
      expiryDate: new Date(`${year + 1}-02-28`),
      coverageLimit: 300_000,
      deductible: 1_000,
      exclusions: ['Flood', 'Earthquake', 'Gradual leaks and seepage', 'Mold', 'Neglect'],
      terms:
        'Homeowners cover for 12 Elm Street, Springfield. Sudden and accidental water damage is covered.',
    },
    {
      policyNumber: 'HLTH-300552',
      holderId: byEmail['bob@example.com'],
      lineOfBusiness: 'HEALTH' as const,
      status: 'LAPSED' as const,
      effectiveDate: new Date(`${year - 1}-01-01`),
      expiryDate: new Date(`${year - 1}-12-31`),
      coverageLimit: 100_000,
      deductible: 250,
      exclusions: ['Cosmetic procedures', 'Experimental treatments', 'Out-of-network elective care'],
      terms: 'Individual health plan. In-network outpatient care covered at 80% after deductible.',
    },
  ];
  for (const p of policies) {
    await prisma.policy.upsert({ where: { policyNumber: p.policyNumber }, update: {}, create: p });
  }

  console.log(`Seeded ${users.length} users (password: ${PASSWORD}) and ${policies.length} policies.`);
}

await main().finally(() => prisma.$disconnect());
