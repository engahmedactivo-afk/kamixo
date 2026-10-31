import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/models.dart';
import '../services/session.dart';

/// Coin packs from the backend, priced with the store's localized price when available.
class CoinPacksGrid extends StatefulWidget {
  final VoidCallback? onPurchased;
  const CoinPacksGrid({super.key, this.onPurchased});

  @override
  State<CoinPacksGrid> createState() => _CoinPacksGridState();
}

class _CoinPacksGridState extends State<CoinPacksGrid> {
  late Future<(List<CoinPack>, Map<String, String>)> _load;
  String? _buying;

  @override
  void initState() {
    super.initState();
    final session = context.read<Session>();
    _load = () async {
      final packs = await session.api.coinPacks();
      Map<String, String> prices = {};
      try {
        prices = await session.store.prices(packs.map((p) => p.productId).toList());
      } catch (_) {/* fall back to backend labels */}
      return (packs, prices);
    }();
  }

  Future<void> _buy(CoinPack pack) async {
    final session = context.read<Session>();
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _buying = pack.productId);
    try {
      if (await session.buyCoins(pack.productId)) {
        messenger.showSnackBar(SnackBar(content: Text('+${pack.coins + pack.bonusCoins} coins added')));
        widget.onPurchased?.call();
      }
    } catch (e) {
      messenger.showSnackBar(const SnackBar(content: Text('Purchase failed. If you were charged, coins will be added automatically.')));
    } finally {
      if (mounted) setState(() => _buying = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder(
      future: _load,
      builder: (context, snap) {
        if (snap.hasError) return const Text('Could not load coin packs');
        if (!snap.hasData) return const Center(child: Padding(padding: EdgeInsets.all(24), child: CircularProgressIndicator()));
        final (packs, prices) = snap.data!;
        return GridView.count(
          crossAxisCount: 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 10,
          crossAxisSpacing: 10,
          childAspectRatio: 1.7,
          children: [
            for (final p in packs)
              Material(
                color: Colors.white10,
                borderRadius: BorderRadius.circular(12),
                child: InkWell(
                  borderRadius: BorderRadius.circular(12),
                  onTap: _buying == null ? () => _buy(p) : null,
                  child: Center(
                    child: _buying == p.productId
                        ? const CircularProgressIndicator()
                        : Column(mainAxisSize: MainAxisSize.min, children: [
                            Text('${p.coins} coins', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                            if (p.bonusCoins > 0)
                              Text('+${p.bonusCoins} bonus',
                                  style: TextStyle(color: Theme.of(context).colorScheme.primary, fontSize: 12)),
                            const SizedBox(height: 4),
                            Text(prices[p.productId] ?? p.priceLabel, style: const TextStyle(color: Colors.white70)),
                          ]),
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}
