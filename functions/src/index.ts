import * as admin from "firebase-admin";
import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as functions from "firebase-functions";
import Expo, { ExpoPushMessage, ExpoPushTicket, ExpoPushReceipt } from "expo-server-sdk";
import twilio from "twilio";
import * as crypto from "crypto";


admin.initializeApp();
const db = admin.firestore();
const expo = new Expo();

const twilioAccountSid = defineSecret("TWILIO_ACCOUNT_SID");
const twilioAuthToken = defineSecret("TWILIO_AUTH_TOKEN");
const twilioVerifyServiceSid = defineSecret("TWILIO_VERIFY_SERVICE_SID");

const REFERRAL_COLLECTION = "referral_codes";
const PROMO_CODES = new Set(["WATCHDOGFREE"]);
const PHONE_SIGNUP_TICKET_COLLECTION = "phoneSignupTickets";
const PHONE_SIGNUP_TICKET_TTL_MS = 10 * 60 * 1000;

function makeTwilioClient() {
  return twilio(twilioAccountSid.value(), twilioAuthToken.value());
}

function getProviderErrorCode(error: unknown): number | string | undefined {
  return (error as { code?: number | string })?.code;
}

function getProviderErrorStatus(error: unknown): number | undefined {
  return (error as { status?: number })?.status;
}

function toPhoneVerificationError(error: unknown): HttpsError {
  const code = getProviderErrorCode(error);
  const status = getProviderErrorStatus(error);
  console.warn("[phoneVerification] Provider error:", {
    code,
    status,
    message: (error as { message?: string })?.message,
  });

  if (code === 20404 || status === 404) {
    return new HttpsError(
      "permission-denied",
      "Invalid or expired verification code. Please request a new code."
    );
  }

  if (status === 429) {
    return new HttpsError("resource-exhausted", "Too many attempts. Please try again later.");
  }

  return new HttpsError("internal", "Phone verification failed. Please try again.");
}

function normalizePhoneNumber(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new HttpsError("invalid-argument", "Phone number is required.");
  }

  const value = raw.trim();
  const digits = value.replace(/\D/g, "");
  if (!digits) {
    throw new HttpsError("invalid-argument", "Phone number is required.");
  }

  let e164: string;
  if (value.startsWith("+")) {
    e164 = `+${digits}`;
  } else if (digits.length === 10) {
    e164 = `+1${digits}`;
  } else if (digits.length === 11 && digits.startsWith("1")) {
    e164 = `+${digits}`;
  } else {
    throw new HttpsError(
      "invalid-argument",
      "Use a valid phone number, including country code if outside the US."
    );
  }

  const normalizedDigits = e164.slice(1);
  if (normalizedDigits.length < 8 || normalizedDigits.length > 15) {
    throw new HttpsError("invalid-argument", "Use a valid phone number.");
  }

  return e164;
}

function hashPhoneNumber(phoneNumber: string): string {
  return crypto.createHash("sha256").update(phoneNumber).digest("hex");
}

function hashSignupTicket(ticket: string): string {
  return crypto.createHash("sha256").update(ticket).digest("hex");
}

async function createPhoneSignupTicket(phoneNumber: string): Promise<string> {
  const ticket = crypto.randomBytes(32).toString("base64url");
  const now = admin.firestore.Timestamp.now();

  await db.collection(PHONE_SIGNUP_TICKET_COLLECTION).doc(hashSignupTicket(ticket)).set({
    phoneHash: hashPhoneNumber(phoneNumber),
    phoneNumber,
    createdAt: now,
    expiresAt: admin.firestore.Timestamp.fromMillis(now.toMillis() + PHONE_SIGNUP_TICKET_TTL_MS),
    consumedAt: null,
  });

  return ticket;
}

async function consumePhoneSignupTicket(phoneNumber: string, rawTicket: unknown): Promise<void> {
  if (typeof rawTicket !== "string" || rawTicket.trim().length < 20) {
    throw new HttpsError("permission-denied", "Please verify your phone number again.");
  }

  const ticketRef = db
    .collection(PHONE_SIGNUP_TICKET_COLLECTION)
    .doc(hashSignupTicket(rawTicket.trim()));
  const now = admin.firestore.Timestamp.now();

  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ticketRef);
    const data = snap.data();
    if (!data) {
      throw new HttpsError("permission-denied", "Please verify your phone number again.");
    }

    const ticketPhone = data.phoneNumber as string | undefined;
    const expiresAt = data.expiresAt as admin.firestore.Timestamp | undefined;
    const consumedAt = data.consumedAt as admin.firestore.Timestamp | null | undefined;
    if (
      ticketPhone !== phoneNumber ||
      !expiresAt ||
      expiresAt.toMillis() <= now.toMillis() ||
      consumedAt
    ) {
      throw new HttpsError("permission-denied", "Please verify your phone number again.");
    }

    transaction.update(ticketRef, {
      consumedAt: now,
      updatedAt: now,
    });
  });
}

async function verifyTwilioPhoneCode(phoneNumber: string, rawCode: unknown): Promise<void> {
  const code = typeof rawCode === "string" ? rawCode.trim() : "";
  if (!/^\d{4,10}$/.test(code)) {
    throw new HttpsError("invalid-argument", "Enter the verification code.");
  }

  let check: { status: string };
  try {
    check = await makeTwilioClient()
      .verify.v2.services(twilioVerifyServiceSid.value())
      .verificationChecks.create({ to: phoneNumber, code });
  } catch (error) {
    throw toPhoneVerificationError(error);
  }

  if (check.status !== "approved") {
    throw new HttpsError("permission-denied", "Invalid or expired verification code.");
  }
}

async function enforcePhoneSendLimit(phoneNumber: string): Promise<void> {
  const ref = db.collection("phoneVerificationRateLimits").doc(hashPhoneNumber(phoneNumber));
  const now = admin.firestore.Timestamp.now();
  const snap = await ref.get();
  const data = snap.data();
  const lastSentAt = data?.lastSentAt as admin.firestore.Timestamp | undefined;
  const windowStart = data?.windowStart as admin.firestore.Timestamp | undefined;
  const sends = typeof data?.sends === "number" ? data.sends : 0;

  if (lastSentAt && now.toMillis() - lastSentAt.toMillis() < 30_000) {
    throw new HttpsError("resource-exhausted", "Please wait before requesting another code.");
  }

  const shouldResetWindow =
    !windowStart || now.toMillis() - windowStart.toMillis() > 60 * 60 * 1000;
  const nextSends = shouldResetWindow ? 1 : sends + 1;
  if (nextSends > 5) {
    throw new HttpsError("resource-exhausted", "Too many code requests. Please try again later.");
  }

  await ref.set(
    {
      phoneHash: hashPhoneNumber(phoneNumber),
      sends: nextSends,
      windowStart: shouldResetWindow ? now : windowStart,
      lastSentAt: now,
      updatedAt: now,
    },
    { merge: true }
  );
}

async function generateReferralCodeForUser(userId: string): Promise<string> {
  const existingUser = await db.collection("users").doc(userId).get();
  const existingCode = existingUser.data()?.referralCode as string | undefined;
  if (existingCode) return existingCode;

  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 8; attempt += 1) {
    let code = "";
    for (let i = 0; i < 8; i += 1) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    const collision = await db.collection(REFERRAL_COLLECTION).where("code", "==", code).limit(1).get();
    if (!collision.empty) continue;

    await db.collection(REFERRAL_COLLECTION).add({
      code,
      createdBy: userId,
      isActive: true,
      usedBy: [],
      maxUses: 10,
      usedCount: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return code;
  }

  throw new HttpsError("internal", "Could not generate a referral code.");
}

async function resolveReferralCode(rawCode: unknown, userId: string): Promise<{
  referredBy?: string;
  usedCode?: string;
  freeAccessUntil?: Date;
}> {
  if (typeof rawCode !== "string" || rawCode.trim().length === 0) return {};
  const usedCode = rawCode.trim().toUpperCase();
  const freeAccessUntil = PROMO_CODES.has(usedCode)
    ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    : undefined;

  if (usedCode === "8888" || usedCode === "1717" || PROMO_CODES.has(usedCode)) {
    return { usedCode, freeAccessUntil };
  }

  const snap = await db
    .collection(REFERRAL_COLLECTION)
    .where("code", "==", usedCode)
    .limit(1)
    .get();
  if (snap.empty) return { usedCode, freeAccessUntil };

  const codeDoc = snap.docs[0];
  const data = codeDoc.data();
  const isActive = data.isActive === true;
  const usedCount = typeof data.usedCount === "number" ? data.usedCount : 0;
  const maxUses = typeof data.maxUses === "number" ? data.maxUses : 0;
  const createdBy = data.createdBy as string | undefined;

  if (!isActive || usedCount >= maxUses || !createdBy || createdBy === userId) {
    return { usedCode, freeAccessUntil };
  }

  await codeDoc.ref.update({
    usedCount: admin.firestore.FieldValue.increment(1),
    usedBy: admin.firestore.FieldValue.arrayUnion(userId),
  });

  return { referredBy: createdBy, usedCode, freeAccessUntil };
}

async function findUserIdByPhone(phoneNumber: string): Promise<string | null> {
  try {
    const userRecord = await admin.auth().getUserByPhoneNumber(phoneNumber);
    return userRecord.uid;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== "auth/user-not-found") {
      console.warn("[findUserIdByPhone] Auth lookup failed:", error);
    }
  }

  const privateSnap = await db
    .collection("privateUsers")
    .where("phoneNumber", "==", phoneNumber)
    .limit(1)
    .get();
  return privateSnap.empty ? null : privateSnap.docs[0].id;
}

