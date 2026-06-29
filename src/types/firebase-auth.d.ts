// firebase v12 ships `getReactNativePersistence` only in its React Native bundle
// (the "react-native" export condition). The @firebase/auth `exports` map lists
// the "types" condition before "react-native", so tsc always resolves the default
// type entry that omits this symbol — even though Metro loads the RN bundle at
// runtime, where the function exists and is the documented persistence API.
// Re-declare the export here so type-checking matches the real runtime surface.
// This is purely a type-resolution shim: runtime auth persistence is unaffected.
import type { Persistence } from 'firebase/auth';

declare module 'firebase/auth' {
  // Mirrors firebase/auth's React Native bundle signature. The storage argument
  // is an AsyncStorage-like object; firebase does not export its public type, so
  // we keep it `unknown` rather than inventing a divergent shape.
  export function getReactNativePersistence(storage: unknown): Persistence;
}

