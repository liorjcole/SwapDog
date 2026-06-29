/**
 * Firestore & Storage security-rules tests (audit P0 lockdown).
 *
 * Run with: `npm test` in this folder (boots the Firestore + Storage emulators
 * via firebase-tools, then runs jest). Requires a JRE for the emulators.
 *
 * Each block proves a positive (legitimate client write still works) AND a
 * negative (the intended tampering/abuse path is now denied) case.
 */
const fs = require('fs');
const path = require('path');
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');
const { doc, setDoc, updateDoc, deleteField } = require('firebase/firestore');
const { ref, uploadBytes } = require('firebase/storage');

const PROJECT_ID = 'swapdog-rules-test';
const IMG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]); // tiny fake jpeg
const IMG_META = { contentType: 'image/jpeg' };

let testEnv;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: fs.readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
    storage: {
      rules: fs.readFileSync(path.resolve(__dirname, '../../storage.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 9199,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

// Seed a doc bypassing rules (server/admin context).
async function seed(collectionPath, id, data) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), collectionPath, id), data);
  });
}

const baseUser = (overrides = {}) => ({
  email: 'a@b.com',
  displayName: 'Alice',
  accountStatus: 'active',
  points: 10,
  rating: 4,
  reviewCount: 3,
  isOnboarded: true,
  ...overrides,
});

