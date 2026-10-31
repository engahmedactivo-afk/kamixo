/* Development seed: coin packs + a few sample series using public HLS test streams. */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const STREAMS = [
  'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
  'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8',
  'https://test-streams.mux.dev/tos_ismc/main.m3u8',
];

const SAMPLE_SERIES = [
  { title: 'The Billionaire’s Secret Bride', genres: ['Romance', 'CEO'], description: 'A contract marriage turns into something neither of them planned.' },
  { title: 'Revenge of the Forgotten Heiress', genres: ['Revenge', 'Family'], description: 'Thrown out by her family, she returns ten years later to take everything back.' },
  { title: 'Alpha’s Rejected Mate', genres: ['Werewolf', 'Romance'], description: 'Rejected on her eighteenth birthday, she discovers who she really is.' },
  { title: 'My Husband Is the Mafia Boss', genres: ['Mafia', 'Romance'], description: 'She married a quiet accountant. He was anything but.' },
];

async function main() {
  const packs = [
    { productId: 'coins_100', coins: 100, bonusCoins: 0, priceLabel: '$0.99', sortOrder: 1 },
    { productId: 'coins_500', coins: 500, bonusCoins: 50, priceLabel: '$4.99', sortOrder: 2 },
    { productId: 'coins_1000', coins: 1000, bonusCoins: 150, priceLabel: '$9.99', sortOrder: 3 },
    { productId: 'coins_2500', coins: 2500, bonusCoins: 500, priceLabel: '$19.99', sortOrder: 4 },
  ];
  for (const p of packs) {
    await prisma.coinPack.upsert({ where: { productId: p.productId }, create: p, update: p });
  }

  const plans = [
    { productId: 'vip_weekly', name: 'VIP Weekly', days: 7, priceLabel: '$4.99/week', sortOrder: 1 },
    { productId: 'vip_monthly', name: 'VIP Monthly', days: 30, priceLabel: '$14.99/month', sortOrder: 2 },
  ];
  for (const p of plans) {
    await prisma.vipPlan.upsert({ where: { productId: p.productId }, create: p, update: p });
  }

  if ((await prisma.series.count()) > 0) {
    console.log('Series already present, skipping sample series.');
    return;
  }
  for (const [i, s] of SAMPLE_SERIES.entries()) {
    await prisma.series.create({
      data: {
        ...s,
        coverUrl: `https://picsum.photos/seed/kamixo${i}/540/960`,
        freeEpisodes: 5,
        coinsPerEpisode: 60,
        status: 'PUBLISHED',
        publishedAt: new Date(Date.now() - i * 86400000),
        viewCount: 1000 - i * 100,
        episodes: {
          create: Array.from({ length: 20 }, (_, n) => ({
            number: n + 1,
            title: `Episode ${n + 1}`,
            durationSec: 90,
            hlsUrl: STREAMS[(i + n) % STREAMS.length],
          })),
        },
      },
    });
  }
  console.log(`Seeded ${packs.length} coin packs and ${SAMPLE_SERIES.length} series.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
