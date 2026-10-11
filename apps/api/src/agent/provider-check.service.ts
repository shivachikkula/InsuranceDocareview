import { Injectable } from '@nestjs/common';

/**
 * Stub provider verification. Replace with calls to your licensing registry,
 * NICB / SIU watchlist, or network provider directory.
 */
@Injectable()
export class ProviderCheckService {
  private readonly watchlist = new Map<string, string>([
    ['quickfix auto body', 'Under SIU investigation for inflated invoices (case SIU-2291)'],
    ['sunrise wellness clinic', 'License suspended 2026-03-01'],
  ]);

  async check(name: string) {
    const reason = this.watchlist.get(name.trim().toLowerCase());
    return reason
      ? { name, status: 'FLAGGED', reason }
      : {
          name,
          status: 'NO_RECORD',
          note: 'Not on watchlist. Licensing registry lookup not yet integrated.',
        };
  }
}