// ─────────────────────────────────────────────────────────────────────────────
// /users — field allow-list
// ─────────────────────────────────────────────────────────────────────────────
describe('users update — field allow-list', () => {
  beforeEach(async () => {
    await seed('users', 'alice', baseUser());
  });

  const aliceDb = () => testEnv.authenticatedContext('alice').firestore();

  test('owner CAN update legitimate profile fields', async () => {
    await assertSucceeds(
      updateDoc(doc(aliceDb(), 'users', 'alice'), {
        displayName: 'Alice 2',
        bio: 'hello',
        photoURL: 'https://x/p.jpg',
        instagramHandle: 'alice',
        location: { latitude: 1, longitude: 2 },
        locationName: 'NYC',
        pushTokens: ['t1'],
        updatedAt: new Date(),
      }),
    );
  });

  test('owner CAN run onboarding lifecycle (pending_approval -> active)', async () => {
    await seed('users', 'newbie', baseUser({ accountStatus: 'pending_approval' }));
    const db = testEnv.authenticatedContext('newbie').firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'users', 'newbie'), {
        accountStatus: 'active',
        conductAgreedAt: new Date(),
        contractSignedAt: new Date(),
        isOnboarded: true,
        updatedAt: new Date(),
      }),
    );
  });

  test('owner CAN clear pendingReview (review-gate release)', async () => {
    await seed('users', 'alice', baseUser({ pendingReview: { otherUserId: 'bob' } }));
    await assertSucceeds(
      updateDoc(doc(aliceDb(), 'users', 'alice'), { pendingReview: deleteField() }),
    );
  });

  test('owner CANNOT write its own rating', async () => {
    await assertFails(updateDoc(doc(aliceDb(), 'users', 'alice'), { rating: 5 }));
  });

  test('owner CANNOT write its own reviewCount', async () => {
    await assertFails(updateDoc(doc(aliceDb(), 'users', 'alice'), { reviewCount: 999 }));
  });

  test('owner CANNOT write its own points', async () => {
    await assertFails(updateDoc(doc(aliceDb(), 'users', 'alice'), { points: 100000 }));
  });

  test('owner CANNOT set isAdmin', async () => {
    await assertFails(updateDoc(doc(aliceDb(), 'users', 'alice'), { isAdmin: true }));
  });

  test('owner CANNOT sneak a denied field alongside allowed fields', async () => {
    await assertFails(
      updateDoc(doc(aliceDb(), 'users', 'alice'), { displayName: 'ok', points: 5000 }),
    );
  });

  test('suspended user CANNOT un-ban itself (accountStatus)', async () => {
    await seed('users', 'banned', baseUser({ accountStatus: 'suspended' }));
    const db = testEnv.authenticatedContext('banned').firestore();
    await assertFails(updateDoc(doc(db, 'users', 'banned'), { accountStatus: 'active' }));
  });

  test('user CANNOT write another user doc', async () => {
    await seed('users', 'bob', baseUser());
    await assertFails(updateDoc(doc(aliceDb(), 'users', 'bob'), { displayName: 'hax' }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// /reviews — validation + immutability
// ─────────────────────────────────────────────────────────────────────────────
describe('reviews — validation', () => {
  const aliceDb = () => testEnv.authenticatedContext('alice').firestore();
  const validReview = (overrides = {}) => ({
    reviewerId: 'alice',
    revieweeId: 'bob',
    targetType: 'owner',
    rating: 5,
    postId: 'p1',
    ...overrides,
  });

  test('valid review IS allowed', async () => {
    await assertSucceeds(setDoc(doc(aliceDb(), 'reviews', 'r1'), validReview()));
  });

  test('rating below 1 is rejected', async () => {
    await assertFails(setDoc(doc(aliceDb(), 'reviews', 'r2'), validReview({ rating: 0 })));
  });

  test('rating above 5 is rejected', async () => {
    await assertFails(setDoc(doc(aliceDb(), 'reviews', 'r3'), validReview({ rating: 6 })));
  });

  test('non-integer rating is rejected', async () => {
    await assertFails(setDoc(doc(aliceDb(), 'reviews', 'r4'), validReview({ rating: 4.5 })));
  });

  test('self-review (reviewer == reviewee) is rejected', async () => {
    await assertFails(setDoc(doc(aliceDb(), 'reviews', 'r5'), validReview({ revieweeId: 'alice' })));
  });

  test('spoofed reviewerId is rejected', async () => {
    await assertFails(setDoc(doc(aliceDb(), 'reviews', 'r6'), validReview({ reviewerId: 'bob' })));
  });

  test('reviews are immutable (no update)', async () => {
    await seed('reviews', 'r7', validReview());
    await assertFails(updateDoc(doc(aliceDb(), 'reviews', 'r7'), { rating: 1 }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Storage — chat-images participant scoping & dog-photo owner scoping
// ─────────────────────────────────────────────────────────────────────────────
describe('storage — chat-images scoping', () => {
  beforeEach(async () => {
    await seed('conversations', 'conv1', { participantIds: ['alice', 'bob'] });
  });

  test('participant CAN write a chat image', async () => {
    const storage = testEnv.authenticatedContext('alice').storage();
    await assertSucceeds(
      uploadBytes(ref(storage, 'chat-images/conv1/p.jpg'), IMG, IMG_META),
    );
  });

  test('participant CAN read a chat image', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), 'chat-images/conv1/p.jpg'), IMG, IMG_META);
    });
    const storage = testEnv.authenticatedContext('bob').storage();
    const { getBytes } = require('firebase/storage');
    await assertSucceeds(getBytes(ref(storage, 'chat-images/conv1/p.jpg')));
  });

  test('non-participant CANNOT write a chat image', async () => {
    const storage = testEnv.authenticatedContext('mallory').storage();
    await assertFails(
      uploadBytes(ref(storage, 'chat-images/conv1/p.jpg'), IMG, IMG_META),
    );
  });

  test('non-participant CANNOT read a chat image', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), 'chat-images/conv1/p.jpg'), IMG, IMG_META);
    });
    const storage = testEnv.authenticatedContext('mallory').storage();
    const { getBytes } = require('firebase/storage');
    await assertFails(getBytes(ref(storage, 'chat-images/conv1/p.jpg')));
  });
});

describe('storage — dog-photo owner scoping', () => {
  beforeEach(async () => {
    await seed('dogs', 'dog1', { ownerId: 'alice' });
  });

  test('owner CAN write to its own temp path (new dog)', async () => {
    const storage = testEnv.authenticatedContext('alice').storage();
    await assertSucceeds(
      uploadBytes(ref(storage, 'dogs/temp_alice_1700000000/p.jpg'), IMG, IMG_META),
    );
  });

  test('user CANNOT write to another user temp path', async () => {
    const storage = testEnv.authenticatedContext('mallory').storage();
    await assertFails(
      uploadBytes(ref(storage, 'dogs/temp_alice_1700000000/p.jpg'), IMG, IMG_META),
    );
  });

  test('owner CAN write to its own existing dog path', async () => {
    const storage = testEnv.authenticatedContext('alice').storage();
    await assertSucceeds(
      uploadBytes(ref(storage, 'dogs/dog1/p.jpg'), IMG, IMG_META),
    );
  });

  test('non-owner CANNOT write to an existing dog path', async () => {
    const storage = testEnv.authenticatedContext('mallory').storage();
    await assertFails(
      uploadBytes(ref(storage, 'dogs/dog1/p.jpg'), IMG, IMG_META),
    );
  });
});

