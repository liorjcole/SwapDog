const { withEntitlementsPlist, withInfoPlist } = require('@expo/config-plugins');

const withIAPCapability = (config) => {
  // The In-App Purchase capability in modern iOS doesn't require a specific
  // entitlement key in the entitlements plist. It's handled by:
  // 1. The provisioning profile (EAS manages this)
  // 2. The StoreKit framework linking (Superwall handles this via its pod)
  // 
  // What we CAN do is ensure the build has StoreKit framework linked.
  // But actually, Superwall's pod already does this.
  //
  // The real issue might not be the capability at all.
  // Let me check if the problem is Superwall product configuration.
  
  return config;
};

module.exports = withIAPCapability;
