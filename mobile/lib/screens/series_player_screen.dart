import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart';
import '../api/models.dart';
import '../services/session.dart';
import '../widgets/episode_player.dart';
import '../widgets/paywall_sheet.dart';

/// Watch a series: swipe up for the next episode. Locked episodes show the paywall.
class SeriesPlayerScreen extends StatefulWidget {
  final String seriesId;
  final int? startEpisode;
  const SeriesPlayerScreen({super.key, required this.seriesId, this.startEpisode});

  @override
  State<SeriesPlayerScreen> createState() => _SeriesPlayerScreenState();
}

class _SeriesPlayerScreenState extends State<SeriesPlayerScreen> {
  SeriesDetail? _detail;
  Object? _error;
  PageController? _pages;
  int _current = 0;
  int _initialIndex = 0;
  final Map<String, Future<Playback>> _playbacks = {};

  Session get _session => context.read<Session>();

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = await _session.api.seriesDetail(widget.seriesId);
      final startNo = widget.startEpisode ?? d.resumeEpisode ?? 1;
      _initialIndex = d.episodes.indexWhere((e) => e.number == startNo).clamp(0, d.episodes.length - 1);
      setState(() {
        _detail = d;
        _current = _initialIndex;
        _pages = PageController(initialPage: _initialIndex);
      });
      WidgetsBinding.instance.addPostFrameCallback((_) => _onEpisodeShown(_initialIndex));
    } catch (e) {
      setState(() => _error = e);
    }
  }

  /// Cached per episode; a failed request is evicted so "retry" fetches again.
  Future<Playback> _playback(EpisodeInfo ep) => _playbacks.putIfAbsent(ep.id, () {
        final f = _session.api.playback(ep.id);
        unawaited(f.then<void>((_) {}, onError: (Object _) => _playbacks.remove(ep.id)));
        return f;
      });

  void _onEpisodeShown(int index) {
    final d = _detail!;
    final ep = d.episodes[index];
    if (ep.locked) {
      _askUnlock(ep);
    } else {
      _session.analytics.track('ep_start', {'seriesId': d.series.id, 'ep': ep.number});
      _session.api.saveProgress(d.series.id, ep.number, 0).ignore();
    }
  }

  Future<void> _askUnlock(EpisodeInfo ep) async {
    final ok = await showPaywall(context, episode: ep, price: _detail!.series.coinsPerEpisode);
    if (ok && mounted) {
      setState(() => ep.locked = false);
      _onEpisodeShown(_detail!.episodes.indexOf(ep));
    }
  }

  void _next() {
    final d = _detail!;
    if (_current < d.episodes.length - 1) {
      _pages!.nextPage(duration: const Duration(milliseconds: 350), curve: Curves.easeOut);
    }
  }

  void _showEpisodes() {
    final d = _detail!;
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: const Color(0xFF16161D),
      builder: (ctx) => Padding(
        padding: const EdgeInsets.all(16),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(d.series.title, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          Text('${d.series.freeEpisodes} free · ${d.series.coinsPerEpisode} coins per episode',
              style: const TextStyle(color: Colors.white60)),
          const SizedBox(height: 12),
          Flexible(
            child: GridView.count(
              crossAxisCount: 6,
              shrinkWrap: true,
              mainAxisSpacing: 8,
              crossAxisSpacing: 8,
              children: [
                for (final (i, ep) in d.episodes.indexed)
                  Material(
                    color: i == _current ? Theme.of(context).colorScheme.primary : Colors.white10,
                    borderRadius: BorderRadius.circular(8),
                    child: InkWell(
                      borderRadius: BorderRadius.circular(8),
                      onTap: () {
                        Navigator.pop(ctx);
                        _pages!.jumpToPage(i);
                      },
                      child: Stack(children: [
                        Center(child: Text('${ep.number}', style: const TextStyle(fontWeight: FontWeight.w600))),
                        if (ep.locked)
                          const Positioned(right: 3, top: 3, child: Icon(Icons.lock, size: 12, color: Colors.white70)),
                      ]),
                    ),
                  ),
              ],
            ),
          ),
        ]),
      ),
    );
  }

  @override
  void dispose() {
    _pages?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final d = _detail;
    return Scaffold(
      backgroundColor: Colors.black,
      body: _error != null
          ? Center(child: Text(_error is ApiException ? (_error as ApiException).message : 'Something went wrong'))
          : d == null
              ? const Center(child: CircularProgressIndicator())
              : Stack(children: [
                  PageView.builder(
                    controller: _pages,
                    scrollDirection: Axis.vertical,
                    allowImplicitScrolling: true, // pre-builds the next episode so it starts instantly
                    itemCount: d.episodes.length,
                    onPageChanged: (i) {
                      setState(() => _current = i);
                      _onEpisodeShown(i);
                    },
                    itemBuilder: (_, i) => _buildEpisode(d, i),
                  ),
                  SafeArea(
                    child: Row(children: [
                      IconButton(icon: const Icon(Icons.arrow_back), onPressed: () => Navigator.pop(context)),
                      Expanded(
                        child: Text('${d.series.title} · EP ${d.episodes[_current].number}/${d.episodes.length}',
                            maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600)),
                      ),
                      IconButton(icon: const Icon(Icons.format_list_numbered), onPressed: _showEpisodes),
                    ]),
                  ),
                ]),
    );
  }

  Widget _buildEpisode(SeriesDetail d, int i) {
    final ep = d.episodes[i];
    if (ep.locked) {
      return Stack(fit: StackFit.expand, children: [
        Image.network(d.series.coverUrl, fit: BoxFit.cover, color: Colors.black54, colorBlendMode: BlendMode.darken),
        Center(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Icon(Icons.lock_rounded, size: 56),
            const SizedBox(height: 12),
            Text('Episode ${ep.number} is locked', style: const TextStyle(fontSize: 18)),
            const SizedBox(height: 16),
            FilledButton(onPressed: () => _askUnlock(ep), child: Text('Unlock · ${d.series.coinsPerEpisode} coins')),
          ]),
        ),
      ]);
    }
    return FutureBuilder<Playback>(
      future: _playback(ep),
      builder: (context, snap) {
        if (snap.hasError) {
          return Center(
            child: TextButton(onPressed: () => setState(() {}), child: const Text('Could not load episode. Tap to retry')),
          );
        }
        if (!snap.hasData) return const Center(child: CircularProgressIndicator());
        final resume = i == _initialIndex && d.resumeEpisode == ep.number ? Duration(seconds: d.resumePositionSec) : Duration.zero;
        return EpisodePlayer(
          key: ValueKey(ep.id),
          playback: snap.data!,
          active: i == _current,
          startAt: resume,
          captionLang: _session.api.locale,
          // Only the on-screen episode records progress, so a page being swiped away
          // can't overwrite the newer position of the episode that replaced it.
          onProgress: (pos) {
            if (i == _current) _session.api.saveProgress(d.series.id, ep.number, pos.inSeconds).ignore();
          },
          onCompleted: () {
            _session.analytics.track('ep_complete', {'seriesId': d.series.id, 'ep': ep.number});
            _next();
          },
        );
      },
    );
  }
}
