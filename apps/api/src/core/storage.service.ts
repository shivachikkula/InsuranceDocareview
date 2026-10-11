import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { APP_CONFIG, type AppConfig } from './config.js';

/**
 * Local-disk document storage for development. Swap for an S3/Azure Blob
 * implementation with the same interface in production.
 */
@Injectable()
export class StorageService {
  private readonly root: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.root = path.resolve(config.STORAGE_DIR);
  }

  async save(claimId: string, buffer: Buffer): Promise<{ storageKey: string; sha256: string }> {
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const storageKey = `${claimId}/${randomUUID()}`;
    const target = this.resolve(storageKey);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, buffer);
    return { storageKey, sha256 };
  }

  read(storageKey: string): Promise<Buffer> {
    return readFile(this.resolve(storageKey));
  }

  private resolve(storageKey: string): string {
    const target = path.resolve(this.root, storageKey);
    if (!target.startsWith(this.root + path.sep)) {
      throw new Error('Invalid storage key');
    }
    return target;
  }
}
