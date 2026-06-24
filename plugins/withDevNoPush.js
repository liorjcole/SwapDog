/**
 * withDevNoPush.js
 *
 * Env-gated Expo config plugin that strips the Push Notifications capability
 * from iOS prebuild output when DEV_NO_PUSH=1 is set in the environment.
 *
 * Purpose: free/personal Apple Development teams cannot sign an app that
 * includes the Push Notifications capability. This plugin removes every
 * trace of it so `npx expo run:ios --device` works without EAS.
 *
 * Usage:
 *   DEV_NO_PUSH=1 npx expo prebuild --clean   # strips push
 *   npx expo prebuild --clean                  # keeps push (prod/EAS unchanged)
 */

const {
  withEntitlementsPlist,
  withInfoPlist,
  withXcodeProject,
} = require('@expo/config-plugins');

/**
 * Remove the aps-environment entitlement from the .entitlements plist.
 * This is the primary blocker for free Apple team device signing.
 */
function stripEntitlement(config) {
  return withEntitlementsPlist(config, (mod) => {
    delete mod.modResults['aps-environment'];
    return mod;
  });
}

/**
 * Remove remote-notification from UIBackgroundModes in Info.plist.
 * expo-notifications may inject this; omitting it alone doesn't block
 * signing but we clean it up for a consistent no-push dev build.
 */
function stripInfoPlist(config) {
  return withInfoPlist(config, (mod) => {
    const modes = mod.modResults.UIBackgroundModes;
    if (Array.isArray(modes)) {
      mod.modResults.UIBackgroundModes = modes.filter(
        (m) => m !== 'remote-notification'
      );
      // Remove the key entirely if no background modes remain
      if (mod.modResults.UIBackgroundModes.length === 0) {
        delete mod.modResults.UIBackgroundModes;
      }
    }
    return mod;
  });
}

/**
 * Remove the Push Notifications SystemCapability from the Xcode project.
 * The capability key in .pbxproj is `com.apple.Push`.
 */
function stripXcodeCapability(config) {
  return withXcodeProject(config, (mod) => {
    const project = mod.modResults;
    const pbxProjectSection = project.pbxProjectSection();

    for (const key of Object.keys(pbxProjectSection)) {
      const pbxProject = pbxProjectSection[key];
      if (!pbxProject || typeof pbxProject !== 'object') continue;

      const targetAttributes = pbxProject.attributes?.TargetAttributes;
      if (!targetAttributes) continue;

      for (const targetKey of Object.keys(targetAttributes)) {
        const attrs = targetAttributes[targetKey];
        if (!attrs || typeof attrs !== 'object') continue;

        const caps = attrs.SystemCapabilities;
        if (caps && typeof caps === 'object') {
          delete caps['com.apple.Push'];
        }
      }
    }

    return mod;
  });
}

/**
 * Main plugin export.
 * When DEV_NO_PUSH=1: strips all push-related prebuild artifacts.
 * Otherwise: passes config through unchanged.
 */
const withDevNoPush = (config) => {
  if (process.env.DEV_NO_PUSH !== '1') {
    // Pass-through - production / EAS builds keep push notifications.
    return config;
  }

  config = stripEntitlement(config);
  config = stripInfoPlist(config);
  config = stripXcodeCapability(config);

  return config;
};

module.exports = withDevNoPush;

