import { Injectable, Logger } from '@nestjs/common';
import { config } from '../config';

export interface PurchaseClaim {
  userId: string;
  platform: 'ios' | 'android';
  productId: string;
  transactionId: string;
}

export interface PurchaseVerifier {
  /** Resolves true only if the store confirms this user bought `productId` in `transactionId`. */
  verify(claim: PurchaseClaim): Promise<boolean>;
}

export const PURCHASE_VERIFIER = Symbol('PURCHASE_VERIFIER');

/** Development only: trusts the client. Refused in production by config. */
@Injectable()
export class SandboxPurchaseVerifier implements PurchaseVerifier {
  async verify(): Promise<boolean> {
    return true;
  }
}

/**
 * Verifies consumable purchases with RevenueCat's REST API.
 * The app must configure RevenueCat with `appUserID = <our user id>` so purchases land on that subscriber.
 * https://www.revenuecat.com/docs/api-v1#tag/customers/operation/subscribers
 */
@Injectable()
export class RevenueCatPurchaseVerifier implements PurchaseVerifier {
  private readonly log = new Logger(RevenueCatPurchaseVerifier.name);

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async verify(claim: PurchaseClaim): Promise<boolean> {
    const res = await this.fetchImpl(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(claim.userId)}`,
      { headers: { Authorization: `Bearer ${config.revenueCatSecretKey}`, Accept: 'application/json' } },
    );
    if (!res.ok) {
      this.log.warn(`RevenueCat lookup failed with HTTP ${res.status}`);
      return false;
    }
    const body = (await res.json()) as {
      subscriber?: { non_subscriptions?: Record<string, { id: string; store_transaction_id?: string }[]> };
    };
    const txns = body.subscriber?.non_subscriptions?.[claim.productId] ?? [];
    return txns.some((t) => t.store_transaction_id === claim.transactionId || t.id === claim.transactionId);
  }
}
