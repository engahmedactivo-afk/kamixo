import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart';
import '../api/models.dart';
import '../services/session.dart';
import 'coin_packs_grid.dart';
import 'vip_plans.dart';

/// Shows the unlock paywall for a locked episode. Resolves to true once it is unlocked.
Future<bool> showPaywall(BuildContext context, {required EpisodeInfo episode, required int price}) async {
  final session = context.read<Session>();
  session.analytics.track('paywall_view', {
    'episodeId': episode.id,
    'ep': episode.number,
    'price': price,
    'variant': session.config.variants['paywall_copy'],
  });
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
  late bool _showVip;

  @override
  void initState() {
    super.initState();
    _showVip = context.read<Session>().config.paywallPrimary == 'vip';
  }

  Future<void> _unlock() async {
    final session = context.read<Session>();
    setState(() => _busy = true);
    try {
      session.setBalance(await session.api.unlock(widget.episode.id));
      session.analytics.track('unlock', {'episodeId': widget.episode.id, 'method': 'coins'});
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (e.code == 'INSUFFICIENT_COINS') await session.refresh();
      _toast(e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _watchAd() async {
    final session = context.read<Session>();
    setState(() => _busy = true);
    try {
      if (await session.unlockWithAd(context, widget.episode.id)) {
        if (mounted) Navigator.pop(context, true);
      }
    } on ApiException catch (e) {
      _toast(e.code == 'AD_LIMIT_REACHED' ? 'Daily ad limit reached' : e.message);
      await session.refresh();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _toast(String msg) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    final balance = session.balance;
    final enough = balance >= widget.price;
    final urgency = session.config.variants['paywall_copy'] == 'urgency';
    final adsLeft = session.adUsage.remainingToday;
    final bonus = !session.hasPurchased ? session.config.firstPurchaseBonusPct : 0;
    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(urgency ? 'Don’t stop now — Episode ${widget.episode.number} awaits' : 'Unlock Episode ${widget.episode.number}',
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
            ),
          if (adsLeft > 0) ...[
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: _busy ? null : _watchAd,
              style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48), foregroundColor: Colors.white),
              icon: const Icon(Icons.ondemand_video),
              label: Text('Watch an ad to unlock ($adsLeft left today)'),
            ),
          ],
          const SizedBox(height: 16),
          SegmentedButton<bool>(
            segments: const [
              ButtonSegment(value: false, label: Text('Buy coins')),
              ButtonSegment(value: true, label: Text('Go VIP')),
            ],
            selected: {_showVip},
            onSelectionChanged: (s) => setState(() => _showVip = s.first),
          ),
          const SizedBox(height: 12),
          if (_showVip)
            VipPlans(onSubscribed: () => Navigator.pop(context, true))
          else ...[
            if (bonus > 0)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text('🎁 First purchase bonus: +$bonus% coins',
                    textAlign: TextAlign.center, style: TextStyle(color: Theme.of(context).colorScheme.primary)),
              ),
            CoinPacksGrid(onPurchased: () {
              if (context.read<Session>().balance >= widget.price) _unlock();
            }),
          ],
        ]),
      ),
    );
  }
}
