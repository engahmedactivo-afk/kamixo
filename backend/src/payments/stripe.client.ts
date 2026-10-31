import { Inject, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { FETCH } from '../common/fetch.token';
import { config } from '../config';

export interface CheckoutSession {
  id: string;
  url: string;
}

/** Minimal Stripe REST client (form-encoded), enough for Checkout + webhooks. */
@Injectable()
export class StripeClient {
  constructor(@Inject(FETCH) private readonly fetchImpl: typeof fetch = fetch) {}

  async createCheckoutSession(input: {
    name: string;
    amountCents: number;
    successUrl: string;
    cancelUrl: string;
    metadata: Record<string, string>;
  }): Promise<CheckoutSession> {
    const form = new URLSearchParams({
      mode: 'payment',
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': String(input.amountCents),
      'line_items[0][price_data][product_data][name]': input.name,
    });
    for (const [k, v] of Object.entries(input.metadata)) form.set(`metadata[${k}]`, v);
    const res = await this.fetchImpl('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.stripeSecretKey}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    if (!res.ok) throw new Error(`Stripe checkout failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as CheckoutSession;
    return { id: body.id, url: body.url };
  }

  /**
   * Verifies a Stripe-Signature header: "t=<ts>,v1=<hex>" where v1 = HMAC_SHA256(secret, "<ts>.<rawBody>").
   * https://stripe.com/docs/webhooks/signatures
   */
  static verifySignature(rawBody: string, header: string | undefined, secret: string, nowSec = Date.now() / 1000): boolean {
    if (!header || !secret) return false;
    const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
    const t = parts['t'];
    const v1 = parts['v1'];
    if (!t || !v1 || Math.abs(nowSec - Number(t)) > 300) return false;
    const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(v1);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
