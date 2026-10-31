/// Build-time configuration. Pass with --dart-define, e.g.
///   flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000
class AppConfig {
  /// Backend base URL. Android emulator reaches the host machine at 10.0.2.2.
  static const apiBaseUrl = String.fromEnvironment('API_BASE_URL', defaultValue: 'http://10.0.2.2:3000');

  /// RevenueCat public SDK keys. When empty the app uses the dev sandbox store
  /// (works only against a backend running with PURCHASE_VERIFIER=sandbox).
  static const revenueCatAppleKey = String.fromEnvironment('REVENUECAT_APPLE_KEY');
  static const revenueCatGoogleKey = String.fromEnvironment('REVENUECAT_GOOGLE_KEY');
}
