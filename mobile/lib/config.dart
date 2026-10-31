/// Build-time configuration. Pass with --dart-define, e.g.
///   flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000
class AppConfig {
  /// Backend base URL. Android emulator reaches the host machine at 10.0.2.2.
  static const apiBaseUrl = String.fromEnvironment('API_BASE_URL', defaultValue: 'http://10.0.2.2:3000');

  /// RevenueCat public SDK keys. When empty the app uses the dev sandbox store
  /// (works only against a backend running with PURCHASE_VERIFIER=sandbox).
  static const revenueCatAppleKey = String.fromEnvironment('REVENUECAT_APPLE_KEY');
  static const revenueCatGoogleKey = String.fromEnvironment('REVENUECAT_GOOGLE_KEY');

  /// AdMob rewarded ad unit ids. When empty the app shows a fake "ad" (sandbox) and the
  /// backend must run with AD_REWARD_VERIFIER=sandbox.
  static const admobRewardedAndroid = String.fromEnvironment('ADMOB_REWARDED_ANDROID');
  static const admobRewardedIos = String.fromEnvironment('ADMOB_REWARDED_IOS');

  /// Firebase (for push notifications). All four are needed; when any is empty, push is off.
  /// Values come from the Firebase console (same as google-services.json / GoogleService-Info.plist).
  static const firebaseApiKey = String.fromEnvironment('FIREBASE_API_KEY');
  static const firebaseAppId = String.fromEnvironment('FIREBASE_APP_ID');
  static const firebaseSenderId = String.fromEnvironment('FIREBASE_SENDER_ID');
  static const firebaseProjectId = String.fromEnvironment('FIREBASE_PROJECT_ID');

  static bool get pushConfigured =>
      firebaseApiKey.isNotEmpty && firebaseAppId.isNotEmpty && firebaseSenderId.isNotEmpty && firebaseProjectId.isNotEmpty;

  /// URL scheme for deep links: `kamixo://series/<id>?ep=N` (must match the backend's APP_URL_SCHEME).
  static const urlScheme = 'kamixo';
}
