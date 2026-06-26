/**
 * One-shot admin cleanup: clear broken local profile photoURLs.
 *
 * WHY
 * ---
 * Older onboarding wrote the raw local `file://` picker URI to each user's
 * Firestore doc instead of uploading to Firebase Storage. A `file://` path only
 * exists on the device that picked it, so the photo is unreadable from any
 * other account/device and AvatarImage falls back to the dog emoji. The app now
 * (a) uploads onboarding photos to Storage and (b) self-heals each user's own
 * doc when they next open the app. This script drains the remaining bad rows in
 * one pass without waiting for every user to return.
 *
 * The original image is unrecoverable server-side (it never left the device),
 * so the only correct fix is to null the bad URL and let users re-add a photo.
 *
 * WHAT IT DOES
 * ------------
 * Scans the `users` collection and sets `photoURL: ''` on every doc whose
 * `photoURL` is non-empty and does NOT start with `http` (i.e. file://, ph://,
 * content://, assets-library://, etc.). https URLs are left untouched.
 *
 * HOW TO RUN (do NOT run in CI; this is a manual, one-time operation)
 * -------------------------------------------------------------------
 *   1. Install the admin SDK locally:
 *        npm install --no-save firebase-admin
 *   2. Get a service-account key for the Firebase project (swapdog-d0cfe):
 *        Firebase Console -> Project Settings -> Service accounts ->
 *        "Generate new private key". Save the JSON somewhere safe.
 *   3. Point the SDK at it and run:
 *        GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json \
 *          node scripts/backfill-clear-local-photourls.js
 *      Add --dry-run to preview without writing:
 *        ... node scripts/backfill-clear-local-photourls.js --dry-run
 *
 * SAFETY
 * ------
 * - Idempotent: re-running only touches docs that still have a bad URL.
 * - Batched writes (max 500 per Firestore batch).
 * - --dry-run prints the affected uids without mutating anything.
 */

'use strict';

const admin = require('firebase-admin');

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_LIMIT = 500;

function isBadPhotoURL(value) {
  return typeof value === 'string' && value.length > 0 && !/^https?:\/\//.test(value);
}

async function main() {
  // Uses GOOGLE_APPLICATION_CREDENTIALS (Application Default Credentials).
  admin.initializeApp();
  const db = admin.firestore();

  const snapshot = await db.collection('users').get();
  console.log(`Scanned ${snapshot.size} user docs.`);

  const bad = [];
  snapshot.forEach((doc) => {
    const data = doc.data();
    if (data && isBadPhotoURL(data.photoURL)) {
      bad.push({ id: doc.id, ref: doc.ref, photoURL: data.photoURL });
    }
  });

  console.log(`Found ${bad.length} doc(s) with a non-http photoURL.`);
  bad.forEach((d) => console.log(`  ${d.id}: ${d.photoURL}`));

  if (DRY_RUN) {
    console.log('Dry run — no writes performed.');
    return;
  }

  let cleared = 0;
  for (let i = 0; i < bad.length; i += BATCH_LIMIT) {
    const chunk = bad.slice(i, i + BATCH_LIMIT);
    const batch = db.batch();
    chunk.forEach((d) => batch.update(d.ref, { photoURL: '' }));
    await batch.commit();
    cleared += chunk.length;
    console.log(`Committed ${cleared}/${bad.length}.`);
  }

  console.log(`Done. Cleared ${cleared} photoURL(s).`);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});

