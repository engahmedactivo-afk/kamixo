import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/models.dart';
import '../services/session.dart';
import '../widgets/series_card.dart';
import 'series_player_screen.dart';

/// Continue watching. Reloads every time the tab becomes visible.
class MyListScreen extends StatefulWidget {
  final bool visible;
  const MyListScreen({super.key, required this.visible});

  @override
  State<MyListScreen> createState() => _MyListScreenState();
}

class _MyListScreenState extends State<MyListScreen> {
  Future<List<ContinueItem>>? _future;

  @override
  void didUpdateWidget(MyListScreen old) {
    super.didUpdateWidget(old);
    if (widget.visible && !old.visible) _reload();
  }

  @override
  void initState() {
    super.initState();
    if (widget.visible) _reload();
  }

  void _reload() => setState(() => _future = context.read<Session>().api.continueWatching());

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: FutureBuilder<List<ContinueItem>>(
        future: _future,
        builder: (context, snap) {
          if (snap.hasError) return Center(child: TextButton(onPressed: _reload, child: const Text('Tap to retry')));
          if (!snap.hasData) return const Center(child: CircularProgressIndicator());
          final items = snap.data!;
          if (items.isEmpty) return const Center(child: Text('Dramas you start watching will appear here'));
          return RefreshIndicator(
            onRefresh: () async => _reload(),
            child: GridView.builder(
              padding: const EdgeInsets.all(16),
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: 3, mainAxisSpacing: 12, crossAxisSpacing: 10, childAspectRatio: 0.45),
              itemCount: items.length,
              itemBuilder: (_, i) {
                final it = items[i];
                return SeriesCard(
                  title: it.title,
                  coverUrl: it.coverUrl,
                  subtitle: 'EP ${it.episodeNumber}/${it.totalEpisodes}',
                  onTap: () async {
                    await Navigator.of(context)
                        .push(MaterialPageRoute<void>(builder: (_) => SeriesPlayerScreen(seriesId: it.seriesId)));
                    if (mounted) _reload();
                  },
                );
              },
            ),
          );
        },
      ),
    );
  }
}
