/**
 * Firestore and Storage security regression tests.
 *
 * These tests intentionally model hostile authenticated accounts. A passing
 * suite proves that public projections remain usable while private source data
 * and privileged state transitions are denied to clients.
 */
const fs = require('fs');
const path = require('path');
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');
const {
  doc,
  setDoc,
  updateDoc,
  getDoc,
  addDoc,
  collection,
  serverTimestamp,
} = require('firebase/firestore');
const {
  ref,
  uploadBytes,
  getBytes,
  deleteObject,
} = require('firebase/storage');

const PROJECT_ID = 'swapdog-rules-test';
const IMG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
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

async function seed(collectionPath, id, data) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), collectionPath, id), data);
  });
}

const activeUser = (overrides = {}) => ({
  email: 'private@example.com',
  displayName: 'Member',
  accountStatus: 'active',
  isOnboarded: true,
  subscriptionStatus: 'active',
  subscriptionExpiresAt: new Date('2099-01-01T00:00:00.000Z'),
  points: 5,
  rating: 4,
  reviewCount: 2,
  location: { latitude: 40.7128, longitude: -74.006 },
  pushTokens: ['ExponentPushToken[private]'],
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

async function seedActiveUsers(...ids) {
  for (const id of ids) {
    await seed('users', id, activeUser({
      displayName: id[0].toUpperCase() + id.slice(1),
      email: `${id}@example.com`,
    }));
  }
}

describe('private users and public profile projections', () => {
  beforeEach(async () => {
    await seedActiveUsers('alice', 'mallory');
    await seed('publicProfiles', 'alice', {
      displayName: 'Alice',
      photoURL: 'https://example.com/alice.jpg',
      location: { latitude: 40.71, longitude: -74.01 },
      locationGeohash: 'dr5re',
      accountStatus: 'active',
      isOnboarded: true,
    });
    await seed('privateUsers', 'alice', {
      phoneNumber: '+12125550100',
      pushTokens: ['ExponentPushToken[private]'],
    });
  });

  test('owner can read private account source', async () => {
    const db = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(getDoc(doc(db, 'users', 'alice')));
    await assertSucceeds(getDoc(doc(db, 'privateUsers', 'alice')));
  });

  test('another active user cannot read private account source or push data', async () => {
    const db = testEnv.authenticatedContext('mallory').firestore();
    await assertFails(getDoc(doc(db, 'users', 'alice')));
    await assertFails(getDoc(doc(db, 'privateUsers', 'alice')));
  });

  test('another active user can read only the public profile projection', async () => {
    const db = testEnv.authenticatedContext('mallory').firestore();
    await assertSucceeds(getDoc(doc(db, 'publicProfiles', 'alice')));
  });

  test('expired member cannot use member-only public projections', async () => {
    await seed('users', 'expired', activeUser({
      subscriptionStatus: 'expired',
      subscriptionExpiresAt: new Date('2020-01-01T00:00:00.000Z'),
    }));
    const db = testEnv.authenticatedContext('expired').firestore();
    await assertFails(getDoc(doc(db, 'publicProfiles', 'alice')));
  });

  test('active members cannot read a stale projection for an expired user', async () => {
    await seed('users', 'expired', activeUser({
      subscriptionStatus: 'expired',
      subscriptionExpiresAt: new Date('2020-01-01T00:00:00.000Z'),
    }));
    await seed('publicProfiles', 'expired', {
      displayName: 'Expired',
      accountStatus: 'active',
      isOnboarded: true,
    });
    const db = testEnv.authenticatedContext('mallory').firestore();
    await assertFails(getDoc(doc(db, 'publicProfiles', 'expired')));
  });

  test('client cannot create a forged user profile', async () => {
    const db = testEnv.authenticatedContext('newbie').firestore();
    await assertFails(setDoc(doc(db, 'users', 'newbie'), activeUser({
      points: 999999,
      accountStatus: 'active',
      freeAccessUntil: new Date('2099-01-01'),
    })));
  });

  test('profile identity and aggregate fields require the server', async () => {
    const db = testEnv.authenticatedContext('alice').firestore();
    await assertFails(updateDoc(doc(db, 'users', 'alice'), {
      displayName: 'Alice Updated',
      bio: 'A dog parent in New York.',
      updatedAt: new Date(),
    }));
    await assertFails(updateDoc(doc(db, 'users', 'alice'), { accountStatus: 'suspended' }));
    await assertFails(updateDoc(doc(db, 'users', 'alice'), { isOnboarded: false }));
    await assertFails(updateDoc(doc(db, 'users', 'alice'), { points: 1000 }));
    await assertFails(updateDoc(doc(db, 'users', 'alice'), { contractSignedAt: new Date() }));
  });

  test('owner can still save private onboarding location fields', async () => {
    const db = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(updateDoc(doc(db, 'users', 'alice'), {
      location: { latitude: 40.7, longitude: -74 },
      locationGeohash: 'dr5rs',
      locationName: 'New York',
      updatedAt: new Date(),
    }));
  });

  test('dog profile writes require the server', async () => {
    await seed('dogs', 'aliceDog', {
      ownerId: 'alice',
      name: 'Skye',
      breed: 'Lab',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const db = testEnv.authenticatedContext('alice').firestore();
    await assertFails(addDoc(collection(db, 'dogs'), {
      ownerId: 'alice',
      name: 'Forged',
      breed: 'Lab',
      rating: 5,
      reviewCount: 100,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    await assertFails(updateDoc(doc(db, 'dogs', 'aliceDog'), {
      bio: 'Bypass server moderation',
      updatedAt: new Date(),
    }));
  });

  test('push token writes require the server', async () => {
    const db = testEnv.authenticatedContext('alice').firestore();
    await assertFails(updateDoc(doc(db, 'privateUsers', 'alice'), {
      pushToken: 'ExponentPushToken[new]',
      pushTokens: ['ExponentPushToken[new]'],
      updatedAt: new Date(),
    }));
    await assertFails(updateDoc(doc(db, 'users', 'alice'), {
      pushTokens: ['ExponentPushToken[public]'],
    }));
    await assertFails(updateDoc(doc(db, 'privateUsers', 'alice'), {
      pushTokens: [123],
      updatedAt: new Date(),
    }));
  });

  test('favorites enforce active targets and a fixed schema', async () => {
    const db = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(setDoc(doc(db, 'users', 'alice', 'favorites', 'mallory'), {
      notifyOnPost: true,
      createdAt: new Date(),
    }));
    await assertFails(setDoc(doc(db, 'users', 'alice', 'favorites', 'alice'), {
      notifyOnPost: true,
      createdAt: new Date(),
    }));
    await assertFails(setDoc(doc(db, 'users', 'alice', 'favorites', 'mallory'), {
      notifyOnPost: true,
      injected: 'unexpected',
      createdAt: new Date(),
    }));
  });
});

describe('private booking source and public discovery projection', () => {
  const privatePost = {
    posterId: 'alice',
    posterName: 'Alice',
    status: 'open',
    careAddress: '123 Private Street',
    careDetails: 'Alarm code 1234',
    medicationSlots: [{ time: '8:00 AM', details: 'Private medication instructions' }],
    respondedBy: [],
    startDate: new Date(Date.now() + 86_400_000),
    endDate: new Date(Date.now() + 172_800_000),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    await seedActiveUsers('alice', 'bob', 'mallory');
    await seed('swapPosts', 'post1', privatePost);
    await seed('publicSwapPosts', 'post1', {
      posterId: 'alice',
      posterName: 'Alice',
      status: 'open',
      startDate: privatePost.startDate,
      endDate: privatePost.endDate,
      createdAt: privatePost.createdAt,
      updatedAt: privatePost.updatedAt,
    });
  });

  test('unrelated member cannot read address or instructions', async () => {
    const db = testEnv.authenticatedContext('mallory').firestore();
    await assertFails(getDoc(doc(db, 'swapPosts', 'post1')));
    await assertSucceeds(getDoc(doc(db, 'publicSwapPosts', 'post1')));
  });

  test('owner and accepted caregiver can read full post', async () => {
    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(getDoc(doc(aliceDb, 'swapPosts', 'post1')));

    await seed('swapPosts', 'claimedPost', {
      ...privatePost,
      status: 'claimed',
      claimedBy: 'bob',
    });
    const bobDb = testEnv.authenticatedContext('bob').firestore();
    await assertSucceeds(getDoc(doc(bobDb, 'swapPosts', 'claimedPost')));
  });

  test('suspended participants cannot read private bookings', async () => {
    await seed('users', 'suspended', activeUser({ accountStatus: 'suspended' }));
    await seed('swapPosts', 'suspendedPost', {
      ...privatePost,
      posterId: 'suspended',
    });
    const db = testEnv.authenticatedContext('suspended').firestore();
    await assertFails(getDoc(doc(db, 'swapPosts', 'suspendedPost')));
  });

  test('attacker cannot self-claim or change private care data', async () => {
    const db = testEnv.authenticatedContext('mallory').firestore();
    await assertFails(updateDoc(doc(db, 'swapPosts', 'post1'), {
      status: 'claimed',
      claimedBy: 'mallory',
      careAddress: 'Attacker controlled address',
      medicationSlots: [{ time: '8:00 AM', details: 'Do not administer' }],
    }));
  });

  test('owner cannot bypass server approval by setting claimedBy', async () => {
    const db = testEnv.authenticatedContext('alice').firestore();
    await assertFails(updateDoc(doc(db, 'swapPosts', 'post1'), {
      status: 'claimed',
      claimedBy: 'mallory',
      updatedAt: new Date(),
    }));
  });

  test('clients cannot create bookings directly', async () => {
    const db = testEnv.authenticatedContext('alice').firestore();
    await assertFails(addDoc(collection(db, 'swapPosts'), {
      ...privatePost,
      posterId: 'alice',
      dogId: 'dog1',
    }));
  });

  test('owner cannot cancel an open booking without the server', async () => {
    const db = testEnv.authenticatedContext('alice').firestore();
    await assertFails(updateDoc(doc(db, 'swapPosts', 'post1'), {
      status: 'cancelled',
      updatedAt: new Date(),
    }));
  });

  test('claimed booking cannot be cancelled or reopened directly', async () => {
    await seed('swapPosts', 'claimedLocked', {
      posterId: 'alice',
      status: 'claimed',
      claimedBy: 'mallory',
      respondedBy: [{ userId: 'mallory' }],
      startDate: new Date('2099-01-02T00:00:00.000Z'),
      endDate: new Date('2099-01-03T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    const malloryDb = testEnv.authenticatedContext('mallory').firestore();
    await assertFails(updateDoc(doc(aliceDb, 'swapPosts', 'claimedLocked'), {
      status: 'cancelled',
    }));
    await assertFails(updateDoc(doc(malloryDb, 'swapPosts', 'claimedLocked'), {
      status: 'open',
      claimedBy: null,
      respondedBy: [],
    }));
    await assertFails(updateDoc(doc(aliceDb, 'swapPosts', 'claimedLocked'), {
      status: 'completed',
      updatedAt: new Date(),
    }));
  });

  test('participants cannot complete an expired booking without the server', async () => {
    await seed('swapPosts', 'expiredClaimed', {
      posterId: 'alice',
      status: 'claimed',
      claimedBy: 'bob',
      startDate: new Date('2020-01-01T00:00:00.000Z'),
      endDate: new Date('2020-01-02T00:00:00.000Z'),
      createdAt: new Date('2020-01-01T00:00:00.000Z'),
      updatedAt: new Date('2020-01-01T00:00:00.000Z'),
    });
    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    const bobDb = testEnv.authenticatedContext('bob').firestore();
    await assertFails(updateDoc(doc(aliceDb, 'swapPosts', 'expiredClaimed'), {
      status: 'completed',
      updatedAt: new Date(),
    }));
    await assertFails(updateDoc(doc(bobDb, 'swapPosts', 'expiredClaimed'), {
      status: 'completed',
      updatedAt: new Date(),
    }));
  });

  test('owner cannot bypass server content checks by editing care instructions', async () => {
    const db = testEnv.authenticatedContext('alice').firestore();
    await assertFails(updateDoc(doc(db, 'swapPosts', 'post1'), {
      careDetails: 'Updated private instructions',
      updatedAt: new Date(),
    }));
  });

  test('owner can edit compensation on an open post', async () => {
    const db = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(updateDoc(doc(db, 'swapPosts', 'post1'), {
      compensationType: 'payment',
      paymentAmount: 25,
      totalPayment: 25,
      updatedAt: new Date(),
    }));
  });

  test('owner cannot write invalid compensation values', async () => {
    const db = testEnv.authenticatedContext('alice').firestore();
    await assertFails(updateDoc(doc(db, 'swapPosts', 'post1'), {
      pointsOffered: 1_000_000,
      updatedAt: new Date(),
    }));
    await assertFails(updateDoc(doc(db, 'swapPosts', 'post1'), {
      paymentAmount: -1,
      updatedAt: new Date(),
    }));
  });
});

describe('conversation and message integrity', () => {
  beforeEach(async () => {
    await seedActiveUsers('alice', 'bob', 'mallory');
    await seed('conversations', 'conv1', {
      participantIds: ['alice', 'bob'],
      participantKey: 'alice__bob',
      swapRequestId: null,
      unreadCounts: { alice: 2, bob: 3 },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  test('clients cannot write messages directly, including forged system messages', async () => {
    const db = testEnv.authenticatedContext('alice').firestore();
    await assertFails(addDoc(collection(db, 'conversations', 'conv1', 'messages'), {
      conversationId: 'conv1',
      senderId: 'alice',
      text: 'Hello',
      read: false,
      createdAt: serverTimestamp(),
    }));
    await assertFails(addDoc(collection(db, 'conversations', 'conv1', 'messages'), {
      conversationId: 'conv1',
      senderId: 'swapdog-team',
      text: 'Forged system message',
      read: false,
      createdAt: serverTimestamp(),
    }));
  });

  test('participant cannot add a victim to an existing conversation', async () => {
    const db = testEnv.authenticatedContext('alice').firestore();
    await assertFails(updateDoc(doc(db, 'conversations', 'conv1'), {
      participantIds: ['alice', 'bob', 'mallory'],
    }));
  });

  test('client cannot create any conversation directly', async () => {
    const db = testEnv.authenticatedContext('alice').firestore();
    await assertFails(addDoc(collection(db, 'conversations'), {
      participantIds: ['alice', 'bob'],
      participantKey: 'alice__bob',
      swapRequestId: null,
      unreadCounts: { alice: 0, bob: 0 },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
    await assertFails(addDoc(collection(db, 'conversations'), {
      participantIds: ['alice', 'swapdog-team'],
      participantKey: 'alice__swapdog-team',
      swapRequestId: null,
      unreadCounts: { alice: 0 },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
    await assertFails(addDoc(collection(db, 'conversations'), {
      participantIds: ['alice', 'bob', 'mallory'],
      participantKey: 'alice__bob__mallory',
      swapRequestId: null,
      unreadCounts: {},
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
  });

  test('suspended participants cannot read conversations or messages', async () => {
    await seed('users', 'alice', activeUser({ accountStatus: 'suspended' }));
    await seed('conversations/conv1/messages', 'message1', {
      conversationId: 'conv1',
      senderId: 'bob',
      text: 'Private message',
      createdAt: new Date(),
    });
    const db = testEnv.authenticatedContext('alice').firestore();
    await assertFails(getDoc(doc(db, 'conversations', 'conv1')));
    await assertFails(getDoc(doc(db, 'conversations', 'conv1', 'messages', 'message1')));
  });

  test('a deterministic block stops new messages in either direction', async () => {
    await seed('blocks', 'bob_alice', {
      blockerId: 'bob',
      blockedId: 'alice',
      createdAt: new Date(),
    });
    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    await assertFails(addDoc(collection(aliceDb, 'conversations', 'conv1', 'messages'), {
      conversationId: 'conv1',
      senderId: 'alice',
      text: 'This must not be delivered',
      read: false,
      createdAt: serverTimestamp(),
    }));
  });

  test('participant can clear only their own unread count', async () => {
    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(updateDoc(doc(aliceDb, 'conversations', 'conv1'), {
      'unreadCounts.alice': 0,
    }));
    await assertFails(updateDoc(doc(aliceDb, 'conversations', 'conv1'), {
      'unreadCounts.bob': 0,
    }));
    await assertFails(updateDoc(doc(aliceDb, 'conversations', 'conv1'), {
      lastMessage: 'Tampered preview',
    }));
  });
});

describe('server-only business and legal records', () => {
  beforeEach(async () => {
    await seedActiveUsers('alice', 'bob');
    await seed('swapPosts', 'completedPost', {
      posterId: 'alice',
      claimedBy: 'bob',
      status: 'completed',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await seed('referral_codes', 'code1', {
      code: 'ABCDEFGH',
      createdBy: 'alice',
      usedCount: 0,
      usedBy: [],
      maxUses: 10,
      isActive: true,
    });
  });

  test('clients cannot create fabricated reviews', async () => {
    const db = testEnv.authenticatedContext('alice').firestore();
    await assertFails(setDoc(doc(db, 'reviews', 'fake'), {
      reviewerId: 'alice',
      revieweeId: 'bob',
      targetType: 'caregiver',
      rating: 5,
      postId: 'completedPost',
      createdAt: serverTimestamp(),
    }));
  });

  test('clients cannot create or mutate legacy swap bookings', async () => {
    const db = testEnv.authenticatedContext('alice').firestore();
    await assertFails(addDoc(collection(db, 'swapRequests'), {
      requesterId: 'alice',
      receiverId: 'bob',
      requesterDogIds: [],
      receiverDogIds: [],
      startDate: new Date(),
      endDate: new Date(),
      status: 'accepted',
      pointsCost: -100,
      paymentType: 'points',
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    await seed('swapRequests', 'legacySwap', {
      requesterId: 'alice',
      receiverId: 'bob',
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await assertFails(updateDoc(doc(db, 'swapRequests', 'legacySwap'), {
      status: 'accepted',
      updatedAt: new Date(),
    }));
  });

  test('clients cannot mutate referral counters or forge agreements', async () => {
    const db = testEnv.authenticatedContext('bob').firestore();
    await assertFails(updateDoc(doc(db, 'referral_codes', 'code1'), {
      usedCount: -100,
      usedBy: [],
    }));
    await assertFails(setDoc(doc(db, 'signed-agreements', 'alice-forged'), {
      userId: 'alice',
      signedName: 'Forged',
      contractVersion: '1.0',
      signedAt: serverTimestamp(),
    }));
  });
});

describe('storage ownership and deletion', () => {
  beforeEach(async () => {
    await seedActiveUsers('alice', 'mallory');
    await seed('dogs', 'dog1', { ownerId: 'alice' });
    await seed('conversations', 'conv1', {
      participantIds: ['alice', 'mallory'],
      participantKey: 'alice__mallory',
      swapRequestId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  test('dog owner can upload and delete their own photo', async () => {
    const storage = testEnv.authenticatedContext('alice').storage();
    const photoRef = ref(storage, 'dogs/dog1/p.jpg');
    await assertSucceeds(uploadBytes(photoRef, IMG, IMG_META));
    await assertSucceeds(deleteObject(photoRef));
  });

  test('non-owner cannot overwrite or delete a dog photo', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), 'dogs/dog1/p.jpg'), IMG, IMG_META);
    });
    const storage = testEnv.authenticatedContext('mallory').storage();
    await assertFails(uploadBytes(ref(storage, 'dogs/dog1/p.jpg'), IMG, IMG_META));
    await assertFails(deleteObject(ref(storage, 'dogs/dog1/p.jpg')));
  });

  test('members cannot read temporary or expired-owner dog photos', async () => {
    await seed('users', 'expired', activeUser({
      subscriptionStatus: 'expired',
      subscriptionExpiresAt: new Date('2020-01-01T00:00:00.000Z'),
    }));
    await seed('dogs', 'expiredDog', { ownerId: 'expired' });
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), 'dogs/temp_expired_123/p.jpg'), IMG, IMG_META);
      await uploadBytes(ref(ctx.storage(), 'dogs/expiredDog/p.jpg'), IMG, IMG_META);
    });
    const storage = testEnv.authenticatedContext('mallory').storage();
    await assertFails(getBytes(ref(storage, 'dogs/temp_expired_123/p.jpg')));
    await assertFails(getBytes(ref(storage, 'dogs/expiredDog/p.jpg')));
  });

  test('conversation participants can use chat images', async () => {
    const storage = testEnv.authenticatedContext('alice').storage();
    const photoRef = ref(storage, 'chat-images/conv1/p.jpg');
    await assertSucceeds(uploadBytes(photoRef, IMG, IMG_META));
    await assertSucceeds(getBytes(photoRef));
    await assertSucceeds(deleteObject(photoRef));
  });

  test('suspended participants cannot use chat images', async () => {
    await seed('users', 'alice', activeUser({ accountStatus: 'suspended' }));
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), 'chat-images/conv1/p.jpg'), IMG, IMG_META);
    });
    const storage = testEnv.authenticatedContext('alice').storage();
    const photoRef = ref(storage, 'chat-images/conv1/p.jpg');
    await assertFails(getBytes(photoRef));
    await assertFails(uploadBytes(photoRef, IMG, IMG_META));
    await assertFails(deleteObject(photoRef));
  });
});
