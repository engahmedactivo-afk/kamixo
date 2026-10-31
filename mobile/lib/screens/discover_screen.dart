import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/models.dart';
import '../services/session.dart';
import '../widgets/series_card.dart';
import 'series_player_screen.dart';

class DiscoverScreen extends StatefulWidget {
  const DiscoverScreen({super.key});

  @override
  State<DiscoverScreen> createState() => _DiscoverScreenState();
}

class _DiscoverScreenState extends State<DiscoverScreen> {
  List<String> _genres = [];
  String? _genre;
  String _sort = 'popular';
  String _query = '';
  final List<SeriesSummary> _items = [];
  int? _nextOffset = 0;
  bool _loading = false;
  int _generation = 0; // ignores responses from outdated filters
  Timer? _debounce;

  @override
  void initState() {
    super.initState();
    context.read<Session>().api.genres().then((g) => mounted ? setState(() => _genres = g) : null).ignore();
    _reload();
  }

  void _reload() {
    _generation++;
    _items.clear();
    _nextOffset = 0;
    _loading = false;
    _loadMore();
  }

  Future<void> _loadMore() async {
    if (_loading || _nextOffset == null) return;
    final gen = _generation;
    setState(() => _loading = true);
    try {
      final page = await context.read<Session>().api.series(genre: _genre, q: _query, sort: _sort, offset: _nextOffset!);
      if (gen != _generation || !mounted) return;
      setState(() {
        _items.addAll(page.items);
        _nextOffset = page.nextOffset;
      });
    } catch (_) {
      if (mounted && gen == _generation) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not load series')));
      }
    } finally {
      if (mounted && gen == _generation) setState(() => _loading = false);
    }
  }

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
          child: TextField(
            decoration: const InputDecoration(
                prefixIcon: Icon(Icons.search), hintText: 'Search dramas', border: OutlineInputBorder(), isDense: true),
            onChanged: (v) {
              _debounce?.cancel();
              _debounce = Timer(const Duration(milliseconds: 400), () => setState(() {
                    _query = v.trim();
                    _reload();
                  }));
            },
          ),
        ),
        SizedBox(
          height: 48,
          child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 12), children: [
            for (final g in [null, ..._genres])
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 4),
                child: ChoiceChip(
                  label: Text(g ?? 'All'),
                  selected: _genre == g,
                  onSelected: (_) => setState(() {
                    _genre = g;
                    _reload();
                  }),
                ),
              ),
          ]),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: SegmentedButton<String>(
            segments: const [
              ButtonSegment(value: 'popular', label: Text('Popular')),
              ButtonSegment(value: 'new', label: Text('New')),
            ],
            selected: {_sort},
            onSelectionChanged: (s) => setState(() {
              _sort = s.first;
              _reload();
            }),
          ),
        ),
        Expanded(
          child: NotificationListener<ScrollNotification>(
            onNotification: (n) {
              if (n.metrics.extentAfter < 400) _loadMore();
              return false;
            },
            child: _items.isEmpty && !_loading
                ? const Center(child: Text('No results'))
                : GridView.builder(
                    padding: const EdgeInsets.all(16),
                    gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                        crossAxisCount: 3, mainAxisSpacing: 12, crossAxisSpacing: 10, childAspectRatio: 0.45),
                    itemCount: _items.length,
                    itemBuilder: (_, i) {
                      final s = _items[i];
                      return SeriesCard(
                        title: s.title,
                        coverUrl: s.coverUrl,
                        subtitle: '${s.totalEpisodes} episodes',
                        onTap: () => Navigator.of(context)
                            .push(MaterialPageRoute<void>(builder: (_) => SeriesPlayerScreen(seriesId: s.id))),
                      );
                    },
                  ),
          ),
        ),
      ]),
    );
  }
}
