import 'dart:async';
import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'screens/home_shell.dart';
import 'screens/series_player_screen.dart';
import 'services/deep_links.dart';
import 'services/session.dart';

final navigatorKey = GlobalKey<NavigatorState>();

void openSeries(String seriesId, {int? episode}) {
  navigatorKey.currentState?.push(MaterialPageRoute<void>(
    builder: (_) => SeriesPlayerScreen(seriesId: seriesId, startEpisode: episode),
  ));
}

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  final locale = PlatformDispatcher.instance.locale.languageCode;
  runApp(ChangeNotifierProvider(create: (_) => Session(locale: locale), child: const KamixoApp()));
}

class KamixoApp extends StatelessWidget {
  const KamixoApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Kamixo',
      navigatorKey: navigatorKey,
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFFFF3D71), brightness: Brightness.dark),
        scaffoldBackgroundColor: Colors.black,
      ),
      home: const StartupGate(),
    );
  }
}

/// Signs in as a guest before showing the app.
class StartupGate extends StatefulWidget {
  const StartupGate({super.key});

  @override
  State<StartupGate> createState() => _StartupGateState();
}

class _StartupGateState extends State<StartupGate> {
  late Future<void> _start;
  final _links = DeepLinks();
  StreamSubscription<SeriesLink>? _linkSub;
  StreamSubscription<dynamic>? _pushSub;

  @override
  void initState() {
    super.initState();
    _start = _boot();
  }

  Future<void> _boot() async {
    final session = context.read<Session>();
    await session.start();
    // Links from ads / shares and taps on push notifications open the series directly.
    _linkSub = _links.stream.listen((l) => openSeries(l.seriesId, episode: l.episode));
    _pushSub = session.push.onOpen.listen((t) => openSeries(t.seriesId, episode: t.episode));
  }

  @override
  void dispose() {
    _linkSub?.cancel();
    _pushSub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<void>(
      future: _start,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const Scaffold(body: Center(child: CircularProgressIndicator()));
        }
        if (snap.hasError) {
          return Scaffold(
            body: Center(
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                const Text('Could not connect'),
                const SizedBox(height: 12),
                FilledButton(
                  onPressed: () => setState(() => _start = _boot()),
                  child: const Text('Retry'),
                ),
              ]),
            ),
          );
        }
        return const HomeShell();
      },
    );
  }
}
