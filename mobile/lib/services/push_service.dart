import 'dart:async';
import 'dart:io';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import '../config.dart';

/// Where a tapped notification should take the user.
class PushTarget {
  final String seriesId;
  final int? episode;
  PushTarget(this.seriesId, this.episode);

  static PushTarget? fromData(Map<String, dynamic> data) {
    final seriesId = data['seriesId'];
    if (seriesId is! String || seriesId.isEmpty) return null;
    return PushTarget(seriesId, int.tryParse('${data['episode'] ?? ''}'));
  }
}

/// Firebase Cloud Messaging wrapper. Does nothing unless Firebase is configured (see AppConfig).
class PushService {
  final _targets = StreamController<PushTarget>.broadcast();
  bool _ready = false;

  bool get available => !kIsWeb && AppConfig.pushConfigured;

  /// Emits when the user taps a notification that points at a series.
  Stream<PushTarget> get onOpen => _targets.stream;

  Future<void> init() async {
    if (!available) return;
    await Firebase.initializeApp(
      options: const FirebaseOptions(
        apiKey: AppConfig.firebaseApiKey,
        appId: AppConfig.firebaseAppId,
        messagingSenderId: AppConfig.firebaseSenderId,
        projectId: AppConfig.firebaseProjectId,
      ),
    );
    _ready = true;
    FirebaseMessaging.onMessageOpenedApp.listen((m) {
      final t = PushTarget.fromData(m.data);
      if (t != null) _targets.add(t);
    });
    final initial = await FirebaseMessaging.instance.getInitialMessage();
    final t = initial == null ? null : PushTarget.fromData(initial.data);
    if (t != null) _targets.add(t);
  }

  /// Asks for permission (iOS) and returns the device token, or null when unavailable / denied.
  Future<String?> enable() async {
    if (!_ready) return null;
    final settings = await FirebaseMessaging.instance.requestPermission();
    if (settings.authorizationStatus == AuthorizationStatus.denied) return null;
    // getToken() is the FCM registration token our backend sends to (FCM HTTP v1 `message.token`).
    // The newer register()/onRegistered API returns a Firebase Installation ID for direct-send instead.
    // ignore: deprecated_member_use
    return FirebaseMessaging.instance.getToken();
  }

  // ignore: deprecated_member_use
  Stream<String> get onTokenRefresh => _ready ? FirebaseMessaging.instance.onTokenRefresh : const Stream.empty();

  String get platform => Platform.isIOS ? 'ios' : 'android';
}
