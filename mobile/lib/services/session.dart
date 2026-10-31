import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:uuid/uuid.dart';

import '../api/api_client.dart';
import '../config.dart';
import 'analytics.dart';
import 'coin_store.dart';

/// App-wide state: the API client, the signed-in guest, and the coin balance.
class Session extends ChangeNotifier {
  static const _deviceKey = 'device_id';
  final FlutterSecureStorage _storage;
  late final ApiClient api;
  late final Analytics analytics;
  late final CoinStore store;
  late final PendingPurchases _pending;

  int balance = 0;

  Session({FlutterSecureStorage? storage, String locale = 'en'}) : _storage = storage ?? const FlutterSecureStorage() {
    api = ApiClient(baseUrl: AppConfig.apiBaseUrl, deviceId: _deviceId, locale: locale);
    analytics = Analytics(api);
    store = CoinStore.create();
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
    await refreshBalance();
  }

  Future<void> refreshBalance() async {
    balance = await api.balance();
    notifyListeners();
  }

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
    analytics.track('purchase', {'productId': productId});
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
