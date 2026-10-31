import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';

import '../api/api_client.dart';
import '../api/models.dart';
import '../services/coin_store.dart';
import '../services/session.dart';
import '../widgets/coin_packs_grid.dart';
import '../widgets/vip_plans.dart';

/// Coins tab: balance, VIP, daily check-in, tasks and top-up.
class WalletScreen extends StatefulWidget {
  const WalletScreen({super.key});

  @override
  State<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends State<WalletScreen> {
  Future<RewardsSummary>? _rewards;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  void _reload() => setState(() => _rewards = context.read<Session>().api.rewards());

  void _toast(String msg) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));

  Future<void> _run(Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
    } on ApiException catch (e) {
      _toast(e.message);
    } catch (_) {
      _toast('Something went wrong');
    } finally {
      if (mounted) setState(() => _busy = false);
      _reload();
    }
  }

  Future<void> _checkIn() => _run(() async {
        final coins = await context.read<Session>().checkIn();
        _toast('+$coins coins! Come back tomorrow for more.');
      });

  Future<void> _task(RewardTask t) => _run(() async {
        final session = context.read<Session>();
        switch (t.key) {
          case 'enable_push':
            if (!session.push.available) {
              _toast('Notifications are not configured in this build');
              return;
            }
            if (!await session.enablePush()) {
              _toast('Notifications were not allowed');
              return;
            }
          case 'share_app':
            final url = session.config.shareBaseUrl;
            await SharePlus.instance.share(ShareParams(
              text: 'Watch addictive mini dramas on Kamixo${url.isEmpty ? '' : ' – $url'}',
              title: 'Kamixo',
            ));
          default:
            return; // other tasks are completed from where they happen (e.g. finishing a series)
        }
        final coins = await session.completeTask(t.key);
        if (coins > 0) _toast('+$coins coins!');
      });

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    final primary = Theme.of(context).colorScheme.primary;
    return SafeArea(
      child: RefreshIndicator(
        onRefresh: () async {
          await session.refresh();
          _reload();
        },
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
                const Spacer(),
                if (session.vip.active)
                  Chip(
                    avatar: Icon(Icons.workspace_premium, color: primary, size: 18),
                    label: const Text('VIP'),
                  ),
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
          const Text('Earn free coins', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 12),
          FutureBuilder<RewardsSummary>(
            future: _rewards,
            builder: (context, snap) {
              if (snap.hasError) return TextButton(onPressed: _reload, child: const Text('Could not load rewards. Tap to retry'));
              if (!snap.hasData) return const Center(child: Padding(padding: EdgeInsets.all(16), child: CircularProgressIndicator()));
              final r = snap.data!;
              return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Row(children: [
                        const Text('Daily check-in', style: TextStyle(fontWeight: FontWeight.w600)),
                        const Spacer(),
                        Text('🔥 ${r.streak} day streak', style: const TextStyle(color: Colors.white70)),
                      ]),
                      const SizedBox(height: 10),
                      Row(children: [
                        for (final (i, coins) in r.schedule.indexed)
                          Expanded(
                            child: Container(
                              margin: const EdgeInsets.symmetric(horizontal: 2),
                              padding: const EdgeInsets.symmetric(vertical: 6),
                              decoration: BoxDecoration(
                                color: i < r.streak ? primary.withValues(alpha: .25) : Colors.white10,
                                borderRadius: BorderRadius.circular(6),
                                border: i == (r.checkedInToday ? r.streak - 1 : r.streak)
                                    ? Border.all(color: primary)
                                    : null,
                              ),
                              child: Column(children: [
                                Text('D${i + 1}', style: const TextStyle(fontSize: 10, color: Colors.white60)),
                                Text('$coins', style: const TextStyle(fontWeight: FontWeight.w600)),
                              ]),
                            ),
                          ),
                      ]),
                      const SizedBox(height: 12),
                      FilledButton(
                        onPressed: r.checkedInToday || _busy ? null : _checkIn,
                        child: Text(r.checkedInToday ? 'Checked in today ✓' : 'Check in · +${r.nextReward} coins'),
                      ),
                    ]),
                  ),
                ),
                for (final t in r.tasks)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: Icon(t.done ? Icons.check_circle : Icons.circle_outlined, color: t.done ? Colors.greenAccent : null),
                    title: Text(t.title),
                    subtitle: Text('+${t.coins} coins'),
                    trailing: t.done || t.key == 'finish_first_series'
                        ? null
                        : TextButton(onPressed: _busy ? null : () => _task(t), child: const Text('Go')),
                  ),
              ]);
            },
          ),
          const SizedBox(height: 20),
          const Text('VIP', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 12),
          if (session.vip.active)
            Card(
              child: ListTile(
                leading: Icon(Icons.workspace_premium, color: primary),
                title: const Text('You are VIP'),
                subtitle: Text(session.vip.expiresAt == null
                    ? 'All episodes unlocked'
                    : '${session.vip.willRenew ? 'Renews' : 'Ends'} ${session.vip.expiresAt!.toLocal().toString().substring(0, 10)}'),
              ),
            )
          else ...[
            const VipPlans(),
            TextButton(
              onPressed: _busy
                  ? null
                  : () => _run(() async {
                        final ok = await session.restoreVip();
                        _toast(ok ? 'VIP restored' : 'No active subscription found');
                      }),
              child: const Text('Restore purchases'),
            ),
          ],
          const SizedBox(height: 20),
          const Text('Top up', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 12),
          const CoinPacksGrid(),
        ]),
      ),
    );
  }
}
