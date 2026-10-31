import { Injectable } from '@nestjs/common';
import { RevenueCatClient } from '../common/revenuecat.client';

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
 * Verifies consumable purchases with RevenueCat.
 * The app must configure RevenueCat with `appUserID = <our user id>` so purchases land on that subscriber.
 */
@Injectable()
export class RevenueCatPurchaseVerifier implements PurchaseVerifier {
  constructor(private readonly rc: RevenueCatClient) {}

  async verify(claim: PurchaseClaim): Promise<boolean> {
    const sub = await this.rc.subscriber(claim.userId);
    const txns = sub?.non_subscriptions?.[claim.productId] ?? [];
    return txns.some((t) => t.store_transaction_id === claim.transactionId || t.id === claim.transactionId);
  }
}
