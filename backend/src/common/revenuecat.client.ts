import { Inject, Injectable, Logger } from '@nestjs/common';
import { FETCH } from './fetch.token';
import { config } from '../config';

export interface RcSubscriber {
  subscriptions?: Record<string, { expires_date: string | null; store?: string; unsubscribe_detected_at?: string | null }>;
  non_subscriptions?: Record<string, { id: string; store_transaction_id?: string; purchase_date?: string }[]>;
}

/** Thin wrapper over the RevenueCat REST API (v1). */
@Injectable()
export class RevenueCatClient {
  private readonly log = new Logger(RevenueCatClient.name);
  constructor(@Inject(FETCH) private readonly fetchImpl: typeof fetch = fetch) {}

  async subscriber(userId: string): Promise<RcSubscriber | null> {
    const res = await this.fetchImpl(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${config.revenueCatSecretKey}`, Accept: 'application/json' },
    });
    if (!res.ok) {
      this.log.warn(`RevenueCat lookup failed with HTTP ${res.status}`);
      return null;
    }
    const body = (await res.json()) as { subscriber?: RcSubscriber };
    return body.subscriber ?? null;
  }
}