async function createOrLoadPhoneUser(phoneNumber: string, referralCode: unknown): Promise<string> {
  const existingUid = await findUserIdByPhone(phoneNumber);
  if (existingUid) {
    await ensurePhoneUserDocs(existingUid, phoneNumber, referralCode);
    return existingUid;
  }

  let uid: string;
  try {
    const created = await admin.auth().createUser({ phoneNumber });
    uid = created.uid;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "auth/phone-number-already-exists") {
      const existing = await admin.auth().getUserByPhoneNumber(phoneNumber);
      uid = existing.uid;
    } else {
      throw error;
    }
  }

  await ensurePhoneUserDocs(uid, phoneNumber, referralCode);

  return uid;
}

async function ensurePhoneUserDocs(
  uid: string,
  phoneNumber: string,
  referralCode: unknown
): Promise<void> {
  const userRef = db.collection("users").doc(uid);
  const userSnap = await userRef.get();
  const isNewProfile = !userSnap.exists;
  const newReferralCode = await generateReferralCodeForUser(uid);
  const referral = isNewProfile ? await resolveReferralCode(referralCode, uid) : {};

  const userDoc: Record<string, unknown> = isNewProfile ? {
    email: "",
    displayName: "",
    photoURL: "",
    bio: "",
    isOnboarded: false,
    referredBy: referral.referredBy ?? null,
    referralCodeUsed: referral.usedCode ?? null,
    referralCode: newReferralCode,
    points: 5,
    accountStatus: "pending_approval",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  } : {
    referralCode: userSnap.data()?.referralCode ?? newReferralCode,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (referral.freeAccessUntil) {
    userDoc.freeAccessUntil = referral.freeAccessUntil;
  }

  await userRef.set(userDoc, { merge: true });
  await db.collection("privateUsers").doc(uid).set(
    {
      phoneNumber,
      authProvider: "phone_otp",
      ...(isNewProfile ? { createdAt: admin.firestore.FieldValue.serverTimestamp() } : {}),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  if (isNewProfile) {
    await userRef.collection("pointsHistory").add({
      type: "bonus",
      description: "Welcome to WatchDog!",
      points: 5,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
}

export const startPhoneVerification = onCall(
  {
    secrets: [twilioAccountSid, twilioAuthToken, twilioVerifyServiceSid],
  },
  async (request) => {
    const phoneNumber = normalizePhoneNumber(request.data?.phoneNumber);
    await enforcePhoneSendLimit(phoneNumber);

    try {
      await makeTwilioClient()
        .verify.v2.services(twilioVerifyServiceSid.value())
        .verifications.create({ to: phoneNumber, channel: "sms" });
    } catch (error) {
      throw toPhoneVerificationError(error);
    }

    return { phoneNumber };
  }
);

export const verifyPhoneCode = onCall(
  {
    secrets: [twilioAccountSid, twilioAuthToken, twilioVerifyServiceSid],
  },
  async (request) => {
    const phoneNumber = normalizePhoneNumber(request.data?.phoneNumber);
    const mode = request.data?.mode === "signIn" ? "signIn" : "signUp";
    const supportsSignupTicket = request.data?.supportsSignupTicket === true;

    await verifyTwilioPhoneCode(phoneNumber, request.data?.code);

    const existingUid = await findUserIdByPhone(phoneNumber);
    if (mode === "signIn" && !existingUid) {
      if (!supportsSignupTicket) {
        throw new HttpsError("not-found", "No account exists for this phone number.");
      }
      const signupTicket = await createPhoneSignupTicket(phoneNumber);
      return {
        status: "verifiedNoAccount",
        phoneNumber,
        signupTicket,
      };
    }

    const uid = existingUid ?? await createOrLoadPhoneUser(phoneNumber, request.data?.referralCode);
    if (existingUid) {
      await ensurePhoneUserDocs(existingUid, phoneNumber, request.data?.referralCode);
    }

    const token = await admin.auth().createCustomToken(uid, {
      phone_verified: true,
      auth_provider: "phone_otp",
    });
    return { status: "authenticated", token, isNewUser: !existingUid };
  }
);

export const verifyPhoneForAccountUpgrade = onCall(
  {
    secrets: [twilioAccountSid, twilioAuthToken, twilioVerifyServiceSid],
  },
  async (request) => {
    const phoneNumber = normalizePhoneNumber(request.data?.phoneNumber);
    await verifyTwilioPhoneCode(phoneNumber, request.data?.code);

    const existingUid = await findUserIdByPhone(phoneNumber);
    if (existingUid && existingUid !== request.auth?.uid) {
      throw new HttpsError("already-exists", "This phone number is already attached to an account.");
    }

    const signupTicket = await createPhoneSignupTicket(phoneNumber);
    return { phoneNumber, signupTicket };
  }
);

export const attachPhoneToCurrentUser = onCall(
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Please sign in to your old account first.");
    }

    const phoneNumber = normalizePhoneNumber(request.data?.phoneNumber);
    await consumePhoneSignupTicket(phoneNumber, request.data?.signupTicket);

    const existingUid = await findUserIdByPhone(phoneNumber);
    if (existingUid && existingUid !== uid) {
      throw new HttpsError("already-exists", "This phone number is already attached to an account.");
    }

    try {
      await admin.auth().updateUser(uid, { phoneNumber });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "auth/phone-number-already-exists") {
        throw new HttpsError("already-exists", "This phone number is already attached to an account.");
      }
      console.warn("[attachPhoneToCurrentUser] Auth update failed:", error);
      throw new HttpsError("internal", "Could not attach this phone number. Please try again.");
    }

    await ensurePhoneUserDocs(uid, phoneNumber, undefined);
    await db.collection("users").doc(uid).set(
      {
        email: "",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    await db.collection("privateUsers").doc(uid).set(
      {
        phoneNumber,
        authProvider: "phone_otp",
        migratedFromEmail: true,
        migratedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    const token = await admin.auth().createCustomToken(uid, {
      phone_verified: true,
      auth_provider: "phone_otp",
      migrated_from_email: true,
    });
    return { token };
  }
);

export const completePhoneSignUp = onCall(
  async (request) => {
    const phoneNumber = normalizePhoneNumber(request.data?.phoneNumber);
    await consumePhoneSignupTicket(phoneNumber, request.data?.signupTicket);

    const existingUid = await findUserIdByPhone(phoneNumber);
    const uid = existingUid ?? await createOrLoadPhoneUser(phoneNumber, request.data?.referralCode);
    if (existingUid) {
      await ensurePhoneUserDocs(existingUid, phoneNumber, request.data?.referralCode);
    }

    const token = await admin.auth().createCustomToken(uid, {
      phone_verified: true,
      auth_provider: "phone_otp",
    });
    return { token, isNewUser: !existingUid };
  }
);

// ─── Helper: get all valid Expo push tokens for a user (multi-device) ─────────
async function getUserTokens(userId: string): Promise<string[]> {
  const snap = await db.collection("users").doc(userId).get();
  const data = snap.data();
  if (!data) return [];

  // Prefer pushTokens array; fall back to legacy single pushToken
  const tokens: string[] = [];
  if (Array.isArray(data.pushTokens)) {
    tokens.push(...(data.pushTokens as string[]));
  } else if (data.pushToken) {
    tokens.push(data.pushToken as string);
  }

  // Filter to valid Expo tokens only
  return tokens.filter((t) => Expo.isExpoPushToken(t));
}

// ─── Helper: get a user's display name ────────────────────────────────────────
async function getUserDisplayName(userId: string): Promise<string> {
  const snap = await db.collection("users").doc(userId).get();
  const data = snap.data();
  return (data?.displayName as string) || "Someone";
}

// ─── Helper: remove dead tokens from a user's Firestore doc ───────────────────
async function removeDeadTokens(userId: string, deadTokens: string[]): Promise<void> {
  if (deadTokens.length === 0) return;

  const snap = await db.collection("users").doc(userId).get();
  const data = snap.data();
  if (!data) return;

  const currentTokens = (data.pushTokens as string[] | undefined) ?? [];
  const cleanedTokens = currentTokens.filter((t) => !deadTokens.includes(t));

  const update: Record<string, unknown> = {
    pushTokens: cleanedTokens,
  };
  // If the legacy pushToken is dead, clear it too
  if (data.pushToken && deadTokens.includes(data.pushToken as string)) {
    update.pushToken = cleanedTokens[0] ?? admin.firestore.FieldValue.delete();
  }

  await db.collection("users").doc(userId).update(update);
  console.log(`[removeDeadTokens] Removed ${deadTokens.length} dead token(s) for user ${userId}`);
}

// ─── Core: send push notifications with batching + receipt checking ───────────
async function sendPushNotifications(
  userId: string,
  tokens: string[],
  title: string,
  body: string,
  data: Record<string, string>,
  badge?: number
): Promise<void> {
  if (tokens.length === 0) return;

  // Build messages for all tokens (multi-device)
  const messages: ExpoPushMessage[] = tokens.map((token) => ({
    to: token,
    sound: "default" as const,
    title,
    body,
    data,
    ...(badge !== undefined ? { badge } : {}),
  }));

  // Chunk into batches of 100 (Expo's per-request limit)
  const chunks = expo.chunkPushNotifications(messages);
  const tickets: ExpoPushTicket[] = [];

  for (const chunk of chunks) {
    try {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...ticketChunk);
    } catch (error) {
      console.error("[sendPush] Chunk send failed:", error);
    }
  }

  // Collect ticket IDs for receipt checking
  const receiptIds: string[] = [];
  const immediateDeadTokens: string[] = [];

  tickets.forEach((ticket, index) => {
    if (ticket.status === "ok" && ticket.id) {
      receiptIds.push(ticket.id);
    } else if (ticket.status === "error") {
      // Some errors are immediate (e.g. DeviceNotRegistered)
      if (ticket.details?.error === "DeviceNotRegistered") {
        immediateDeadTokens.push(tokens[index]);
      }
      console.error(`[sendPush] Ticket error for token ${tokens[index]}:`, ticket.message);
    }
  });

  // Remove immediately-detected dead tokens
  if (immediateDeadTokens.length > 0) {
    await removeDeadTokens(userId, immediateDeadTokens);
  }

  // Check receipts after a delay (Expo recommends ~15 min, but we check after 30s
  // since Cloud Functions have a limited execution window)
  if (receiptIds.length > 0) {
    await checkReceipts(userId, tokens, receiptIds);
  }
}

// ─── Receipt checking: find DeviceNotRegistered errors, clean up dead tokens ──
async function checkReceipts(
  userId: string,
  tokens: string[],
  receiptIds: string[]
): Promise<void> {
  // Chunk receipt IDs into batches of 300 (Expo limit)
  const receiptIdChunks = expo.chunkPushNotificationReceiptIds(receiptIds);
  const deadTokens: string[] = [];

  for (const chunk of receiptIdChunks) {
    try {
      const receipts: Record<string, ExpoPushReceipt> =
        await expo.getPushNotificationReceiptsAsync(chunk);

      for (const [receiptId, receipt] of Object.entries(receipts)) {
        if (receipt.status === "error") {
          if (receipt.details?.error === "DeviceNotRegistered") {
            // Find the token that corresponds to this receipt
            const receiptIndex = receiptIds.indexOf(receiptId);
            if (receiptIndex >= 0 && receiptIndex < tokens.length) {
              deadTokens.push(tokens[receiptIndex]);
            }
          }
          console.error(`[checkReceipts] Receipt error (${receipt.details?.error}):`, receipt.message);
        }
      }
    } catch (error) {
      console.error("[checkReceipts] Failed to fetch receipts:", error);
    }
  }

  if (deadTokens.length > 0) {
    await removeDeadTokens(userId, deadTokens);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. NEW CHAT MESSAGE
//    Trigger: conversations/{convId}/messages/{msgId} created
//    Notifies: the OTHER participant (not the sender), all their devices
// ═══════════════════════════════════════════════════════════════════════════════
export const onNewMessage = onDocumentCreated(
  "conversations/{convId}/messages/{msgId}",
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const senderId = data.senderId as string;
    const text = data.text as string;
    const convId = event.params.convId;

    // Skip system messages (welcome bot)
    if (senderId === "swapdog-team") return;

    // Get the conversation to find the other participant
    const convSnap = await db.collection("conversations").doc(convId).get();
    const convData = convSnap.data();
    if (!convData) return;

    const participantIds = (convData.participantIds as string[]) ?? [];
    const recipientId = participantIds.find((id) => id !== senderId);
    if (!recipientId) return;

    // Get sender name for the notification
    const senderName = await getUserDisplayName(senderId);

    // Get all of recipient's push tokens
    const tokens = await getUserTokens(recipientId);
    if (tokens.length === 0) return;

    // Increment unread count for badge
    const unreadCounts = (convData.unreadCounts as Record<string, number>) ?? {};
    const currentUnread = (unreadCounts[recipientId] ?? 0) + 1;

    // Update unread count in Firestore
    await db.collection("conversations").doc(convId).update({
      [`unreadCounts.${recipientId}`]: currentUnread,
    });

    // Send push to all devices
    const preview = text.length > 100 ? text.slice(0, 97) + "..." : text;
    await sendPushNotifications(
      recipientId,
      tokens,
      senderName,
      preview,
      {
        type: "new_message",
        conversationId: convId,
        otherUserId: senderId,
      },
      currentUnread
    );
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// 2. NEW HELP OFFER ON YOUR POST
//    Trigger: swapPosts/{postId} updated (respondedBy array grows)
//    Notifies: the post OWNER when someone new offers to help
// ═══════════════════════════════════════════════════════════════════════════════
export const onNewHelpOffer = onDocumentUpdated(
  "swapPosts/{postId}",
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;

    const postId = event.params.postId;

    // Check if respondedBy array grew (new help offer)
    const beforeRespondedBy = (before.respondedBy as Array<Record<string, unknown>>) ?? [];
    const afterRespondedBy = (after.respondedBy as Array<Record<string, unknown>>) ?? [];

    if (afterRespondedBy.length <= beforeRespondedBy.length) return;

    // Find the new responder(s)
    const beforeUserIds = new Set(beforeRespondedBy.map((r) => r.userId as string));
    const newResponders = afterRespondedBy.filter(
      (r) => !beforeUserIds.has(r.userId as string)
    );

    if (newResponders.length === 0) return;

    // Get post owner's push tokens
    const posterId = after.posterId as string;
    const tokens = await getUserTokens(posterId);
    if (tokens.length === 0) return;

    const dogName = (after.dogName as string) || "your dog";

    for (const responder of newResponders) {
      const responderName = (responder.userName as string) || "Someone";

      await sendPushNotifications(
        posterId,
        tokens,
        "New help offer! 🐾",
        `${responderName} offered to help watch ${dogName}`,
        {
          type: "new_help_offer",
          postId,
        }
      );
    }
  }
);

// ─── Helper: half-open interval overlap predicate ─────────────────────────────
function intervalsOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date
): boolean {
  return aStart.getTime() < bEnd.getTime() && aEnd.getTime() > bStart.getTime();
}

// ─── Helper: resolve a post's effective [start, end] caregiver window ──────────
// Mirrors the client isPostInProgress logic: a post with top-level startTime/
// endTime is time-precise; otherwise it anchors to the full calendar day(s).
// Returns null when the post lacks usable startDate/endDate Timestamps.
function resolveInterval(
  postData: Record<string, unknown>
): { start: Date; end: Date } | null {
  const rawStart = postData.startDate as admin.firestore.Timestamp | undefined;
  const rawEnd = postData.endDate as admin.firestore.Timestamp | undefined;
  if (!rawStart || typeof rawStart.toDate !== "function") return null;
  if (!rawEnd || typeof rawEnd.toDate !== "function") return null;

  const start = rawStart.toDate();
  const end = rawEnd.toDate();

  const startTime = postData.startTime as string | undefined;
  const endTime = postData.endTime as string | undefined;

  if (startTime) {
    const { hours, minutes } = parseTime12Str(startTime);
    start.setHours(hours, minutes, 0, 0);
  } else {
    start.setHours(0, 0, 0, 0);
  }

  if (endTime) {
    const { hours, minutes } = parseTime12Str(endTime);
    end.setHours(hours, minutes, 59, 999);
  } else {
    end.setHours(23, 59, 59, 999);
  }

  return { start, end };
}

// ─── Helper: readable label for a post (there is no top-level `title` field) ───
function describePost(postData: Record<string, unknown>): string {
  const dogNames = postData.dogNames as string[] | undefined;
  const dogName = postData.dogName as string | undefined;
  const dogLabel =
    dogNames && dogNames.length > 0
      ? dogNames.join(" & ")
      : dogName || "a booking";
  const posterName = postData.posterName as string | undefined;
  return posterName ? `${posterName}'s booking for ${dogLabel}` : dogLabel;
}

// ─── Helper: withdraw a helper's pending requests overlapping a new commitment ─
// When a user is accepted as caregiver they must not remain in the running for
// any OTHER open post whose time overlaps. Firestore can't filter inside the
// respondedBy[] array-of-maps, so we scan open posts (same constraint as the
// client getPendingPosts), arrayRemove the helper's entry from each overlapping
// post, and send the helper one heads-up push per withdrawal. The other post
// stays open for other helpers. Idempotent — arrayRemove of an absent entry is
// a no-op, so a CF retry can't double-withdraw.
//
// NOTE (follow-up, out of scope): this does NOT close the simultaneous-
// acceptance race where two owners approve the same helper on overlapping posts
// within milliseconds — both posts leave 'open' before either CF runs. Fully
// closing it needs a transactional claimPost callable that rejects a claim when
// the helper already holds an overlapping commitment.
async function withdrawOverlappingRequests(
  helperId: string,
  acceptedPostId: string,
  acceptedPostData: Record<string, unknown>
): Promise<void> {
  const acceptedInterval = resolveInterval(acceptedPostData);
  if (!acceptedInterval) {
    console.warn(
      `[withdrawOverlapping] Accepted post ${acceptedPostId} has no valid interval — skipping`
    );
    return;
  }

  // Cannot filter by respondedBy[].userId server-side — scan open posts.
  const openSnap = await db
    .collection("swapPosts")
    .where("status", "==", "open")
    .get();

  const batch = db.batch();
  const withdrawn: { postId: string; title: string }[] = [];

  for (const doc of openSnap.docs) {
    if (doc.id === acceptedPostId) continue;

    const data = doc.data();
    if (!data) continue;

    const respondedBy =
      (data.respondedBy as Array<Record<string, unknown>> | undefined) ?? [];
    const helperEntry = respondedBy.find(
      (r) => (r.userId as string) === helperId
    );
    if (!helperEntry) continue;

    const otherInterval = resolveInterval(data);
    if (!otherInterval) continue;

    if (
      !intervalsOverlap(
        acceptedInterval.start,
        acceptedInterval.end,
        otherInterval.start,
        otherInterval.end
      )
    ) {
      continue;
    }

    batch.update(doc.ref, {
      respondedBy: admin.firestore.FieldValue.arrayRemove(helperEntry),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    withdrawn.push({ postId: doc.id, title: describePost(data) });

    console.log(
      `[withdrawOverlapping] Withdrawing ${helperId}'s request on post ${doc.id} ` +
        `(overlap ${otherInterval.start.toISOString()}–${otherInterval.end.toISOString()})`
    );
  }

  if (withdrawn.length === 0) return;

  await batch.commit();
  console.log(
    `[withdrawOverlapping] Withdrew ${withdrawn.length} overlapping request(s) for ${helperId}`
  );

  // Heads-up push to the helper — best-effort, non-fatal.
  try {
    const tokens = await getUserTokens(helperId);
    if (tokens.length === 0) return;
    for (const { postId, title } of withdrawn) {
      await sendPushNotifications(
        helperId,
        tokens,
        "Heads up",
        `You're confirmed for an overlapping booking, so your pending request on "${title}" was withdrawn.`,
        {
          type: "reminder",
          postId,
        }
      );
    }
  } catch (error) {
    console.error(
      "[withdrawOverlapping] Failed to notify helper of withdrawal:",
      error
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. HELP CONFIRMED (post claimed)
//    Trigger: swapPosts/{postId} updated (status changes to 'claimed')
//    Notifies: the HELPER (claimedBy user) that they've been approved
// ═══════════════════════════════════════════════════════════════════════════════
export const onHelpConfirmed = onDocumentUpdated(
  "swapPosts/{postId}",
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;

    // Only fire when status transitions to 'claimed'
    if (before.status === "claimed" || after.status !== "claimed") return;

    const claimedBy = after.claimedBy as string | undefined;
    if (!claimedBy) return;

    const tokens = await getUserTokens(claimedBy);
    if (tokens.length === 0) return;

    const posterName = (after.posterName as string) || "Someone";
    const dogName = (after.dogName as string) || "their dog";

    await sendPushNotifications(
      claimedBy,
      tokens,
      "You're confirmed! 🎉",
      `${posterName} approved you to watch ${dogName}`,
      {
        type: "help_confirmed",
        postId: event.params.postId,
      }
    );

    // Schedule reminder notifications for all responsibilities
    try {
      await scheduleReminders(event.params.postId, after);
    } catch (error) {
      console.error("[onHelpConfirmed] Failed to schedule reminders:", error);
    }

    // Auto-withdraw this helper's pending requests on other open posts whose
    // time overlaps the just-accepted commitment (no caregiver double-booking).
    // Guarded so a withdrawal failure never breaks the confirm/reminder path.
    try {
      await withdrawOverlappingRequests(claimedBy, event.params.postId, after);
    } catch (error) {
      console.error(
        "[onHelpConfirmed] Failed to withdraw overlapping requests:",
        error
      );
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// 3b. BOOKING RESCHEDULED — regenerate reminders for the new date/time
//    Trigger: swapPosts/{postId} updated (already-claimed booking whose date moved)
//    Direct auto-reschedule (#58) overwrites startDate/endDate/startTime; the
//    existing unsent reminder docs still point at the OLD time, so we delete the
//    unsent ones and rebuild from the current post data. Idempotent.
// ═══════════════════════════════════════════════════════════════════════════════
export const onPostRescheduled = onDocumentUpdated(
  "swapPosts/{postId}",
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;

    // Only for bookings that were AND remain claimed — a fresh claim is handled
    // by onHelpConfirmed, which creates the initial reminders.
    if (before.status !== "claimed" || after.status !== "claimed") return;
    if (!after.claimedBy) return;

    const dateChanged =
      timestampMillis(before.startDate) !== timestampMillis(after.startDate) ||
      timestampMillis(before.endDate) !== timestampMillis(after.endDate) ||
      (before.startTime as string | undefined) !==
        (after.startTime as string | undefined);
    if (!dateChanged) return;

    try {
      await regenerateReminders(event.params.postId, after);
    } catch (error) {
      console.error(
        "[onPostRescheduled] Failed to regenerate reminders:",
        error
      );
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// 4. REFERRAL CODE USED — award 3 points to referrer
//    Trigger: users/{userId} updated (referredBy field set)
//    Notifies: the REFERRER with push notification + in-app reward flag
//    Awards: 3 points to referrer's balance + logs in pointsHistory
// ═══════════════════════════════════════════════════════════════════════════════
export const onReferralUsed = onDocumentUpdated(
  "users/{userId}",
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;

    // Only fire when referredBy transitions from empty/null to a real userId
    const hadReferrer = before.referredBy && (before.referredBy as string).length > 0;
    const hasReferrer = after.referredBy && (after.referredBy as string).length > 0;
    if (hadReferrer || !hasReferrer) return;

    const referrerId = after.referredBy as string;
    const newUserId = event.params.userId;
    const newUserName = (after.displayName as string) || "Someone";

    // Prevent self-referral
    if (referrerId === newUserId) return;

    const REFERRAL_REWARD = 3;

    try {
      // 1. Award 3 points to the referrer
      await db.collection("users").doc(referrerId).update({
        points: admin.firestore.FieldValue.increment(REFERRAL_REWARD),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // 2. Log in referrer's pointsHistory subcollection
      await db.collection("users").doc(referrerId).collection("pointsHistory").add({
        type: "referral",
        description: `Referral reward — ${newUserName} joined using your code`,
        points: REFERRAL_REWARD,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // 3. Set a pending reward flag so the app shows confetti on next open
      await db.collection("users").doc(referrerId).update({
        pendingReferralReward: {
          fromUserId: newUserId,
          fromUserName: newUserName,
          points: REFERRAL_REWARD,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      });

      // 4. Send push notification to referrer
      const tokens = await getUserTokens(referrerId);
      if (tokens.length > 0) {
        await sendPushNotifications(
          referrerId,
          tokens,
          "You earned 3 points! 🎉",
          `${newUserName} joined WatchDog using your referral code!`,
          {
            type: "referral_reward",
            fromUserId: newUserId,
          }
        );
      }

      console.log(`[onReferralUsed] Awarded ${REFERRAL_REWARD} pts to ${referrerId} for referring ${newUserId}`);
    } catch (error) {
      console.error("[onReferralUsed] Failed:", error);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 5. onPostCompleted — fires when a post status changes to "completed"
//    Sends push notifications to both owner and caregiver to leave a review.
//    Also sets pendingReview flag on both user docs for in-app popup.
// ─────────────────────────────────────────────────────────────────────────────
export const onPostCompleted = onDocumentUpdated(
  "swapPosts/{postId}",
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!before || !after) return;

    const postId = event.params.postId;
    const hadCompleted = before.status === "completed";
    const nowCompleted = after.status === "completed";

    // Only fire on the transition TO completed
    if (hadCompleted || !nowCompleted) return;

    const ownerId = after.posterId as string;
    const caregiverId = after.claimedBy as string | undefined;
    if (!caregiverId) return; // No caregiver assigned

    // Gather dog info
    const dogIds: string[] = (after.dogIds as string[]) ?? [after.dogId as string].filter(Boolean);
    const dogNames: string[] = (after.dogNames as string[]) ?? [after.dogName as string].filter(Boolean);

    try {
      const ownerDoc = await admin.firestore().doc(`users/${ownerId}`).get();
      const caregiverDoc = await admin.firestore().doc(`users/${caregiverId}`).get();
      const ownerData = ownerDoc.data();
      const caregiverData = caregiverDoc.data();
      if (!ownerData || !caregiverData) return;

      const ownerName = (ownerData.displayName as string) || "The owner";
      const caregiverName = (caregiverData.displayName as string) || "The caregiver";
      const dogNameStr = dogNames.length > 0 ? dogNames.join(" & ") : "your pup";

      const now = admin.firestore.FieldValue.serverTimestamp();

      // ── Set pendingReview on the OWNER (they review the caregiver) ──
      await admin.firestore().doc(`users/${ownerId}`).update({
        pendingReview: {
          postId,
          role: "owner",
          otherUserId: caregiverId,
          otherUserName: caregiverName,
          dogIds,
          dogNames,
          createdAt: now,
        },
      });

      // ── Set pendingReview on the CAREGIVER (they review the owner, with optional dog interaction notes) ──
      await admin.firestore().doc(`users/${caregiverId}`).update({
        pendingReview: {
          postId,
          role: "caregiver",
          otherUserId: ownerId,
          otherUserName: ownerName,
          dogIds,
          dogNames,
          createdAt: now,
        },
      });

      // ── Push notification to OWNER ──
      const ownerTokens = await getUserTokens(ownerId);
      if (ownerTokens.length > 0) {
        await sendPushNotifications(
          ownerId,
          ownerTokens,
          "How was the care? ⭐",
          `Leave a review for ${caregiverName} — how did they do with ${dogNameStr}?`,
          { type: "review_prompt", postId },
        );
      }

      // ── Push notification to CAREGIVER ──
      const caregiverTokens = await getUserTokens(caregiverId);
      if (caregiverTokens.length > 0) {
        await sendPushNotifications(
          caregiverId,
          caregiverTokens,
          "How did it go? ⭐",
          `Leave a review for ${ownerName}. You can optionally add notes about ${dogNameStr}.`,
          { type: "review_prompt", postId },
        );
      }

      console.log(`[onPostCompleted] Review prompts sent for post ${postId}`);
    } catch (error) {
      console.error("[onPostCompleted] Failed:", error);
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// REVIEW AGGREGATION — recompute rating + reviewCount on reviewed users & dogs
//    Firestore rules forbid the client from writing another user's doc or
//    another owner's dog doc, so submitted reviews never populate the reviewed
//    account/dog. These run with admin privileges and recompute aggregates
//    FROM SOURCE (not increment) so they are idempotent and self-healing.
// ═══════════════════════════════════════════════════════════════════════════════

/** Admin uid (Lior) — gate for the manual backfill callable. */
const ADMIN_UID = "5SUwrjPWPzbqf7qTYRS74Uj7CB82";

/** Person reviews aggregate across both the owner and caregiver target types. */
const PERSON_TARGET_TYPES = ["owner", "caregiver"] as const;

/** Round an average rating to one decimal place; 0 when there are no reviews. */
function roundRating(sum: number, count: number): number {
  if (count === 0) return 0;
  return Math.round((sum / count) * 10) / 10;
}

/** Sum the numeric `rating` field across a set of review docs. */
function sumRatings(
  docs: admin.firestore.QueryDocumentSnapshot[]
): { sum: number; count: number } {
  let sum = 0;
  for (const d of docs) {
    const rating = d.data().rating;
    if (typeof rating === "number") sum += rating;
  }
  return { sum, count: docs.length };
}

/** Recompute a person's rating/reviewCount from every owner+caregiver review about them. */
async function recomputePersonAggregate(revieweeId: string): Promise<void> {
  const snap = await db
    .collection("reviews")
    .where("revieweeId", "==", revieweeId)
    .where("targetType", "in", [...PERSON_TARGET_TYPES])
    .get();

  const { sum, count } = sumRatings(snap.docs);
  await db
    .doc(`users/${revieweeId}`)
    .set({ rating: roundRating(sum, count), reviewCount: count }, { merge: true });
}

/** Recompute a dog's rating/reviewCount from every dog review about it. */
async function recomputeDogAggregate(revieweeId: string, dogId: string): Promise<void> {
  const snap = await db
    .collection("reviews")
    .where("revieweeId", "==", revieweeId)
    .where("targetType", "==", "dog")
    .where("dogId", "==", dogId)
    .get();

  const { sum, count } = sumRatings(snap.docs);
  await db
    .doc(`dogs/${dogId}`)
    .set({ rating: roundRating(sum, count), reviewCount: count }, { merge: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// onReviewCreated — fires when a review doc is created; recomputes the reviewed
//   person's or dog's aggregate. Mirrors the onPostCompleted v2 trigger style.
// ─────────────────────────────────────────────────────────────────────────────
export const onReviewCreated = onDocumentCreated(
  "reviews/{reviewId}",
  async (event) => {
    const snap = event.data;
    const data = snap?.data();
    if (!data) return;

    const revieweeId = data.revieweeId as string | undefined;
    if (!revieweeId) return;

    const targetType = data.targetType as string | undefined;

    try {
      if (targetType === "owner" || targetType === "caregiver") {
        await recomputePersonAggregate(revieweeId);
        console.log(`[onReviewCreated] Recomputed person aggregate for ${revieweeId}`);
      } else if (targetType === "dog") {
        const dogId = data.dogId as string | undefined;
        if (!dogId) return;
        await recomputeDogAggregate(revieweeId, dogId);
        console.log(`[onReviewCreated] Recomputed dog aggregate for dog ${dogId}`);
      }
    } catch (error) {
      console.error("[onReviewCreated] Failed:", error);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// backfillReviewAggregates — admin-only callable that heals EXISTING reviews by
//   recomputing every person and dog aggregate from the full reviews collection.
//   Idempotent (recompute-from-source). Invoke once after deploy:
//     firebase functions:shell → backfillReviewAggregates({})  (as the admin)
//   or from an admin-authenticated client via httpsCallable.
// ─────────────────────────────────────────────────────────────────────────────
export const backfillReviewAggregates = functions.https.onCall(async (_data, context) => {
  const callerUid = context.auth?.uid;
  if (callerUid !== ADMIN_UID) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Only an admin may run backfillReviewAggregates."
    );
  }

  const snap = await db.collection("reviews").get();

  // Person aggregates keyed by revieweeId (owner + caregiver reviews).
  const personSums = new Map<string, { sum: number; count: number }>();
  // Dog aggregates keyed by dogId.
  const dogSums = new Map<string, { sum: number; count: number }>();

  for (const d of snap.docs) {
    const r = d.data();
    const revieweeId = r.revieweeId as string | undefined;
    const targetType = r.targetType as string | undefined;
    const rating = r.rating;
    if (!revieweeId || typeof rating !== "number") continue;

    if (targetType === "owner" || targetType === "caregiver") {
      const acc = personSums.get(revieweeId) ?? { sum: 0, count: 0 };
      acc.sum += rating;
      acc.count += 1;
      personSums.set(revieweeId, acc);
    } else if (targetType === "dog") {
      const dogId = r.dogId as string | undefined;
      if (!dogId) continue;
      const acc = dogSums.get(dogId) ?? { sum: 0, count: 0 };
      acc.sum += rating;
      acc.count += 1;
      dogSums.set(dogId, acc);
    }
  }

  let usersUpdated = 0;
  for (const [userId, { sum, count }] of personSums) {
    await db
      .doc(`users/${userId}`)
      .set({ rating: roundRating(sum, count), reviewCount: count }, { merge: true });
    usersUpdated += 1;
  }

  let dogsUpdated = 0;
  for (const [dogId, { sum, count }] of dogSums) {
    await db
      .doc(`dogs/${dogId}`)
      .set({ rating: roundRating(sum, count), reviewCount: count }, { merge: true });
    dogsUpdated += 1;
  }

  console.log(
    `[backfillReviewAggregates] Updated ${usersUpdated} users, ${dogsUpdated} dogs ` +
      `from ${snap.size} reviews`
  );
  return { usersUpdated, dogsUpdated, reviewsProcessed: snap.size };
});


/**
 * onFavoriteUserPost — notify users who have favorited the post creator
 * with notifyOnPost=true when that creator publishes a new post.
 *
 * Trigger: swap_posts document created
 * Reads: users/{uid}/favorites where notifyOnPost === true
 */
export const onFavoriteUserPost = onDocumentCreated(
  "swap_posts/{postId}",
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const data = snap.data();
    const creatorId = (data.posterId ?? data.creatorId) as string;
    const postId = event.params.postId;
    if (!creatorId) return;

    try {
      // Get creator's display name
      const creatorDoc = await admin.firestore().doc(`users/${creatorId}`).get();
      const creatorName = creatorDoc.data()?.displayName || "Someone you follow";

      // Find all users who have favorited this creator with notifyOnPost=true
      // We need to check each user's favorites subcollection.
      // Firestore doesn't support collectionGroup queries on subcollections with parent filters,
      // so we use a collectionGroup query on "favorites" where doc ID matches creatorId.
      const favSnap = await admin
        .firestore()
        .collectionGroup("favorites")
        .where("notifyOnPost", "==", true)
        .get();

      // Filter to only docs whose ID matches the creatorId
      const subscriberUids: string[] = [];
      for (const favDoc of favSnap.docs) {
        if (favDoc.id !== creatorId) continue;
        // Path: users/{subscriberUid}/favorites/{creatorId}
        const parentPath = favDoc.ref.parent.parent?.id;
        if (parentPath && parentPath !== creatorId) {
          subscriberUids.push(parentPath);
        }
      }

      if (subscriberUids.length === 0) return;

      // Get care type for the notification message
      const careType = data.careType as string | undefined;
      const careLabel = careType === "overnight"
        ? "overnight care"
        : careType === "daySitting"
          ? "day sitting"
          : "a swap";

      // Send push to each subscriber
      for (const uid of subscriberUids) {
        const tokens = await getUserTokens(uid);
        if (tokens.length > 0) {
          await sendPushNotifications(
            uid,
            tokens,
            `${creatorName} just posted! 🐾`,
            `${creatorName} is looking for ${careLabel}. Check it out!`,
            { type: "favorite_post", postId },
          );
        }
      }

      console.log(
        `[onFavoriteUserPost] Notified ${subscriberUids.length} subscribers for post ${postId} by ${creatorId}`
      );
    } catch (error) {
      console.error("[onFavoriteUserPost] Failed:", error);
    }
  }
);


// ═══════════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════════
// REMINDER SYSTEM — Push notifications for all responsibilities
//    Uses Intl.DateTimeFormat for timezone-aware Eastern time handling.
//    No process.env.TZ dependency — works reliably across Cloud Functions cold starts.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Timezone-aware date helpers ──────────────────────────────────────────────

/** Parse "3:00 PM" → { hours: 15, minutes: 0 } */
function parseTime12Str(t: string): { hours: number; minutes: number } {
  const m = t.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) {
    console.warn(`[parseTime12Str] Could not parse time string: "${t}", defaulting to 9:00 AM`);
    return { hours: 9, minutes: 0 };
  }
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (m[3].toUpperCase() === "PM" && h !== 12) h += 12;
  if (m[3].toUpperCase() === "AM" && h === 12) h = 0;
  return { hours: h, minutes: min };
}

/** Extract the calendar date (year, month, day) as seen in Eastern timezone */
function getEasternCalendarDate(d: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  return {
    year: Number(parts.find((p) => p.type === "year")!.value),
    month: Number(parts.find((p) => p.type === "month")!.value) - 1,
    day: Number(parts.find((p) => p.type === "day")!.value),
  };
}

/**
 * Build a UTC Date representing `timeStr` on the calendar date of `dateVal`
 * in America/New_York.  Handles EST/EDT automatically via Intl offset detection.
 *
 * Example: buildDateTimeET(June25Timestamp, "3:00 PM")
 *   → Date for 3 PM Eastern = 7 PM UTC (EDT) or 8 PM UTC (EST)
 */
function buildDateTimeET(
  dateVal: admin.firestore.Timestamp | Date | string,
  timeStr: string
): Date {
  const base =
    dateVal instanceof admin.firestore.Timestamp
      ? dateVal.toDate()
      : dateVal instanceof Date
        ? dateVal
        : new Date(dateVal);

  const { hours, minutes } = parseTime12Str(timeStr);
  const { year, month, day } = getEasternCalendarDate(base);

  // Place wall-clock values into a UTC date (naïve — wrong instant)
  const naiveUTC = new Date(Date.UTC(year, month, day, hours, minutes, 0, 0));

  // Detect the Eastern offset at this instant (4 for EDT, 5 for EST)
  const etHourStr = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hour12: false,
  }).format(naiveUTC);
  const etHour = Number(etHourStr) % 24;

  let offsetH = naiveUTC.getUTCHours() - etHour;
  if (offsetH < 0) offsetH += 24;

  // Shift forward by the offset to get the correct UTC instant
  return new Date(naiveUTC.getTime() + offsetH * 3_600_000);
}

/**
 * Return an array of anchor Dates for every calendar day in [start, end] (inclusive)
 * as seen in America/New_York.
 */
function getDatesInRangeET(start: Date, end: Date): Date[] {
  const toAnchor = (d: Date): Date => {
    const { year, month, day } = getEasternCalendarDate(d);
    return new Date(Date.UTC(year, month, day, 12, 0, 0)); // noon UTC anchor
  };

  const startAnchor = toAnchor(start);
  const endAnchor = toAnchor(end);

  const dates: Date[] = [];
  const current = new Date(startAnchor);
  while (current.getTime() <= endAnchor.getTime()) {
    dates.push(new Date(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

// ── Reminder data model ─────────────────────────────────────────────────────

interface ReminderDoc {
  postId: string;
  recipientId: string;
  type: string;
  title: string;
  body: string;
  sendAt: admin.firestore.Timestamp;
  sent: boolean;
  createdAt: admin.firestore.FieldValue;
}

// ── Repeat-schedule model (mirrors the client `RepeatSchedule` in models/types.ts) ──
interface RepeatSchedule {
  type: "daily" | "weekly" | "custom" | "specificDates";
  /** Day index for weekly (0=Sun ... 6=Sat) */
  weeklyDay?: number;
  /** Day indices for custom (0-6) */
  customDays?: number[];
  /** Whether all selected days share the same time or have individual times */
  timeMode?: "same" | "different";
  /** Per-day times as "h:mm AM/PM", keyed by day index (0-6). Only when timeMode='different'. */
  dayTimes?: Record<number, string>;
  /** ISO date strings ('YYYY-MM-DD') for specificDates type */
  specificDates?: string[];
}

/**
 * Whether a repeat-scheduled task fires on a given overnight day.
 * `dayAnchor` is a noon-UTC anchor carrying the ET calendar date (from getDatesInRangeET).
 * A missing/null schedule means a single occurrence → fire only on day 0 (or single-day stays).
 */
function firesOnDay(
  schedule: RepeatSchedule | null | undefined,
  dayAnchor: Date,
  dayIndex: number,
  totalDays: number
): boolean {
  if (!schedule) return totalDays === 1 || dayIndex === 0;

  const weekday = dayAnchor.getUTCDay();
  switch (schedule.type) {
    case "daily":
      return true;
    case "weekly":
      return weekday === (schedule.weeklyDay ?? 1);
    case "custom":
      return (schedule.customDays ?? []).includes(weekday);
    case "specificDates": {
      const y = dayAnchor.getUTCFullYear();
      const m = String(dayAnchor.getUTCMonth() + 1).padStart(2, "0");
      const d = String(dayAnchor.getUTCDate()).padStart(2, "0");
      return (schedule.specificDates ?? []).includes(`${y}-${m}-${d}`);
    }
    default:
      return totalDays === 1 || dayIndex === 0;
  }
}

/**
 * Resolve the clock time for a task on a specific day, honouring a `different`
 * per-day time override when present; otherwise the slot/session default time.
 */
function timeForDay(
  schedule: RepeatSchedule | null | undefined,
  dayAnchor: Date,
  fallbackTime: string
): string {
  if (schedule?.timeMode === "different") {
    const override = schedule.dayTimes?.[dayAnchor.getUTCDay()];
    if (override) return override;
  }
  return fallbackTime;
}

// ── Core scheduling logic ───────────────────────────────────────────────────

/** Milliseconds for a Firestore Timestamp-like value, or null when absent/invalid. */
function timestampMillis(v: unknown): number | null {
  if (
    v &&
    typeof (v as admin.firestore.Timestamp).toMillis === "function"
  ) {
    return (v as admin.firestore.Timestamp).toMillis();
  }
  return null;
}

/**
 * Delete a post's still-unsent reminder docs and rebuild them from the current
 * post data. Used after a reschedule so reminders track the new date/time.
 * Idempotent: re-running deletes the freshly-created unsent docs and recreates
 * the identical set, so it never duplicates reminders for the same event.
 * Already-sent reminders are left untouched.
 */
async function regenerateReminders(
  postId: string,
  postData: Record<string, unknown>
): Promise<void> {
  const unsent = await db
    .collection("reminders")
    .where("postId", "==", postId)
    .where("sent", "==", false)
    .get();

  const BATCH_LIMIT = 500;
  for (let i = 0; i < unsent.docs.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    for (const d of unsent.docs.slice(i, i + BATCH_LIMIT)) batch.delete(d.ref);
    await batch.commit();
  }

  await scheduleReminders(postId, postData);

  console.log(
    `[regenerateReminders] Rebuilt reminders for post ${postId} ` +
      `(deleted ${unsent.size} unsent)`
  );
}

/**
 * Schedule all reminder notifications for a confirmed post.
 * Creates reminders for BOTH the caregiver AND the dog owner.
 */
async function scheduleReminders(
  postId: string,
  postData: Record<string, unknown>
): Promise<void> {
  const caregiverId = postData.claimedBy as string;
  const ownerId = postData.posterId as string;
  if (!caregiverId) return;

  // Both owner and caregiver get reminders
  const recipientIds: string[] = [caregiverId];
  if (ownerId && ownerId !== caregiverId) recipientIds.push(ownerId);

  const now = new Date();
  const dogName = (postData.dogName as string) || "the dog";
  const dogNames = postData.dogNames as string[] | undefined;
  const displayDogName =
    dogNames && dogNames.length > 1 ? dogNames.join(" & ") : dogName;

  const careType = postData.careType as string | null;
  const addOns = (postData.addOnCareTypes as string[]) || [];
  const startDate = postData.startDate;
  const endDate = postData.endDate;
  const startTime = (postData.startTime as string) || "9:00 AM";

  const reminders: ReminderDoc[] = [];

  /** Helper: push 1-hour-before and 10-minute-before reminders for ALL recipients */
  const addReminder = (
    eventTime: Date,
    type: string,
    title: string,
    body: string
  ) => {
    const oneHourBefore = new Date(eventTime.getTime() - 60 * 60 * 1000);
    const tenMinBefore = new Date(eventTime.getTime() - 10 * 60 * 1000);

    for (const recipientId of recipientIds) {
      if (oneHourBefore > now) {
        reminders.push({
          postId,
          recipientId,
          type: `${type}_1h`,
          title,
          body: `In 1 hour: ${body}`,
          sendAt: admin.firestore.Timestamp.fromDate(oneHourBefore),
          sent: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      if (tenMinBefore > now) {
        reminders.push({
          postId,
          recipientId,
          type: `${type}_10m`,
          title,
          body: `In 10 minutes: ${body}`,
          sendAt: admin.firestore.Timestamp.fromDate(tenMinBefore),
          sent: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }
  };

  /** Helper: push a single at-time reminder for ALL recipients */
  const addDirectReminder = (
    sendAt: Date,
    type: string,
    title: string,
    body: string
  ) => {
    if (sendAt <= now) return;
    for (const recipientId of recipientIds) {
      reminders.push({
        postId,
        recipientId,
        type,
        title,
        body,
        sendAt: admin.firestore.Timestamp.fromDate(sendAt),
        sent: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  };

  // Helper: get days array for overnight stays, or null for single-day
  const getOvernightDays = (): Date[] | null => {
    if (careType === "overnight" && startDate && endDate) {
      return getDatesInRangeET(
        (startDate as admin.firestore.Timestamp).toDate(),
        (endDate as admin.firestore.Timestamp).toDate()
      );
    }
    return null;
  };

  const overnightDays = getOvernightDays();

  // ── 1. Main session reminders (overnight / daySitting) ──
  if (
    (careType === "overnight" || careType === "daySitting") &&
    startDate
  ) {
    const sessionStart = buildDateTimeET(
      startDate as admin.firestore.Timestamp,
      startTime
    );
    addReminder(
      sessionStart,
      "session_start",
      "⏰ Time to go!",
      `Your ${careType === "overnight" ? "overnight stay" : "day sitting"} with ${displayDogName} is starting`
    );
  }

  // ── 1b. Main session reminders (standalone feeding/walk/play/medication) ──
  // These are single-care-type posts where the care IS the session (not an add-on),
  // so they need their own 1h/10min reminders for both parties. Event time comes
  // from the post's slot/session time, falling back to startTime.
  const STANDALONE_CARE: Record<
    string,
    { title: string; body: string }
  > = {
    feeding: { title: "🍽️ Feeding time!", body: `Time to feed ${displayDogName}` },
    dogWalking: { title: "🐕 Walk time!", body: `Time to walk ${displayDogName}` },
    playtime: {
      title: "🎾 Play session!",
      body: `Time for ${displayDogName}'s play session`,
    },
    medication: {
      title: "💊 Medication time!",
      body: `Time to give ${displayDogName} medication`,
    },
  };

  if (careType && STANDALONE_CARE[careType] && startDate) {
    // Resolve the event clock time from the post's slot/session, else startTime.
    let eventTimeStr = startTime;
    if (careType === "feeding") {
      const slots = postData.feedingSlots as { time?: string }[] | undefined;
      eventTimeStr =
        (postData.feedingTime as string) || slots?.[0]?.time || startTime;
    } else if (careType === "dogWalking") {
      const sessions = postData.walkSessions as
        | { startTime?: string | null }[]
        | undefined;
      eventTimeStr = sessions?.[0]?.startTime || startTime;
    } else if (careType === "playtime") {
      const sessions = postData.playSessions as
        | { startTime?: string | null }[]
        | undefined;
      eventTimeStr = sessions?.[0]?.startTime || startTime;
    } else if (careType === "medication") {
      const slots = postData.medicationSlots as { time?: string }[] | undefined;
      eventTimeStr = slots?.[0]?.time || startTime;
    }

    const eventTime = buildDateTimeET(
      startDate as admin.firestore.Timestamp,
      eventTimeStr
    );
    const meta = STANDALONE_CARE[careType];
    addReminder(eventTime, `session_${careType}`, meta.title, meta.body);
  }

  // ── 2. Feeding reminders ──
  if (addOns.includes("feeding")) {
    const feedingSlots =
      (postData.feedingSlots as {
        time: string;
        repeatSchedule?: RepeatSchedule | null;
      }[]) || [];

    if (overnightDays) {
      for (let i = 0; i < overnightDays.length; i++) {
        for (const slot of feedingSlots) {
          if (
            firesOnDay(
              slot.repeatSchedule,
              overnightDays[i],
              i,
              overnightDays.length
            )
          ) {
            const feedTime = buildDateTimeET(
              overnightDays[i],
              timeForDay(slot.repeatSchedule, overnightDays[i], slot.time)
            );
            addReminder(
              feedTime,
              "feeding",
              "🍽️ Feeding time!",
              `Time to feed ${displayDogName}`
            );
          }
        }
      }
    } else if (startDate) {
      for (const slot of feedingSlots) {
        const feedTime = buildDateTimeET(
          startDate as admin.firestore.Timestamp,
          slot.time
        );
        addReminder(
          feedTime,
          "feeding",
          "🍽️ Feeding time!",
          `Time to feed ${displayDogName}`
        );
      }
    }
  }

  // ── 3. Walk reminders (reads walkSessions[], not walkStartTime) ──
  if (addOns.includes("dogWalking")) {
    const walkSessions =
      (postData.walkSessions as {
        startTime?: string | null;
        repeatSchedule?: RepeatSchedule | null;
      }[]) || [];

    if (overnightDays) {
      for (let i = 0; i < overnightDays.length; i++) {
        for (const session of walkSessions) {
          if (!session.startTime) continue;
          if (
            firesOnDay(
              session.repeatSchedule,
              overnightDays[i],
              i,
              overnightDays.length
            )
          ) {
            const walkTime = buildDateTimeET(
              overnightDays[i],
              timeForDay(
                session.repeatSchedule,
                overnightDays[i],
                session.startTime
              )
            );
            addReminder(
              walkTime,
              "walk",
              "🐕 Walk time!",
              `Time to walk ${displayDogName}`
            );
          }
        }
      }
    } else if (startDate) {
      for (const session of walkSessions) {
        if (!session.startTime) continue;
        const walkTime = buildDateTimeET(
          startDate as admin.firestore.Timestamp,
          session.startTime
        );
        addReminder(
          walkTime,
          "walk",
          "🐕 Walk time!",
          `Time to walk ${displayDogName}`
        );
      }
    }
  }

  // ── 4. Playtime reminders (reads playSessions[], not playtimeFlexible) ──
  if (addOns.includes("playtime")) {
    const playSessions =
      (postData.playSessions as {
        flexible?: boolean;
        startTime?: string | null;
        durationMins?: number;
        repeatSchedule?: RepeatSchedule | null;
      }[]) || [];

    for (const session of playSessions) {
      if (session.flexible) {
        // Flexible playtime → morning reminder at 8 AM
        const totalMins = session.durationMins ?? 0;
        const durationText =
          totalMins >= 60
            ? `${Math.floor(totalMins / 60)}h${totalMins % 60 > 0 ? ` ${totalMins % 60}m` : ""}`
            : `${totalMins} minutes`;

        if (overnightDays) {
          for (let i = 0; i < overnightDays.length; i++) {
            if (
              firesOnDay(
                session.repeatSchedule,
                overnightDays[i],
                i,
                overnightDays.length
              )
            ) {
              const morning = buildDateTimeET(overnightDays[i], "8:00 AM");
              addDirectReminder(
                morning,
                "playtime_morning",
                "🎾 Playtime today!",
                `Remember to play with ${displayDogName} for ${durationText} today`
              );
            }
          }
        } else if (startDate) {
          const morning = buildDateTimeET(
            startDate as admin.firestore.Timestamp,
            "8:00 AM"
          );
          addDirectReminder(
            morning,
            "playtime_morning",
            "🎾 Playtime today!",
            `Remember to play with ${displayDogName} for ${durationText} today`
          );
        }
      } else if (session.startTime) {
        // Fixed-time playtime
        if (overnightDays) {
          for (let i = 0; i < overnightDays.length; i++) {
            if (
              firesOnDay(
                session.repeatSchedule,
                overnightDays[i],
                i,
                overnightDays.length
              )
            ) {
              const playTime = buildDateTimeET(
                overnightDays[i],
                timeForDay(
                  session.repeatSchedule,
                  overnightDays[i],
                  session.startTime!
                )
              );
              addReminder(
                playTime,
                "playtime",
                "🎾 Play session!",
                `Time for ${displayDogName}'s play session`
              );
            }
          }
        } else if (startDate) {
          const playTime = buildDateTimeET(
            startDate as admin.firestore.Timestamp,
            session.startTime
          );
          addReminder(
            playTime,
            "playtime",
            "🎾 Play session!",
            `Time for ${displayDogName}'s play session`
          );
        }
      }
    }
  }

  // ── 5. Medication reminders (NEW — reads medicationSlots[]) ──
  if (addOns.includes("medication")) {
    const medSlots =
      (postData.medicationSlots as {
        time: string;
        details?: string;
        repeatSchedule?: RepeatSchedule | null;
      }[]) || [];

    if (overnightDays) {
      for (let i = 0; i < overnightDays.length; i++) {
        for (const slot of medSlots) {
          if (
            firesOnDay(
              slot.repeatSchedule,
              overnightDays[i],
              i,
              overnightDays.length
            )
          ) {
            const medTime = buildDateTimeET(
              overnightDays[i],
              timeForDay(slot.repeatSchedule, overnightDays[i], slot.time)
            );
            addReminder(
              medTime,
              "medication",
              "💊 Medication time!",
              `Time to give ${displayDogName} medication${slot.details ? `: ${slot.details}` : ""}`
            );
          }
        }
      }
    } else if (startDate) {
      for (const slot of medSlots) {
        const medTime = buildDateTimeET(
          startDate as admin.firestore.Timestamp,
          slot.time
        );
        addReminder(
          medTime,
          "medication",
          "💊 Medication time!",
          `Time to give ${displayDogName} medication${slot.details ? `: ${slot.details}` : ""}`
        );
      }
    }
  }

  // ── Write all reminders to Firestore (batched, 500-doc chunks) ──
  if (reminders.length === 0) {
    console.log(
      `[scheduleReminders] No future reminders to create for post ${postId}`
    );
    return;
  }

  const BATCH_LIMIT = 500;
  for (let i = 0; i < reminders.length; i += BATCH_LIMIT) {
    const chunk = reminders.slice(i, i + BATCH_LIMIT);
    const batch = db.batch();
    for (const reminder of chunk) {
      batch.set(db.collection("reminders").doc(), reminder);
    }
    await batch.commit();
  }

  console.log(
    `[scheduleReminders] Created ${reminders.length} reminders for post ${postId} ` +
      `(${recipientIds.length} recipients: caregiver + ${recipientIds.length > 1 ? "owner" : "same user"})`
  );
}

// ─── Scheduled function: process due reminders every 5 minutes ────────────────
export const processReminders = onSchedule(
  { schedule: "every 5 minutes", timeoutSeconds: 120 },
  async () => {
    const now = admin.firestore.Timestamp.now();

    const dueReminders = await db
      .collection("reminders")
      .where("sent", "==", false)
      .where("sendAt", "<=", now)
      .limit(100)
      .get();

    if (dueReminders.empty) return;

    console.log(
      `[processReminders] Processing ${dueReminders.size} due reminders`
    );

    for (const doc of dueReminders.docs) {
      const data = doc.data();
      const recipientId = data.recipientId as string;
      const title = data.title as string;
      const body = data.body as string;
      const postId = data.postId as string;
      const type = data.type as string;

      try {
        const tokens = await getUserTokens(recipientId);
        if (tokens.length > 0) {
          await sendPushNotifications(recipientId, tokens, title, body, {
            type: "reminder",
            reminderType: type,
            postId,
          });
        }
        // Mark as sent
        await doc.ref.update({
          sent: true,
          sentAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (error) {
        console.error(
          `[processReminders] Failed for reminder ${doc.id}:`,
          error
        );
      }
    }
  }
);


// ═══════════════════════════════════════════════════════════════════════════════
// ACCOUNT DELETION CLEANUP
//    Trigger: Firebase Auth user deleted
//    Wipes: swapPosts, reminders, dogs, reviews, conversations, user doc + subs
// ═══════════════════════════════════════════════════════════════════════════════

/** Delete all documents in a subcollection (handles batching for large collections) */
async function deleteSubcollection(parentPath: string, subcollection: string): Promise<number> {
  const snap = await db.collection(`${parentPath}/${subcollection}`).limit(500).get();
  if (snap.empty) return 0;
  const batch = db.batch();
  snap.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
  return snap.size + (snap.size === 500 ? await deleteSubcollection(parentPath, subcollection) : 0);
}

/** Delete all documents matching a query (batched) */
async function deleteQueryResults(q: admin.firestore.Query): Promise<number> {
  const snap = await q.limit(500).get();
  if (snap.empty) return 0;
  const batch = db.batch();
  snap.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
  return snap.size + (snap.size === 500 ? await deleteQueryResults(q) : 0);
}

export const onUserDeleted = functions.auth.user().onDelete(async (user) => {
  const userId = user.uid;
  console.log(`[onUserDeleted] Cleaning up data for user ${userId}`);

  const results: Record<string, number> = {};

  try {
    // 1. Delete all posts by this user + their reminders
    const postsSnap = await db.collection("swapPosts")
      .where("posterId", "==", userId).get();
    if (!postsSnap.empty) {
      const postIds = postsSnap.docs.map((d) => d.id);
      // Delete reminders for these posts
      for (const postId of postIds) {
        const count = await deleteQueryResults(
          db.collection("reminders").where("postId", "==", postId)
        );
        results.reminders = (results.reminders ?? 0) + count;
      }
      // Delete the posts themselves
      const batch = db.batch();
      postsSnap.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      results.swapPosts = postsSnap.size;
    }

    // 2. Delete reminders where user is the recipient (sitter-side)
    const sitterReminders = await deleteQueryResults(
      db.collection("reminders").where("recipientId", "==", userId)
    );
    results.sitterReminders = sitterReminders;

    // 3. Delete user's dogs
    const dogsCount = await deleteQueryResults(
      db.collection("dogs").where("ownerId", "==", userId)
    );
    results.dogs = dogsCount;

    // 4. Delete reviews written by or about this user
    const reviewsByCount = await deleteQueryResults(
      db.collection("reviews").where("reviewerId", "==", userId)
    );
    const reviewsOfCount = await deleteQueryResults(
      db.collection("reviews").where("revieweeId", "==", userId)
    );
    results.reviews = reviewsByCount + reviewsOfCount;

    // 5. Delete review backups
    await deleteQueryResults(
      db.collection("reviews_backup").where("reviewerId", "==", userId)
    );
    await deleteQueryResults(
      db.collection("reviews_backup").where("revieweeId", "==", userId)
    );

    // 6. Delete conversations + their messages subcollection
    const convsSnap = await db.collection("conversations")
      .where("participantIds", "array-contains", userId).get();
    if (!convsSnap.empty) {
      for (const convDoc of convsSnap.docs) {
        await deleteSubcollection(`conversations/${convDoc.id}`, "messages");
        await convDoc.ref.delete();
      }
      results.conversations = convsSnap.size;
    }

    // 7. Delete blocks by or against this user
    await deleteQueryResults(
      db.collection("blocks").where("blockerId", "==", userId)
    );
    await deleteQueryResults(
      db.collection("blocks").where("blockedId", "==", userId)
    );

    // 8. Delete swap requests (legacy)
    await deleteQueryResults(
      db.collection("swapRequests").where("requesterId", "==", userId)
    );
    await deleteQueryResults(
      db.collection("swapRequests").where("receiverId", "==", userId)
    );

    // 9. Delete user doc + subcollections (pointsHistory, favorites)
    await deleteSubcollection(`users/${userId}`, "pointsHistory");
    await deleteSubcollection(`users/${userId}`, "favorites");
    await db.doc(`users/${userId}`).delete();
    results.userDoc = 1;

    // 10. Delete referral codes created by this user
    await deleteQueryResults(
      db.collection("referral_codes").where("creatorId", "==", userId)
    );

    console.log(`[onUserDeleted] Cleanup complete for ${userId}:`, JSON.stringify(results));
  } catch (error) {
    console.error(`[onUserDeleted] Failed for ${userId}:`, error);
  }
});
