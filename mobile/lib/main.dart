import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'screens/home_shell.dart';
import 'services/session.dart';

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

  @override
  void initState() {
    super.initState();
    _start = context.read<Session>().start();
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
                  onPressed: () => setState(() => _start = context.read<Session>().start()),
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
