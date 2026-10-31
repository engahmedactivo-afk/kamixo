import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:google_mobile_ads/google_mobile_ads.dart';

import '../config.dart';

/// Shows a rewarded ad. Resolves true once the user has earned the reward.
abstract class AdsService {
  static AdsService create() {
    if (kIsWeb) return SandboxAdsService();
    final unit = Platform.isIOS ? AppConfig.admobRewardedIos : AppConfig.admobRewardedAndroid;
    return unit.isEmpty ? SandboxAdsService() : AdMobAdsService(unit);
  }

  bool get sandbox;

  Future<void> init();

  /// [userId] and [episodeId] travel with AdMob's server-side verification callback.
  Future<bool> showRewarded(BuildContext context, {required String userId, required String episodeId});
}

class AdMobAdsService implements AdsService {
  final String adUnitId;
  RewardedAd? _loaded;
  AdMobAdsService(this.adUnitId);

  @override
  bool get sandbox => false;

  @override
  Future<void> init() async {
    await MobileAds.instance.initialize();
    unawaited(_preload());
  }

  Future<void> _preload() async {
    if (_loaded != null) return;
    final c = Completer<void>();
    await RewardedAd.load(
      adUnitId: adUnitId,
      request: const AdRequest(),
      rewardedAdLoadCallback: RewardedAdLoadCallback(
        onAdLoaded: (ad) {
          _loaded = ad;
          c.complete();
        },
        onAdFailedToLoad: (e) {
          debugPrint('Rewarded ad failed to load: ${e.message}');
          c.complete();
        },
      ),
    );
    return c.future;
  }

  @override
  Future<bool> showRewarded(BuildContext context, {required String userId, required String episodeId}) async {
    if (_loaded == null) await _preload();
    final ad = _loaded;
    if (ad == null) return false;
    _loaded = null;
    await ad.setServerSideOptions(ServerSideVerificationOptions(userId: userId, customData: '$userId:$episodeId'));
    final earned = Completer<bool>();
    ad.fullScreenContentCallback = FullScreenContentCallback(
      onAdDismissedFullScreenContent: (ad) {
        ad.dispose();
        if (!earned.isCompleted) earned.complete(false);
        unawaited(_preload());
      },
      onAdFailedToShowFullScreenContent: (ad, e) {
        ad.dispose();
        if (!earned.isCompleted) earned.complete(false);
      },
    );
    await ad.show(onUserEarnedReward: (_, _) {
      if (!earned.isCompleted) earned.complete(true);
    });
    return earned.future;
  }
}

/// Development stand-in: a short countdown dialog instead of a real ad.
class SandboxAdsService implements AdsService {
  @override
  bool get sandbox => true;

  @override
  Future<void> init() async {}

  @override
  Future<bool> showRewarded(BuildContext context, {required String userId, required String episodeId}) async {
    final result = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (_) => const _FakeAdDialog(),
    );
    return result ?? false;
  }
}

class _FakeAdDialog extends StatefulWidget {
  const _FakeAdDialog();

  @override
  State<_FakeAdDialog> createState() => _FakeAdDialogState();
}

class _FakeAdDialogState extends State<_FakeAdDialog> {
  int _left = 3;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) return;
      setState(() => _left--);
      if (_left <= 0) {
        t.cancel();
        Navigator.pop(context, true);
      }
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Sandbox ad'),
      content: Text('A real rewarded ad would play here.\nReward in $_left s…'),
      actions: [TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Skip'))],
    );
  }
}
