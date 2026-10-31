import 'dart:async';

import 'package:app_links/app_links.dart';

import '../config.dart';

class SeriesLink {
  final String seriesId;
  final int? episode;
  SeriesLink(this.seriesId, this.episode);
}

/// Parses `kamixo://series/<id>?ep=N` and `https://<host>/s/<id>?ep=N`.
SeriesLink? parseSeriesLink(Uri uri) {
  final segs = uri.pathSegments.where((s) => s.isNotEmpty).toList();
  String? id;
  if (uri.scheme == AppConfig.urlScheme && uri.host == 'series' && segs.isNotEmpty) {
    id = segs.first;
  } else if ((uri.scheme == 'https' || uri.scheme == 'http') && segs.length == 2 && segs.first == 's') {
    id = segs.last;
  }
  if (id == null || !RegExp(r'^[0-9a-f-]{36}$').hasMatch(id)) return null;
  return SeriesLink(id, int.tryParse(uri.queryParameters['ep'] ?? ''));
}

/// Emits series links the app was opened with (cold start and while running).
class DeepLinks {
  final AppLinks _links = AppLinks();

  Stream<SeriesLink> get stream async* {
    final initial = await _links.getInitialLink();
    final first = initial == null ? null : parseSeriesLink(initial);
    if (first != null) yield first;
    await for (final uri in _links.uriLinkStream) {
      final link = parseSeriesLink(uri);
      if (link != null) yield link;
    }
  }
}
