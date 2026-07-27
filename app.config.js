// Keep runtime configuration limited to values safe to ship in the app bundle.
// Private API keys are consumed only by Cloud Functions secrets.

module.exports = ({ config }) => ({
  expo: {
    ...config,
    ios: {
      ...config.ios,
      googleServicesFile: './firebase-config/GoogleService-Info.plist',
      entitlements: {
        ...config.ios?.entitlements,
        'com.apple.developer.devicecheck.appattest-environment': 'production',
      },
    },
    plugins: [
      ...(config.plugins ?? []),
      '@react-native-firebase/app',
      '@react-native-firebase/app-check',
    ],
    extra: { ...config.extra },
  },
});
