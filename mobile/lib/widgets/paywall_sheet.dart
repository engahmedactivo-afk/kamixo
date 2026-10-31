import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart';
import '../api/models.dart';
import '../services/session.dart';
import 'coin_packs_grid.dart';

/// Shows the unlock paywall for a locked episode. Resolves to true once it is unlocked.
Future<bool> showPaywall(BuildContext context, {required EpisodeInfo episode, required int price}) async {
  context.read<Session>().analytics.track('paywall_view', {'episodeId': episode.id, 'ep': episode.number, 'price': price});
  final unlocked = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    backgroundColor: const Color(0xFF16161D),
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
    builder: (_) => _PaywallSheet(episode: episode, price: price),
  );
  return unlocked ?? false;
}

class _PaywallSheet extends StatefulWidget {
  final EpisodeInfo episode;
  final int price;
  const _PaywallSheet({required this.episode, required this.price});

  @override
  State<_PaywallSheet> createState() => _PaywallSheetState();
}

class _PaywallSheetState extends State<_PaywallSheet> {
  bool _busy = false;

  Future<void> _unlock() async {
    final session = context.read<Session>();
    setState(() => _busy = true);
    try {
      session.setBalance(await session.api.unlock(widget.episode.id));
      session.analytics.track('unlock', {'episodeId': widget.episode.id, 'method': 'coins'});
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (e.code == 'INSUFFICIENT_COINS') await session.refreshBalance();
      _toast(e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _toast(String msg) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  @override
  Widget build(BuildContext context) {
    final balance = context.watch<Session>().balance;
    final enough = balance >= widget.price;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 12),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('Unlock Episode ${widget.episode.number}',
              textAlign: TextAlign.center, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          Text('Price: ${widget.price} coins  ·  Balance: $balance coins',
              textAlign: TextAlign.center, style: const TextStyle(color: Colors.white70)),
          const SizedBox(height: 16),
          if (enough)
            FilledButton(
              onPressed: _busy ? null : _unlock,
              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
              child: _busy
                  ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2))
                  : Text('Unlock for ${widget.price} coins', style: const TextStyle(fontSize: 16)),
            )
          else ...[
            const Text('Top up to keep watching', style: TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: 12),
            CoinPacksGrid(onPurchased: () {
              if (context.read<Session>().balance >= widget.price) _unlock();
            }),
          ],
        ]),
      ),
    );
  }
}
