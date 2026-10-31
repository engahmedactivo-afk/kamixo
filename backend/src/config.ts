function required(name: string, devDefault: string): string {
  const value = process.env[name];
  if (value && value.length > 0) return value;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return devDefault;
}

export const config = {
  get port(): number {
    return Number(process.env.PORT ?? 3000);
  },
  get jwtSecret(): string {
    return required('JWT_SECRET', 'dev-only-jwt-secret');
  },
  get adminApiKey(): string {
    return required('ADMIN_API_KEY', 'dev-admin-key');
  },
  get purchaseVerifier(): 'sandbox' | 'revenuecat' {
    const v = process.env.PURCHASE_VERIFIER ?? 'sandbox';
    if (v !== 'sandbox' && v !== 'revenuecat') {
      throw new Error(`PURCHASE_VERIFIER must be "sandbox" or "revenuecat", got "${v}"`);
    }
    if (v === 'sandbox' && process.env.NODE_ENV === 'production') {
      throw new Error('PURCHASE_VERIFIER=sandbox is not allowed in production');
    }
    return v;
  },
  get revenueCatSecretKey(): string {
    return process.env.REVENUECAT_SECRET_API_KEY ?? '';
  },
  get playbackSigningSecret(): string {
    return process.env.PLAYBACK_SIGNING_SECRET ?? '';
  },
  get playbackUrlTtlSeconds(): number {
    return Number(process.env.PLAYBACK_URL_TTL_SECONDS ?? 3600);
  },
  get revenueCatWebhookSecret(): string {
    return process.env.REVENUECAT_WEBHOOK_SECRET ?? '';
  },
  get adRewardVerifier(): 'sandbox' | 'admob' {
    const v = process.env.AD_REWARD_VERIFIER ?? 'sandbox';
    if (v !== 'sandbox' && v !== 'admob') throw new Error(`AD_REWARD_VERIFIER must be "sandbox" or "admob", got "${v}"`);
    if (v === 'sandbox' && process.env.NODE_ENV === 'production') {
      throw new Error('AD_REWARD_VERIFIER=sandbox is not allowed in production');
    }
    return v;
  },
  get adUnlockDailyCap(): number {
    return Number(process.env.AD_UNLOCK_DAILY_CAP ?? 5);
  },
  get fcmServiceAccountJson(): string {
    return process.env.FCM_SERVICE_ACCOUNT_JSON ?? '';
  },
  get publicBaseUrl(): string {
    return (process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  },
  get appUrlScheme(): string {
    return process.env.APP_URL_SCHEME ?? 'kamixo';
  },
};
