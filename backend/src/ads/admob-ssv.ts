import { Inject, Injectable, Logger } from '@nestjs/common';
import { FETCH } from '../common/fetch.token';
import { createPublicKey, verify as cryptoVerify } from 'crypto';

/**
 * AdMob rewarded-ad server-side verification (SSV).
 * AdMob calls our URL with the reward details and an ECDSA signature made with a Google key;
 * the public keys are published at the URL below.
 * https://developers.google.com/admob/android/ssv
 */
export const ADMOB_KEYS_URL = 'https://www.gstatic.com/admob/reward/verifier-keys.json';

export interface SsvCallback {
  adUnit: string;
  customData: string;
  rewardAmount: number;
  rewardItem: string;
  transactionId: string;
  userId: string;
}

@Injectable()
export class AdMobSsvVerifier {
  private readonly log = new Logger(AdMobSsvVerifier.name);
  private keys = new Map<string, string>(); // keyId -> PEM
  private lastFetch = 0;

  constructor(@Inject(FETCH) private readonly fetchImpl: typeof fetch = fetch) {}

  private async loadKeys(force = false) {
    if (!force && Date.now() - this.lastFetch < 3600_000 && this.keys.size > 0) return;
    const res = await this.fetchImpl(ADMOB_KEYS_URL);
    if (!res.ok) throw new Error(`AdMob key fetch failed: HTTP ${res.status}`);
    const body = (await res.json()) as { keys: { keyId: number | string; pem: string }[] };
    this.keys = new Map(body.keys.map((k) => [String(k.keyId), k.pem]));
    this.lastFetch = Date.now();
  }

  /**
   * Verifies the raw query string of the callback (everything after `?`).
   * The signed content is the query string up to, but not including, `&signature=`.
   */
  async verify(rawQuery: string): Promise<SsvCallback | null> {
    const sigIndex = rawQuery.indexOf('&signature=');
    if (sigIndex < 0) return null;
    const content = rawQuery.slice(0, sigIndex);
    const params = new URLSearchParams(rawQuery);
    const signature = params.get('signature');
    const keyId = params.get('key_id');
    if (!signature || !keyId) return null;

    await this.loadKeys();
    if (!this.keys.has(keyId)) await this.loadKeys(true);
    const pem = this.keys.get(keyId);
    if (!pem) {
      this.log.warn(`Unknown AdMob key id ${keyId}`);
      return null;
    }
    const ok = cryptoVerify('sha256', Buffer.from(content, 'utf8'), createPublicKey(pem), Buffer.from(signature, 'base64url'));
    if (!ok) return null;
    return {
      adUnit: params.get('ad_unit') ?? '',
      customData: params.get('custom_data') ?? '',
      rewardAmount: Number(params.get('reward_amount') ?? 0),
      rewardItem: params.get('reward_item') ?? '',
      transactionId: params.get('transaction_id') ?? '',
      userId: params.get('user_id') ?? '',
    };
  }
}
