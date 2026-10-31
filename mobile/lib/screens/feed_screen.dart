import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/models.dart';
import '../services/session.dart';
import '../widgets/episode_player.dart';
import 'series_player_screen.dart';

/// "For You": full-screen swipe feed of series, autoplaying episode 1.
class FeedScreen extends StatefulWidget {
  final bool visible;
  const FeedScreen({super.key, required this.visible});

  @override
  State<FeedScreen> createState() => _FeedScreenState();
}

class _FeedScreenState extends State<FeedScreen> {
  final List<FeedItem> _items = [];
  int? _nextOffset = 0;
  bool _loading = false;
  bool _covered = false; // a pushed route is on top of the feed
  Object? _error;
  int _current = 0;

  @override
  void initState() {
    super.initState();
    _loadMore();
  }

  Future<void> _loadMore() async {
    if (_loading || _nextOffset == null) return;
    setState(() => _loading = true);
    try {
      final page = await context.read<Session>().api.feed(offset: _nextOffset!);
      setState(() {
        _items.addAll(page.items);
        _nextOffset = page.nextOffset;
        _error = null;
      });
      if (_items.isNotEmpty && _items.length == page.items.length) _trackView(0);
    } catch (e) {
      setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _trackView(int i) =>
      context.read<Session>().analytics.track('feed_view', {'seriesId': _items[i].series.id, 'position': i});

  Future<void> _openSeries(FeedItem item) async {
    setState(() => _covered = true);
    await Navigator.of(context).push(MaterialPageRoute<void>(
      builder: (_) => SeriesPlayerScreen(seriesId: item.series.id),
    ));
    if (mounted) setState(() => _covered = false);
  }

  @override
  Widget build(BuildContext context) {
    if (_items.isEmpty) {
      if (_error != null) {
        return Center(child: TextButton(onPressed: _loadMore, child: const Text('Could not load. Tap to retry')));
      }
      if (_loading) return const Center(child: CircularProgressIndicator());
      return const Center(child: Text('No dramas yet'));
    }
    return PageView.builder(
      scrollDirection: Axis.vertical,
      allowImplicitScrolling: true,
      itemCount: _items.length,
      onPageChanged: (i) {
        setState(() => _current = i);
        _trackView(i);
        if (i >= _items.length - 3) _loadMore();
      },
      itemBuilder: (context, i) {
        final item = _items[i];
        return Stack(fit: StackFit.expand, children: [
          EpisodePlayer(
            key: ValueKey(item.episodeId),
            playback: item.playback,
            active: i == _current && widget.visible && !_covered,
            loop: true,
            captionLang: context.read<Session>().api.locale,
          ),
          const IgnorePointer(
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [Colors.transparent, Colors.transparent, Colors.black87],
                  stops: [0, 0.55, 1],
                ),
              ),
            ),
          ),
          Positioned(
            left: 16,
            right: 16,
            bottom: 20,
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(item.series.title, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
              const SizedBox(height: 4),
              Wrap(spacing: 6, children: [
                for (final g in item.series.genres)
                  Chip(label: Text(g), visualDensity: VisualDensity.compact, padding: EdgeInsets.zero),
              ]),
              Text(item.series.description, maxLines: 2, overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: Colors.white70)),
              const SizedBox(height: 12),
              FilledButton.icon(
                onPressed: () => _openSeries(item),
                icon: const Icon(Icons.play_arrow_rounded),
                label: Text('Watch full series · ${item.series.totalEpisodes} episodes'),
                style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(46)),
              ),
            ]),
          ),
        ]);
      },
    );
  }
}
