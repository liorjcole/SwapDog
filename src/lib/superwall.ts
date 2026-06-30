// Single safe entry point for expo-superwall.
//
// WHY THIS EXISTS:
// expo-superwall evaluates requireNativeModule("SuperwallExpo") at module scope. A
// static `import ... from 'expo-superwall'` is hoisted and evaluated synchronously at
// module load, so when the native module is absent from the binary it throws BEFORE
// React mounts and before any ErrorBoundary exists -> white screen on launch. A static
// import cannot be wrapped in try/catch.
//
// Every importer in the app MUST import Superwall symbols from this module. The only
// runtime `require('expo-superwall')` in the codebase lives here, inside a single
// try/catch. When the native module is unavailable we substitute inert, type-compatible
// fallbacks so the app launches and onboarding proceeds with Superwall simply disabled.
//
// The `import type` / `typeof import(...)` references below are erased at build time and
// never trigger native-module evaluation.

import React from 'react';
import type {
  PublicSuperwallStore,
  RegisterPlacementArgs,
  SuperwallStore,
  usePlacementCallbacks,
} from 'expo-superwall';

type ExpoSuperwall = typeof import('expo-superwall');
type SuperwallProviderComponent = ExpoSuperwall['SuperwallProvider'];
type SuperwallProviderProps = React.ComponentProps<SuperwallProviderComponent>;
type UseSuperwallHook = ExpoSuperwall['useSuperwall'];
type UsePlacementHook = ExpoSuperwall['usePlacement'];
type UsePlacementResult = ReturnType<UsePlacementHook>;

// Surface of expo-superwall the app consumes. Loaded at most once, lazily-guarded.
type LoadedSuperwall = {
  SuperwallProvider: SuperwallProviderComponent;
  useSuperwall: UseSuperwallHook;
  usePlacement: UsePlacementHook;
};

function loadNativeSuperwall(): LoadedSuperwall | null {
  try {
    // The ONLY runtime require of expo-superwall in the app. Evaluating the module
    // triggers requireNativeModule("SuperwallExpo"); if the native module is absent it
    // throws here and we fall back to the disabled implementation below. A guarded
    // require is the whole point: a static import would be hoisted and crash launch.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-superwall') as LoadedSuperwall;
    return mod;
  } catch (error) {
    console.warn(
      '[superwall] native module unavailable — Superwall disabled for this session:',
      error,
    );
    return null;
  }
}

const nativeSuperwall = loadNativeSuperwall();

/** True when the SuperwallExpo native module is present and Superwall is active. */
export const isSuperwallAvailable: boolean = nativeSuperwall !== null;

// --- Disabled (no native module) fallbacks ----------------------------------

// Inert store mirroring SuperwallStore. Configuration never completes, so consumers
// that gate on `isConfigured` simply never trigger a paywall. Methods are typed no-ops;
// the few that resolve to complex shapes reject (they are unreachable while disabled).
function createDisabledStore(): SuperwallStore {
  const noop = async (): Promise<void> => {};
  const unavailable = (): Promise<never> =>
    Promise.reject(new Error('Superwall is unavailable on this build'));
  return {
    isConfigured: false,
    isLoading: false,
    listenersInitialized: false,
    configurationError: null,
    user: null,
    subscriptionStatus: { status: 'UNKNOWN' },
    configure: noop,
    identify: noop,
    reset: noop,
    registerPlacement: noop,
    getPresentationResult: unavailable,
    restorePurchases: unavailable,
    dismiss: noop,
    preloadAllPaywalls: noop,
    preloadPaywalls: noop,
    setUserAttributes: noop,
    getUserAttributes: async () => ({}),
    setLogLevel: noop,
    setIntegrationAttributes: noop,
    getIntegrationAttributes: async () => ({}),
    _initListeners: () => () => {},
    setSubscriptionStatus: noop,
    getDeviceAttributes: async () => ({}),
    getEntitlements: async () => ({ active: [], inactive: [] }),
  };
}

const disabledStore = createDisabledStore();

const useSuperwallDisabled: UseSuperwallHook = <T = PublicSuperwallStore>(
  selector?: (state: SuperwallStore) => T,
): T => {
  // The disabled store is immutable, so no subscription is needed.
  if (selector) return selector(disabledStore);
  // No-selector path returns the whole store. The generic identity return is inherent
  // to the upstream signature; app call sites always pass a selector, so this is unused.
  return disabledStore as unknown as T;
};

const usePlacementDisabled: UsePlacementHook = (
  _callbacks?: usePlacementCallbacks,
): UsePlacementResult => {
  const registerPlacement = async ({ feature }: RegisterPlacementArgs): Promise<void> => {
    // Superwall is disabled, so no paywall can be presented. Run the gated feature to
    // let the user through — keeps onboarding functional in a degraded build instead of
    // stranding them on a spinner.
    feature?.();
  };
  return { registerPlacement, state: { status: 'idle' } };
};

function SuperwallDisabledProvider({ children }: SuperwallProviderProps): React.ReactElement {
  // No-op passthrough: render children unchanged with Superwall inactive.
  return React.createElement(React.Fragment, null, children);
}

// --- Public exports: native when available, inert fallback otherwise ---------

export const SuperwallProvider: SuperwallProviderComponent =
  nativeSuperwall?.SuperwallProvider ?? SuperwallDisabledProvider;

// Implementation is selected once at module load (a stable reference), so call sites
// invoke a fixed hook — no conditional hook calls, no rules-of-hooks violation.
export const useSuperwall: UseSuperwallHook =
  nativeSuperwall?.useSuperwall ?? useSuperwallDisabled;

export const usePlacement: UsePlacementHook =
  nativeSuperwall?.usePlacement ?? usePlacementDisabled;

