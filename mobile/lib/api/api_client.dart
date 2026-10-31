import 'package:dio/dio.dart';

import 'models.dart';

/// Error returned by the backend. [code] is stable (e.g. EPISODE_LOCKED, INSUFFICIENT_COINS).
class ApiException implements Exception {
  final int status;
  final String code;
  final String message;
  final Map<String, dynamic> body;
  ApiException(this.status, this.code, this.message, this.body);

  @override
  String toString() => 'ApiException($status, $code): $message';
}

typedef DeviceIdProvider = Future<String> Function();

class ApiClient {
  final Dio _dio;
  final DeviceIdProvider deviceId;
  final String locale;
  String? _token;
  String? userId;
  Future<void>? _loggingIn;

  ApiClient({required String baseUrl, required this.deviceId, this.locale = 'en'})
      : _dio = Dio(BaseOptions(
          baseUrl: baseUrl,
          connectTimeout: const Duration(seconds: 10),
          receiveTimeout: const Duration(seconds: 20),
        ));

  /// Guest login. Safe to call concurrently; only one request is made.
  Future<void> login() => _loggingIn ??= _doLogin().whenComplete(() => _loggingIn = null);

  Future<void> _doLogin() async {
    final res = await _dio.post<Map<String, dynamic>>('/auth/guest', data: {
      'deviceId': await deviceId(),
      'locale': locale,
    });
    _token = res.data!['accessToken'] as String;
    userId = (res.data!['user'] as Map)['id'] as String;
  }

  Future<T> _call<T>(String method, String path, {Object? data, Map<String, dynamic>? query, bool retried = false}) async {
    if (_token == null) await login();
    try {
      final res = await _dio.request<T>(path,
          data: data,
          queryParameters: query,
          options: Options(method: method, headers: {'Authorization': 'Bearer $_token'}));
      return res.data as T;
    } on DioException catch (e) {
      final res = e.response;
      if (res?.statusCode == 401 && !retried) {
        _token = null; // expired token: log in again and retry once
        return _call<T>(method, path, data: data, query: query, retried: true);
      }
      if (res != null && res.data is Map) {
        final body = Map<String, dynamic>.from(res.data as Map);
        throw ApiException(res.statusCode ?? 0, (body['code'] ?? 'HTTP_${res.statusCode}') as String,
            body['message']?.toString() ?? 'Request failed', body);
      }
      throw ApiException(res?.statusCode ?? 0, 'NETWORK', 'Network error, please try again', {});
    }
  }

  Future<Page<FeedItem>> feed({int offset = 0, int limit = 10}) async {
    final j = await _call<Map<String, dynamic>>('GET', '/feed', query: {'offset': offset, 'limit': limit});
    return Page((j['items'] as List).map((e) => FeedItem.fromJson(e as Map<String, dynamic>)).toList(),
        j['nextOffset'] as int?);
  }

  Future<List<String>> genres() async {
    final j = await _call<List<dynamic>>('GET', '/genres');
    return j.map((e) => (e as Map)['genre'] as String).toList();
  }

  Future<Page<SeriesSummary>> series({String? genre, String? q, String sort = 'popular', int offset = 0}) async {
    final j = await _call<Map<String, dynamic>>('GET', '/series', query: {
      'genre': ?genre,
      if (q != null && q.isNotEmpty) 'q': q,
      'sort': sort,
      'offset': offset,
    });
    return Page((j['items'] as List).map((e) => SeriesSummary.fromJson(e as Map<String, dynamic>)).toList(),
        j['nextOffset'] as int?);
  }

  Future<SeriesDetail> seriesDetail(String id) async =>
      SeriesDetail.fromJson(await _call<Map<String, dynamic>>('GET', '/series/$id'));

  /// Plays the AI-dubbed version in the device language when one exists, otherwise the original.
  Future<Playback> playback(String episodeId) async =>
      Playback.fromJson(await _call<Map<String, dynamic>>('GET', '/episodes/$episodeId/playback', query: {'lang': locale}));

  /// Returns the new coin balance.
  Future<int> unlock(String episodeId) async =>
      (await _call<Map<String, dynamic>>('POST', '/episodes/$episodeId/unlock'))['balance'] as int;

  Future<int> balance() async => (await _call<Map<String, dynamic>>('GET', '/wallet'))['balance'] as int;

  Future<Me> me() async => Me.fromJson(await _call<Map<String, dynamic>>('GET', '/me'));

  Future<RemoteConfig> config() async => RemoteConfig.fromJson(await _call<Map<String, dynamic>>('GET', '/config'));

  Future<List<VipPlan>> vipPlans() async =>
      (await _call<List<dynamic>>('GET', '/subscriptions/plans')).map((e) => VipPlan.fromJson(e as Map<String, dynamic>)).toList();

  Future<VipStatus> syncSubscription(String productId) async =>
      VipStatus.fromJson(await _call<Map<String, dynamic>>('POST', '/subscriptions/sync', data: {'productId': productId}));

  Future<AdUsage> adUsage() async => AdUsage.fromJson(await _call<Map<String, dynamic>>('GET', '/ads/usage'));

  /// Sandbox only: reports an ad completion. With AdMob the server-side callback grants the unlock.
  Future<void> unlockWithAd(String episodeId) => _call<dynamic>('POST', '/episodes/$episodeId/unlock-with-ad', data: {});

  Future<RewardsSummary> rewards() async => RewardsSummary.fromJson(await _call<Map<String, dynamic>>('GET', '/rewards'));

  /// Returns {coins, streak, balance}.
  Future<Map<String, dynamic>> checkIn() => _call<Map<String, dynamic>>('POST', '/rewards/check-in', data: {});

  /// Returns {coins, balance}; coins is 0 when the task was already rewarded.
  Future<Map<String, dynamic>> completeTask(String taskKey) =>
      _call<Map<String, dynamic>>('POST', '/rewards/tasks', data: {'taskKey': taskKey});

  Future<void> registerPushToken(String token, String platform) =>
      _call<dynamic>('POST', '/me/push-token', data: {'token': token, 'platform': platform});

  Future<List<CoinPack>> coinPacks() async =>
      (await _call<List<dynamic>>('GET', '/coin-packs')).map((e) => CoinPack.fromJson(e as Map<String, dynamic>)).toList();

  /// Returns the new coin balance.
  Future<int> creditPurchase({required String platform, required String productId, required String transactionId}) async {
    final j = await _call<Map<String, dynamic>>('POST', '/wallet/purchases',
        data: {'platform': platform, 'productId': productId, 'transactionId': transactionId});
    return j['balance'] as int;
  }

  Future<void> saveProgress(String seriesId, int episodeNumber, int positionSec) =>
      _call<dynamic>('PUT', '/progress',
          data: {'seriesId': seriesId, 'episodeNumber': episodeNumber, 'positionSec': positionSec});

  Future<List<ContinueItem>> continueWatching() async => (await _call<List<dynamic>>('GET', '/me/continue-watching'))
      .map((e) => ContinueItem.fromJson(e as Map<String, dynamic>))
      .toList();

  Future<void> sendEvents(List<Map<String, dynamic>> events) => _call<dynamic>('POST', '/events', data: {'events': events});
}
