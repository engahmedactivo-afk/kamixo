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
  final bool vip;

  SeriesDetail.fromJson(Map<String, dynamic> j)
      : series = SeriesSummary.fromJson(j['series'] as Map<String, dynamic>),
        episodes = (j['episodes'] as List).map((e) => EpisodeInfo.fromJson(e as Map<String, dynamic>)).toList(),
        resumeEpisode = (j['progress'] as Map?)?['episodeNumber'] as int?,
        resumePositionSec = ((j['progress'] as Map?)?['positionSec'] ?? 0) as int,
        vip = (j['vip'] ?? false) as bool;
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

class VipStatus {
  final bool active;
  final String? productId;
  final DateTime? expiresAt;
  final bool willRenew;

  const VipStatus.none()
      : active = false,
        productId = null,
        expiresAt = null,
        willRenew = false;

  VipStatus.fromJson(Map<String, dynamic> j)
      : active = j['active'] as bool,
        productId = j['productId'] as String?,
        expiresAt = j['expiresAt'] == null ? null : DateTime.parse(j['expiresAt'] as String),
        willRenew = (j['willRenew'] ?? false) as bool;
}

class VipPlan {
  final String productId;
  final String name;
  final int days;
  final String priceLabel;

  VipPlan.fromJson(Map<String, dynamic> j)
      : productId = j['productId'] as String,
        name = j['name'] as String,
        days = j['days'] as int,
        priceLabel = j['priceLabel'] as String;
}

class AdUsage {
  final int cap;
  final int usedToday;
  final int remainingToday;

  const AdUsage.unknown()
      : cap = 0,
        usedToday = 0,
        remainingToday = 0;

  AdUsage.fromJson(Map<String, dynamic> j)
      : cap = j['cap'] as int,
        usedToday = j['usedToday'] as int,
        remainingToday = j['remainingToday'] as int;
}

class Me {
  final String id;
  final int balance;
  final VipStatus vip;
  final AdUsage ads;
  final bool hasPurchased;

  Me.fromJson(Map<String, dynamic> j)
      : id = j['id'] as String,
        balance = j['balance'] as int,
        vip = VipStatus.fromJson(j['vip'] as Map<String, dynamic>),
        ads = AdUsage.fromJson(j['ads'] as Map<String, dynamic>),
        hasPurchased = (j['hasPurchased'] ?? false) as bool;
}

class RemoteConfig {
  final int firstPurchaseBonusPct;
  final String paywallPrimary;
  final Map<String, String> variants;
  final int adUnlockDailyCap;
  final String shareBaseUrl;

  const RemoteConfig.defaults()
      : firstPurchaseBonusPct = 0,
        paywallPrimary = 'coins',
        variants = const {},
        adUnlockDailyCap = 0,
        shareBaseUrl = '';

  RemoteConfig.fromJson(Map<String, dynamic> j)
      : firstPurchaseBonusPct = (j['firstPurchaseBonusPct'] ?? 0) as int,
        paywallPrimary = (j['paywallPrimary'] ?? 'coins') as String,
        variants = Map<String, String>.from((j['variants'] ?? {}) as Map),
        adUnlockDailyCap = (j['adUnlockDailyCap'] ?? 0) as int,
        shareBaseUrl = (j['shareBaseUrl'] ?? '') as String;
}

class RewardTask {
  final String key;
  final String title;
  final int coins;
  final bool done;

  RewardTask.fromJson(Map<String, dynamic> j)
      : key = j['key'] as String,
        title = j['title'] as String,
        coins = j['coins'] as int,
        done = j['done'] as bool;
}

class RewardsSummary {
  final bool checkedInToday;
  final int streak;
  final int nextReward;
  final List<int> schedule;
  final List<RewardTask> tasks;

  RewardsSummary.fromJson(Map<String, dynamic> j)
      : checkedInToday = (j['checkIn'] as Map)['checkedInToday'] as bool,
        streak = (j['checkIn'] as Map)['streak'] as int,
        nextReward = (j['checkIn'] as Map)['nextReward'] as int,
        schedule = List<int>.from((j['checkIn'] as Map)['schedule'] as List),
        tasks = (j['tasks'] as List).map((t) => RewardTask.fromJson(t as Map<String, dynamic>)).toList();
}
