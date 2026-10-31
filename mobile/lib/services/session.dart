import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:uuid/uuid.dart';

import '../api/api_client.dart';
import '../api/models.dart';
import '../config.dart';
import 'ads_service.dart';
import 'analytics.dart';
import 'coin_store.dart';
import 'push_service.dart';

/// App-wide state: the API client, the signed-in guest, coins, VIP and ad allowance.
class Session extends ChangeNotifier {
  static const _deviceKey = 'device_id';
  final FlutterSecureStorage _storage;
  late final ApiClient api;
  late final Analytics analytics;
  late final CoinStore store;
  late final AdsService ads;
  late final PushService push;
  late final PendingPurchases _pending;

  int balance = 0;
  VipStatus vip = const VipStatus.none();
  AdUsage adUsage = const AdUsage.unknown();
  RemoteConfig config = const RemoteConfig.defaults();
  bool hasPurchased = false;

  Session({FlutterSecureStorage? storage, String locale = 'en'}) : _storage = storage ?? const FlutterSecureStorage() {
    api = ApiClient(baseUrl: AppConfig.apiBaseUrl, deviceId: _deviceId, locale: locale);
    analytics = Analytics(api);
    store = CoinStore.create();
    ads = AdsService.create();
    push = PushService();
    _pending = PendingPurchases(_storage);
  }

  /// The device id is the guest credential; generated once and kept in secure storage.
  Future<String> _deviceId() async {
    var id = await _storage.read(key: _deviceKey);
    if (id == null) {
      id = const Uuid().v4();
      await _storage.write(key: _deviceKey, value: id);
    }
    return id;
  }

  Future<void> start() async {
    await api.login();
    await store.init(api.userId!);
    await _retryPendingPurchases();
    await refresh();
    // Non-critical integrations must never block startup.
    unawaited(ads.init().catchError((Object e) => debugPrint('Ads init failed: $e')));
    unawaited(_initPush());
    config = await api.config().catchError((Object _) => const RemoteConfig.defaults());
    // Experiment variants ride along with every event, so dashboards can split by variant.
    analytics.track('session_start', {'variants': config.variants});
    notifyListeners();
  }

  Future<void> _initPush() async {
    try {
      await push.init();
      push.onTokenRefresh.listen((t) => api.registerPushToken(t, push.platform).ignore());
    } catch (e) {
      debugPrint('Push init failed: $e');
    }
  }

  /// Reloads balance, VIP status and the ad allowance in one request.
  Future<void> refresh() async {
    final me = await api.me();
    balance = me.balance;
    vip = me.vip;
    adUsage = me.ads;
    hasPurchased = me.hasPurchased;
    notifyListeners();
  }

  /// Kept for callers that only know the new balance (unlock / purchase responses).
  Future<void> refreshBalance() => refresh();

  void setBalance(int value) {
    balance = value;
    notifyListeners();
  }

  /// Runs the store purchase, then credits it on the backend. Returns false if cancelled.
  Future<bool> buyCoins(String productId) async {
    final purchase = await store.buy(productId);
    if (purchase == null) return false;
    await _pending.add(purchase);
    await _credit(purchase);
    hasPurchased = true;
    analytics.track('purchase', {'productId': productId});
    return true;
  }

  /// Buys a VIP plan through the store and syncs it to the backend. Returns false if cancelled.
  Future<bool> buyVip(String productId) async {
    if (!await store.subscribe(productId)) return false;
    vip = await api.syncSubscription(productId);
    analytics.track('subscribe', {'productId': productId});
    notifyListeners();
    return true;
  }

  /// "Restore purchases" (required by Apple). Returns true if a VIP plan was restored.
  Future<bool> restoreVip() async {
    for (final productId in await store.restore()) {
      try {
        vip = await api.syncSubscription(productId);
        if (vip.active) {
          notifyListeners();
          return true;
        }
      } on ApiException {
        // not one of our plans, keep looking
      }
    }
    return false;
  }

  /// Shows a rewarded ad for [episodeId]. Returns true when the episode is unlocked afterwards.
  Future<bool> unlockWithAd(BuildContext context, String episodeId) async {
    final earned = await ads.showRewarded(context, userId: api.userId!, episodeId: episodeId);
    if (!earned) return false;
    if (ads.sandbox) {
      await api.unlockWithAd(episodeId);
    } else {
      // AdMob's server-side callback grants the unlock; give it a moment to land.
      for (var attempt = 0; attempt < 6; attempt++) {
        await Future<void>.delayed(const Duration(milliseconds: 500));
        try {
          await api.playback(episodeId);
          break;
        } on ApiException catch (e) {
          if (e.code != 'EPISODE_LOCKED' || attempt == 5) rethrow;
        }
      }
    }
    analytics.track('unlock', {'episodeId': episodeId, 'method': 'ad'});
    adUsage = await api.adUsage();
    notifyListeners();
    return true;
  }

  /// Daily check-in; returns the coins earned.
  Future<int> checkIn() async {
    final r = await api.checkIn();
    setBalance(r['balance'] as int);
    analytics.track('check_in', {'streak': r['streak']});
    return r['coins'] as int;
  }

  /// Completes a reward task; returns the coins earned (0 if already done).
  Future<int> completeTask(String key) async {
    final r = await api.completeTask(key);
    setBalance(r['balance'] as int);
    return r['coins'] as int;
  }

  /// Turns on push notifications and registers the device. Returns false if unavailable or denied.
  Future<bool> enablePush() async {
    final token = await push.enable();
    if (token == null) return false;
    await api.registerPushToken(token, push.platform);
    return true;
  }

  Future<void> _credit(StorePurchase p) async {
    setBalance(await api.creditPurchase(platform: p.platform, productId: p.productId, transactionId: p.transactionId));
    await _pending.remove(p.transactionId);
  }

  Future<void> _retryPendingPurchases() async {
    for (final p in await _pending.load()) {
      try {
        await _credit(p);
      } on ApiException catch (e) {
        // Permanently rejected receipts are dropped; network errors are retried next launch.
        if (e.status >= 400 && e.status < 500) await _pending.remove(p.transactionId);
      }
    }
  }

  @override
  void dispose() {
    analytics.dispose();
    super.dispose();
  }
}
