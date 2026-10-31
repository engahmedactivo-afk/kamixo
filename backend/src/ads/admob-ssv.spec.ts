import { generateKeyPairSync, sign } from 'crypto';
import { AdMobSsvVerifier } from './admob-ssv';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pem = publicKey.export({ type: 'spki', format: 'pem' }) as string;

function keysFetch(keyId = '3335941'): typeof fetch {
  return (async () => ({ ok: true, status: 200, json: async () => ({ keys: [{ keyId, pem }] }) })) as unknown as typeof fetch;
}

function signedQuery(overrides: Record<string, string> = {}, keyId = '3335941') {
  const params = new URLSearchParams({
    ad_network: '5450213213286189855',
    ad_unit: '1234567890',
    custom_data: 'user-1:episode-1',
    reward_amount: '1',
    reward_item: 'episode',
    timestamp: '1700000000000',
    transaction_id: 'txn-abc',
    user_id: 'user-1',
    ...overrides,
  });
  const content = params.toString();
  const signature = sign('sha256', Buffer.from(content), privateKey).toString('base64url');
  return `${content}&signature=${signature}&key_id=${keyId}`;
}

describe('AdMobSsvVerifier', () => {
  it('accepts a correctly signed callback', async () => {
    const v = new AdMobSsvVerifier(keysFetch());
    const cb = await v.verify(signedQuery());
    expect(cb).toMatchObject({ customData: 'user-1:episode-1', transactionId: 'txn-abc', userId: 'user-1', rewardAmount: 1 });
  });

  it('rejects a tampered callback', async () => {
    const v = new AdMobSsvVerifier(keysFetch());
    const q = signedQuery().replace('custom_data=user-1%3Aepisode-1', 'custom_data=user-2%3Aepisode-1');
    expect(await v.verify(q)).toBeNull();
  });

  it('rejects an unknown key id and a missing signature', async () => {
    const v = new AdMobSsvVerifier(keysFetch('1'));
    expect(await v.verify(signedQuery({}, '2'))).toBeNull();
    expect(await v.verify('ad_unit=1&transaction_id=x')).toBeNull();
  });
});
