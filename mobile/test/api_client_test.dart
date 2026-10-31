import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:kamixo/api/api_client.dart';

/// Runs the client against a tiny local HTTP server that mimics the backend.
void main() {
  late HttpServer server;
  late ApiClient api;
  var logins = 0;
  var expireNext = false;

  setUp(() async {
    logins = 0;
    expireNext = false;
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((req) async {
      final res = req.response..headers.contentType = ContentType.json;
      final auth = req.headers.value('authorization');
      if (req.uri.path == '/auth/guest') {
        logins++;
        res.statusCode = 201;
        res.write(jsonEncode({'accessToken': 'tok$logins', 'user': {'id': 'u1', 'locale': 'en'}}));
      } else if (auth == null || (expireNext && auth == 'Bearer tok1')) {
        res.statusCode = 401;
        res.write(jsonEncode({'statusCode': 401, 'message': 'Invalid or expired token'}));
      } else if (req.uri.path.endsWith('/playback')) {
        res.write(jsonEncode({'url': 'https://x/${req.uri.queryParameters['lang'] ?? 'none'}/m.m3u8', 'subtitles': {}, 'dubs': ['es']}));
      } else if (req.uri.path == '/wallet') {
        res.write(jsonEncode({'balance': 120, 'entries': []}));
      } else if (req.uri.path.endsWith('/unlock')) {
        res.statusCode = 402;
        res.write(jsonEncode({'statusCode': 402, 'code': 'INSUFFICIENT_COINS', 'message': 'Not enough coins', 'price': 60, 'balance': 0}));
      } else {
        res.statusCode = 404;
        res.write('{}');
      }
      await res.close();
    });
    api = ApiClient(baseUrl: 'http://127.0.0.1:${server.port}', deviceId: () async => 'device-123456789012');
  });

  tearDown(() => server.close(force: true));

  test('logs in lazily and returns data', () async {
    expect(await api.balance(), 120);
    expect(api.userId, 'u1');
    expect(logins, 1);
  });

  test('re-logs in once when the token expires', () async {
    await api.balance();
    expireNext = true;
    expect(await api.balance(), 120);
    expect(logins, 2);
  });

  test('asks for the dub in the device language', () async {
    final pb = await api.playback('e1');
    expect(pb.url, 'https://x/en/m.m3u8');
    expect(pb.dubs, ['es']);
  });

  test('maps backend errors to ApiException with a code', () async {
    await expectLater(
      api.unlock('e1'),
      throwsA(isA<ApiException>()
          .having((e) => e.code, 'code', 'INSUFFICIENT_COINS')
          .having((e) => e.body['price'], 'price', 60)),
    );
  });
}
