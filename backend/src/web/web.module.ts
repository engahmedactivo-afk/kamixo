import { Controller, Get, Module, NotFoundException, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import { Response } from 'express';
import { PrismaService } from '../common/prisma.service';
import { config } from '../config';

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * SEO pages for the web player. Search engines get server-rendered HTML with structured data;
 * browsers are forwarded to the web app at /web/#/series/<id>.
 */
@Controller()
export class WebSeoController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('watch/:id')
  async watch(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const s = await this.prisma.series.findFirst({
      where: { id, status: 'PUBLISHED' },
      include: { episodes: { orderBy: { number: 'asc' }, select: { number: true, title: true, durationSec: true } } },
    });
    if (!s) throw new NotFoundException();
    const url = `${config.publicBaseUrl}/watch/${s.id}`;
    const app = `${config.publicBaseUrl}/web/#/series/${s.id}`;
    const ld = {
      '@context': 'https://schema.org',
      '@type': 'TVSeries',
      name: s.title,
      description: s.description,
      image: s.coverUrl,
      genre: s.genres,
      numberOfEpisodes: s.episodes.length,
      url,
    };
    res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(s.title)} – watch all ${s.episodes.length} episodes | Kamixo</title>
<meta name="description" content="${esc(s.description.slice(0, 160))}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:title" content="${esc(s.title)}"><meta property="og:description" content="${esc(s.description)}">
<meta property="og:image" content="${esc(s.coverUrl)}"><meta property="og:type" content="video.tv_show"><meta property="og:url" content="${esc(url)}">
<script type="application/ld+json">${JSON.stringify(ld)}</script>
<script>if(!/bot|crawl|spider|slurp|facebookexternalhit|preview/i.test(navigator.userAgent)){location.replace(${JSON.stringify(app)})}</script>
<style>body{font-family:system-ui;background:#0f0f14;color:#eee;max-width:720px;margin:0 auto;padding:24px}img{width:220px;border-radius:10px}a{color:#ff3d71}</style>
</head><body><h1>${esc(s.title)}</h1><img src="${esc(s.coverUrl)}" alt="${esc(s.title)} cover"><p>${esc(s.description)}</p>
<p>${esc(s.genres.join(' · '))} · ${s.freeEpisodes} free episodes</p><p><a href="${esc(app)}">Watch now</a></p>
<h2>Episodes</h2><ol>${s.episodes.map((e) => `<li>Episode ${e.number}${e.title ? `: ${esc(e.title)}` : ''}</li>`).join('')}</ol>
</body></html>`);
  }

  @Get('sitemap.xml')
  async sitemap(@Res() res: Response) {
    const rows = await this.prisma.series.findMany({ where: { status: 'PUBLISHED' }, select: { id: true, updatedAt: true } });
    const urls = rows.map((r) => `<url><loc>${config.publicBaseUrl}/watch/${r.id}</loc><lastmod>${r.updatedAt.toISOString()}</lastmod></url>`);
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`);
  }

  @Get('robots.txt')
  robots(@Res() res: Response) {
    res.type('text/plain').send(`User-agent: *\nAllow: /watch/\nDisallow: /admin/\nDisallow: /studio/\nSitemap: ${config.publicBaseUrl}/sitemap.xml\n`);
  }
}

@Module({ controllers: [WebSeoController] })
export class WebModule {}
