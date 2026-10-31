class SeriesSummary {
  final String id;
  final String title;
  final String description;
  final String coverUrl;
  final List<String> genres;
  final int freeEpisodes;
  final int coinsPerEpisode;
  final int totalEpisodes;

  SeriesSummary.fromJson(Map<String, dynamic> j)
      : id = j['id'] as String,
        title = j['title'] as String,
        description = (j['description'] ?? '') as String,
        coverUrl = j['coverUrl'] as String,
        genres = List<String>.from(j['genres'] as List),
        freeEpisodes = j['freeEpisodes'] as int,
        coinsPerEpisode = j['coinsPerEpisode'] as int,
        totalEpisodes = (j['totalEpisodes'] ?? 0) as int;
}

class Playback {
  final String url;
  final Map<String, String> subtitles;

  Playback.fromJson(Map<String, dynamic> j)
      : url = j['url'] as String,
        subtitles = Map<String, String>.from((j['subtitles'] ?? {}) as Map);
}

class FeedItem {
  final SeriesSummary series;
  final String episodeId;
  final Playback playback;

  FeedItem.fromJson(Map<String, dynamic> j)
      : series = SeriesSummary.fromJson(j['series'] as Map<String, dynamic>),
        episodeId = (j['episode'] as Map)['id'] as String,
        playback = Playback.fromJson((j['episode'] as Map)['playback'] as Map<String, dynamic>);
}

class EpisodeInfo {
  final String id;
  final int number;
  final int durationSec;
  final bool free;
  bool locked;

  EpisodeInfo.fromJson(Map<String, dynamic> j)
      : id = j['id'] as String,
        number = j['number'] as int,
        durationSec = (j['durationSec'] ?? 0) as int,
        free = j['free'] as bool,
        locked = j['locked'] as bool;
}

class SeriesDetail {
  final SeriesSummary series;
  final List<EpisodeInfo> episodes;
  final int? resumeEpisode;
  final int resumePositionSec;

  SeriesDetail.fromJson(Map<String, dynamic> j)
      : series = SeriesSummary.fromJson(j['series'] as Map<String, dynamic>),
        episodes = (j['episodes'] as List).map((e) => EpisodeInfo.fromJson(e as Map<String, dynamic>)).toList(),
        resumeEpisode = (j['progress'] as Map?)?['episodeNumber'] as int?,
        resumePositionSec = ((j['progress'] as Map?)?['positionSec'] ?? 0) as int;
}

class CoinPack {
  final String productId;
  final int coins;
  final int bonusCoins;
  final String priceLabel;

  CoinPack.fromJson(Map<String, dynamic> j)
      : productId = j['productId'] as String,
        coins = j['coins'] as int,
        bonusCoins = (j['bonusCoins'] ?? 0) as int,
        priceLabel = j['priceLabel'] as String;
}

class ContinueItem {
  final String seriesId;
  final String title;
  final String coverUrl;
  final int totalEpisodes;
  final int episodeNumber;

  ContinueItem.fromJson(Map<String, dynamic> j)
      : seriesId = j['seriesId'] as String,
        title = j['title'] as String,
        coverUrl = j['coverUrl'] as String,
        totalEpisodes = j['totalEpisodes'] as int,
        episodeNumber = j['episodeNumber'] as int;
}

class Page<T> {
  final List<T> items;
  final int? nextOffset;
  Page(this.items, this.nextOffset);
}
