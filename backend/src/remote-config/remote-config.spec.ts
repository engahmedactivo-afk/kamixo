import { bucket } from './remote-config.module';

describe('bucket', () => {
  it('is deterministic and spread across 0..99', () => {
    expect(bucket('user-a', 'paywall')).toBe(bucket('user-a', 'paywall'));
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const b = bucket(`user-${i}`, 'paywall');
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(100);
      seen.add(b);
    }
    expect(seen.size).toBeGreaterThan(80);
  });

  it('differs per experiment', () => {
    const all = Array.from({ length: 50 }, (_, i) => bucket(`u${i}`, 'a') === bucket(`u${i}`, 'b'));
    expect(all.every(Boolean)).toBe(false);
  });
});
