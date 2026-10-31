import 'package:flutter_test/flutter_test.dart';
import 'package:kamixo/services/deep_links.dart';

void main() {
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e';

  test('parses the custom scheme', () {
    final l = parseSeriesLink(Uri.parse('kamixo://series/$id?ep=7'))!;
    expect(l.seriesId, id);
    expect(l.episode, 7);
  });

  test('parses https share links', () {
    final l = parseSeriesLink(Uri.parse('https://api.kamixo.app/s/$id'))!;
    expect(l.seriesId, id);
    expect(l.episode, isNull);
  });

  test('rejects anything else', () {
    expect(parseSeriesLink(Uri.parse('kamixo://series/not-an-id')), isNull);
    expect(parseSeriesLink(Uri.parse('https://api.kamixo.app/admin/')), isNull);
    expect(parseSeriesLink(Uri.parse('https://evil.example/s/$id/../../x')), isNull);
  });
}
