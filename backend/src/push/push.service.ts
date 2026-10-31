import { Inject, Injectable, Logger } from '@nestjs/common';
import { FETCH } from '../common/fetch.token';
import { createSign } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { config } from '../config';

export interface PushMessage {
  title: string;
  body: string;
  /** Deep-link payload the app reads on tap, e.g. { seriesId, episode } */
  data?: Record<string, string>;
}

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

/**
 * Sends notifications through Firebase Cloud Messaging (HTTP v1) using a service account.
 * No Google SDK: the OAuth token is minted with a signed JWT, as documented at
 * https://developers.google.com/identity/protocols/oauth2/service-account
 */
@Injectable()
export class PushService {
  private readonly log = new Logger(PushService.name);
  private readonly account: ServiceAccount | null;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FETCH) private readonly fetchImpl: typeof fetch = fetch,
  ) {
    const raw = config.fcmServiceAccountJson;
    this.account = raw ? (JSON.parse(raw) as ServiceAccount) : null;
    if (!this.account) this.log.log('FCM_SERVICE_ACCOUNT_JSON not set: push notifications disabled');
  }

  get enabled(): boolean {
    return this.account !== null;
  }

  async register(userId: string, token: string, platform: string) {
    await this.prisma.pushToken.upsert({
      where: { token },
      create: { token, userId, platform },
      update: { userId, platform },
    });
  }

  async sendToUsers(userIds: string[], msg: PushMessage): Promise<{ sent: number; failed: number }> {
    if (userIds.length === 0) return { sent: 0, failed: 0 };
    const tokens = await this.prisma.pushToken.findMany({ where: { userId: { in: userIds } }, select: { token: true } });
    return this.sendToTokens(tokens.map((t) => t.token), msg);
  }

  async sendToAll(msg: PushMessage): Promise<{ sent: number; failed: number }> {
    const tokens = await this.prisma.pushToken.findMany({ select: { token: true } });
    return this.sendToTokens(tokens.map((t) => t.token), msg);
  }

  private async sendToTokens(tokens: string[], msg: PushMessage) {
    const result = { sent: 0, failed: 0 };
    if (!this.account || tokens.length === 0) return result;
    const accessToken = await this.accessToken();
    const dead: string[] = [];
    // FCM v1 has no batch endpoint; send in small parallel groups.
    for (let i = 0; i < tokens.length; i += 20) {
      await Promise.all(
        tokens.slice(i, i + 20).map(async (token) => {
          const res = await this.fetchImpl(
            `https://fcm.googleapis.com/v1/projects/${this.account!.project_id}/messages:send`,
            {
              method: 'POST',
              headers: { Authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
              body: JSON.stringify({
                message: { token, notification: { title: msg.title, body: msg.body }, data: msg.data ?? {} },
              }),
            },
          );
          if (res.ok) {
            result.sent++;
            return;
          }
          result.failed++;
          const body = await res.text();
          if (res.status === 404 || body.includes('UNREGISTERED') || body.includes('INVALID_ARGUMENT')) dead.push(token);
          else this.log.warn(`FCM send failed: HTTP ${res.status} ${body.slice(0, 200)}`);
        }),
      );
    }
    if (dead.length) await this.prisma.pushToken.deleteMany({ where: { token: { in: dead } } });
    return result;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const acct = this.account!;
    const now = Math.floor(Date.now() / 1000);
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
      iss: acct.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(acct.private_key, 'base64url');
    const res = await this.fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsigned}.${signature}`,
      }),
    });
    if (!res.ok) throw new Error(`Google OAuth token request failed: HTTP ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return body.access_token;
  }
}
