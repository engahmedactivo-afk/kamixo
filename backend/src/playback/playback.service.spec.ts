import { createHmac } from 'crypto';
import { isFreeEpisode, signMediaUrl } from './playback.service';

describe('signMediaUrl', () => {
  afterEach(() => {
    delete process.env.PLAYBACK_SIGNING_SECRET;
    delete process.env.PLAYBACK_URL_TTL_SECONDS;
  });

  it('returns the raw URL when no secret is set', () => {
    expect(signMediaUrl('https://cdn.x/a/b.m3u8')).toEqual({ url: 'https://cdn.x/a/b.m3u8', expiresAt: null });
  });

  it('signs the directory path with an expiry', () => {
    process.env.PLAYBACK_SIGNING_SECRET = 's3cret';
    process.env.PLAYBACK_URL_TTL_SECONDS = '60';
    const now = 1_700_000_000_000;
    const { url, expiresAt } = signMediaUrl('https://cdn.x/series/1/ep/index.m3u8?q=1', now);
    const u = new URL(url);
    const exp = 1_700_000_060;
    expect(u.searchParams.get('exp')).toBe(String(exp));
    expect(u.searchParams.get('q')).toBe('1');
    expect(u.searchParams.get('sig')).toBe(createHmac('sha256', 's3cret').update(`/series/1/ep/:${exp}`).digest('hex'));
    expect(expiresAt).toBe(new Date(exp * 1000).toISOString());
  });
});

describe('isFreeEpisode', () => {
  it('treats the first N episodes as free', () => {
    expect(isFreeEpisode({ number: 5 }, { freeEpisodes: 5 })).toBe(true);
    expect(isFreeEpisode({ number: 6 }, { freeEpisodes: 5 })).toBe(false);
  });
});
