import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:purchases_flutter/purchases_flutter.dart';
import 'package:uuid/uuid.dart';

import '../config.dart';

class StorePurchase {
  final String platform;
  final String productId;
  final String transactionId;
  StorePurchase(this.platform, this.productId, this.transactionId);

  Map<String, String> toJson() => {'platform': platform, 'productId': productId, 'transactionId': transactionId};
  factory StorePurchase.fromJson(Map<String, dynamic> j) =>
      StorePurchase(j['platform'] as String, j['productId'] as String, j['transactionId'] as String);
}

String get _platform => defaultTargetPlatform == TargetPlatform.iOS ? 'ios' : 'android';

/// Buys consumable coin packs from the App Store / Google Play.
abstract class CoinStore {
  static CoinStore create() {
    final key = defaultTargetPlatform == TargetPlatform.iOS ? AppConfig.revenueCatAppleKey : AppConfig.revenueCatGoogleKey;
    return key.isEmpty ? SandboxCoinStore() : RevenueCatCoinStore(key);
  }

  Future<void> init(String userId);

  /// Localized store prices by product id (falls back to the backend's price label when missing).
  Future<Map<String, String>> prices(List<String> productIds);

  /// Returns null if the user cancelled.
  Future<StorePurchase?> buy(String productId);

  /// Buys an auto-renewing VIP plan. Returns false if the user cancelled.
  Future<bool> subscribe(String productId);

  /// Restores previous purchases; returns the product ids of active subscriptions.
  Future<List<String>> restore();
}

/// Real purchases through RevenueCat. The backend verifies each transaction with RevenueCat.
class RevenueCatCoinStore implements CoinStore {
  final String apiKey;
  final Map<String, StoreProduct> _products = {};
  RevenueCatCoinStore(this.apiKey);

  @override
  Future<void> init(String userId) async {
    // appUserID must equal our backend user id: the server looks purchases up by it.
    await Purchases.configure(PurchasesConfiguration(apiKey)..appUserID = userId);
  }

  @override
  Future<Map<String, String>> prices(List<String> productIds) async {
    final products = await Purchases.getProducts(productIds, productCategory: ProductCategory.nonSubscription);
    for (final p in products) {
      _products[p.identifier] = p;
    }
    return {for (final p in products) p.identifier: p.priceString};
  }

  Future<StoreProduct?> _subscriptionProduct(String productId) async {
    final products = await Purchases.getProducts([productId], productCategory: ProductCategory.subscription);
    return products.isEmpty ? null : products.first;
  }

  @override
  Future<bool> subscribe(String productId) async {
    final product = await _subscriptionProduct(productId);
    if (product == null) throw StateError('Plan $productId is not available in the store');
    try {
      await Purchases.purchase(PurchaseParams.storeProduct(product));
      return true;
    } on PlatformException catch (e) {
      if (PurchasesErrorHelper.getErrorCode(e) == PurchasesErrorCode.purchaseCancelledError) return false;
      rethrow;
    }
  }

  @override
  Future<List<String>> restore() async {
    final info = await Purchases.restorePurchases();
    return info.activeSubscriptions;
  }

  @override
  Future<StorePurchase?> buy(String productId) async {
    var product = _products[productId];
    if (product == null) {
      await prices([productId]);
      product = _products[productId];
    }
    if (product == null) throw StateError('Product $productId is not available in the store');
    try {
      final result = await Purchases.purchase(PurchaseParams.storeProduct(product));
      return StorePurchase(_platform, productId, result.storeTransaction.transactionIdentifier);
    } on PlatformException catch (e) {
      if (PurchasesErrorHelper.getErrorCode(e) == PurchasesErrorCode.purchaseCancelledError) return null;
      rethrow;
    }
  }
}

/// Development store: no real payment. Only works when the backend runs PURCHASE_VERIFIER=sandbox.
class SandboxCoinStore implements CoinStore {
  @override
  Future<void> init(String userId) async {}

  @override
  Future<Map<String, String>> prices(List<String> productIds) async => {};

  @override
  Future<StorePurchase?> buy(String productId) async =>
      StorePurchase(_platform, productId, 'sandbox-${const Uuid().v4()}');

  @override
  Future<bool> subscribe(String productId) async => true;

  @override
  Future<List<String>> restore() async => [];
}

/// Persists store purchases until the backend has credited them, so coins are never lost
/// if the app is killed or offline between paying and crediting.
class PendingPurchases {
  static const _key = 'pending_purchases';
  final FlutterSecureStorage _storage;
  PendingPurchases(this._storage);

  Future<List<StorePurchase>> load() async {
    final raw = await _storage.read(key: _key);
    if (raw == null) return [];
    return (jsonDecode(raw) as List).map((e) => StorePurchase.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<void> add(StorePurchase p) async {
    final list = await load();
    list.add(p);
    await _save(list);
  }

  Future<void> remove(String transactionId) async {
    final list = await load();
    list.removeWhere((p) => p.transactionId == transactionId);
    await _save(list);
  }

  Future<void> _save(List<StorePurchase> list) =>
      _storage.write(key: _key, value: jsonEncode(list.map((p) => p.toJson()).toList()));
}
