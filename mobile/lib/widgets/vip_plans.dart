import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/models.dart';
import '../services/session.dart';

/// VIP plan buttons. Calls [onSubscribed] after a successful purchase.
class VipPlans extends StatefulWidget {
  final VoidCallback? onSubscribed;
  const VipPlans({super.key, this.onSubscribed});

  @override
  State<VipPlans> createState() => _VipPlansState();
}

class _VipPlansState extends State<VipPlans> {
  late Future<List<VipPlan>> _plans;
  String? _buying;

  @override
  void initState() {
    super.initState();
    _plans = context.read<Session>().api.vipPlans();
  }

  Future<void> _buy(VipPlan plan) async {
    final session = context.read<Session>();
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _buying = plan.productId);
    try {
      if (await session.buyVip(plan.productId)) {
        messenger.showSnackBar(const SnackBar(content: Text('Welcome to VIP! All episodes are unlocked.')));
        widget.onSubscribed?.call();
      }
    } catch (_) {
      messenger.showSnackBar(const SnackBar(content: Text('Subscription failed. Please try again.')));
    } finally {
      if (mounted) setState(() => _buying = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final primary = Theme.of(context).colorScheme.primary;
    return FutureBuilder<List<VipPlan>>(
      future: _plans,
      builder: (context, snap) {
        if (snap.hasError) return const Text('Could not load VIP plans');
        if (!snap.hasData) return const Center(child: Padding(padding: EdgeInsets.all(16), child: CircularProgressIndicator()));
        return Column(children: [
          for (final p in snap.data!)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: OutlinedButton(
                onPressed: _buying == null ? () => _buy(p) : null,
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size.fromHeight(52),
                  side: BorderSide(color: primary),
                  foregroundColor: Colors.white,
                ),
                child: _buying == p.productId
                    ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                    : Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                        Row(children: [
                          Icon(Icons.workspace_premium, color: primary, size: 20),
                          const SizedBox(width: 8),
                          Text(p.name, style: const TextStyle(fontWeight: FontWeight.w600)),
                        ]),
                        Text(p.priceLabel, style: const TextStyle(color: Colors.white70)),
                      ]),
              ),
            ),
          const Text('Unlimited episodes, no ads. Cancel anytime in your store settings.',
              style: TextStyle(fontSize: 12, color: Colors.white54), textAlign: TextAlign.center),
        ]);
      },
    );
  }
}
