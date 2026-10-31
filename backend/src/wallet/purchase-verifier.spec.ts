import { RevenueCatPurchaseVerifier } from './purchase-verifier';

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () => ({ ok: status < 400, status, json: async () => body })) as unknown as typeof fetch;
}

const claim = { userId: 'u1', platform: 'ios' as const, productId: 'coins_100', transactionId: '2000000123' };

describe('RevenueCatPurchaseVerifier', () => {
  it('accepts a matching store transaction', async () => {
    const v = new RevenueCatPurchaseVerifier(
      fakeFetch(200, { subscriber: { non_subscriptions: { coins_100: [{ id: 'rc1', store_transaction_id: '2000000123' }] } } }),
    );
    await expect(v.verify(claim)).resolves.toBe(true);
  });

  it('rejects a transaction for a different product', async () => {
    const v = new RevenueCatPurchaseVerifier(
      fakeFetch(200, { subscriber: { non_subscriptions: { coins_2500: [{ id: 'rc1', store_transaction_id: '2000000123' }] } } }),
    );
    await expect(v.verify(claim)).resolves.toBe(false);
  });

  it('rejects when RevenueCat errors', async () => {
    await expect(new RevenueCatPurchaseVerifier(fakeFetch(500, {})).verify(claim)).resolves.toBe(false);
  });
});
