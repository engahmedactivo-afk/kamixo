import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/coin_store.dart';
import '../services/session.dart';
import '../widgets/coin_packs_grid.dart';

class WalletScreen extends StatelessWidget {
  const WalletScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    return SafeArea(
      child: RefreshIndicator(
        onRefresh: session.refreshBalance,
        child: ListView(padding: const EdgeInsets.all(16), children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Row(children: [
                const Icon(Icons.monetization_on_rounded, size: 40, color: Colors.amber),
                const SizedBox(width: 12),
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const Text('My coins', style: TextStyle(color: Colors.white60)),
                  Text('${session.balance}', style: const TextStyle(fontSize: 28, fontWeight: FontWeight.bold)),
                ]),
              ]),
            ),
          ),
          if (session.store is SandboxCoinStore)
            const Padding(
              padding: EdgeInsets.only(top: 8),
              child: Text('Sandbox store: purchases are free test transactions.',
                  style: TextStyle(color: Colors.orangeAccent, fontSize: 12)),
            ),
          const SizedBox(height: 20),
          const Text('Top up', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 12),
          const CoinPacksGrid(),
        ]),
      ),
    );
  }
}
