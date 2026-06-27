// app.config.js — extends app.json with runtime env vars.
// All static config lives in app.json; this file only adds values that must
// be injected at build time (EAS secrets / local .env).
//
// Lior: set the EAS secret once:
//   eas secret:create --scope project --name GOOGLE_PLACES_API_KEY --value <key> --type string

const baseConfig = require('./app.json');

module.exports = {
  expo: {
    ...baseConfig.expo,
    extra: {
      ...baseConfig.expo.extra,
      // Injected from EAS secret GOOGLE_PLACES_API_KEY (or a local .env).
      // Never commit a real key here.
      googlePlacesApiKey: process.env.GOOGLE_PLACES_API_KEY ?? '',
    },
  },
};

