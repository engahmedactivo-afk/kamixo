import { createHmac } from 'crypto';
import { StripeClient } from './stripe.client';

describe('StripeClient.verifySignature', () => {
  const secret = 'whsec_test';
  const body = '{"id":"evt_1","type":"checkout.session.completed"}';
  const now = 1_700_000_000;
  const sign = (t: number, b = body) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${b}`).digest('hex')}`;

  it('accepts a fresh, valid signature', () => {
    expect(StripeClient.verifySignature(body, sign(now), secret, now + 10)).toBe(true);
  });

  it('rejects tampered bodies, wrong secrets and stale timestamps', () => {
    expect(StripeClient.verifySignature(body + ' ', sign(now), secret, now)).toBe(false);
    expect(StripeClient.verifySignature(body, sign(now), 'other', now)).toBe(false);
    expect(StripeClient.verifySignature(body, sign(now), secret, now + 600)).toBe(false);
    expect(StripeClient.verifySignature(body, undefined, secret, now)).toBe(false);
    expect(StripeClient.verifySignature(body, sign(now), '', now)).toBe(false);
  });
});
