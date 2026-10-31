import 'dart:async';

import '../api/api_client.dart';

/// Batches funnel events (feed_view, ep_start, ep_complete, paywall_view, purchase, unlock)
/// and sends them to the backend every few seconds.
class Analytics {
  final ApiClient _api;
  final List<Map<String, dynamic>> _queue = [];
  Timer? _timer;

  Analytics(this._api) {
    _timer = Timer.periodic(const Duration(seconds: 10), (_) => flush());
  }

  void track(String name, [Map<String, dynamic> props = const {}]) {
    _queue.add({'name': name, 'props': props, 'ts': DateTime.now().toUtc().toIso8601String()});
    if (_queue.length >= 20) flush();
  }

  Future<void> flush() async {
    if (_queue.isEmpty) return;
    final batch = List<Map<String, dynamic>>.from(_queue.take(100));
    _queue.removeRange(0, batch.length);
    try {
      await _api.sendEvents(batch);
    } catch (_) {
      // Keep events for the next attempt, but never grow without bound.
      if (_queue.length < 500) _queue.insertAll(0, batch);
    }
  }

  void dispose() => _timer?.cancel();
}
