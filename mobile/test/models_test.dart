import 'package:flutter_test/flutter_test.dart';
import 'package:kamixo/api/models.dart';

void main() {
  test('parses series detail with lock state and progress', () {
    final d = SeriesDetail.fromJson({
      'series': {
        'id': 's1',
        'title': 'T',
        'description': 'D',
        'coverUrl': 'https://x/c.jpg',
        'genres': ['Romance'],
        'freeEpisodes': 1,
        'coinsPerEpisode': 60,
        'totalEpisodes': 2,
      },
      'episodes': [
        {'id': 'e1', 'number': 1, 'title': '', 'durationSec': 90, 'free': true, 'locked': false},
        {'id': 'e2', 'number': 2, 'title': '', 'durationSec': 90, 'free': false, 'locked': true},
      ],
      'progress': {'episodeNumber': 2, 'positionSec': 12},
    });
    expect(d.series.coinsPerEpisode, 60);
    expect(d.episodes.map((e) => e.locked), [false, true]);
    expect(d.resumeEpisode, 2);
    expect(d.resumePositionSec, 12);
  });

  test('parses feed items', () {
    final item = FeedItem.fromJson({
      'series': {
        'id': 's1',
        'title': 'T',
        'coverUrl': 'https://x/c.jpg',
        'genres': <String>[],
        'freeEpisodes': 5,
        'coinsPerEpisode': 60,
      },
      'episode': {
        'id': 'e1',
        'number': 1,
        'durationSec': 90,
        'playback': {'url': 'https://x/e1.m3u8', 'subtitles': {'en': 'https://x/e1.vtt'}, 'expiresAt': null},
      },
    });
    expect(item.playback.subtitles['en'], 'https://x/e1.vtt');
    expect(item.series.totalEpisodes, 0);
  });
}
