import * as admin from "firebase-admin";
import { onDocumentCreated, onDocumentUpdated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { setGlobalOptions } from "firebase-functions/v2/options";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as functionsV1 from "firebase-functions/v1";
import Expo, { ExpoPushMessage, ExpoPushTicket, ExpoPushReceipt } from "expo-server-sdk";
import { geohashForLocation } from "geofire-common";
import { Webhook } from "svix";
import twilio from "twilio";
import * as crypto from "crypto";


admin.initializeApp();
const db = admin.firestore();

// Every v2 callable rejects requests that do not carry a valid Firebase App
// Check token. HTTP webhooks and background triggers are unaffected.
setGlobalOptions({ enforceAppCheck: true });

const twilioAccountSid = defineSecret("TWILIO_ACCOUNT_SID");
const twilioAuthToken = defineSecret("TWILIO_AUTH_TOKEN");
const twilioVerifyServiceSid = defineSecret("TWILIO_VERIFY_SERVICE_SID");
const googlePlacesApiKey = defineSecret("GOOGLE_PLACES_API_KEY");
const superwallWebhookSecret = defineSecret("SUPERWALL_WEBHOOK_SECRET");
const expoAccessToken = defineSecret("EXPO_ACCESS_TOKEN");

const REFERRAL_COLLECTION = "referral_codes";
const PROMO_CODES = new Set(["WATCHDOGFREE"]);
const PHONE_SIGNUP_TICKET_COLLECTION = "phoneSignupTickets";
const PHONE_SIGNUP_TICKET_TTL_MS = 10 * 60 * 1000;
const SYSTEM_SENDER_ID = "swapdog-team";
const CURRENT_CONTRACT_VERSION = "1.0";

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
  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
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

    transaction.set(ref, {
      phoneHash: hashPhoneNumber(phoneNumber),
      sends: nextSends,
      windowStart: shouldResetWindow ? now : windowStart,
      lastSentAt: now,
      updatedAt: now,
    }, { merge: true });
  });
}

async function generateReferralCodeForUser(userId: string): Promise<string> {
  const existingUser = await db.collection("users").doc(userId).get();
  const existingCode = existingUser.data()?.referralCode as string | undefined;
  if (existingCode) return existingCode;

  const ownerRef = db.collection("referralCodeOwners").doc(userId);
  const existingOwner = await ownerRef.get();
  const reservedCode = existingOwner.data()?.code as string | undefined;
  if (reservedCode) return reservedCode;

  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 8; attempt += 1) {
    let code = "";
    for (let i = 0; i < 8; i += 1) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    const collision = await db.collection(REFERRAL_COLLECTION).where("code", "==", code).limit(1).get();
    if (!collision.empty) continue;

    const codeRef = db.collection(REFERRAL_COLLECTION).doc(code);
    try {
      return await db.runTransaction(async (transaction) => {
        const [ownerSnap, codeSnap] = await Promise.all([
          transaction.get(ownerRef),
          transaction.get(codeRef),
        ]);
        const ownerCode = ownerSnap.data()?.code as string | undefined;
        if (ownerCode) return ownerCode;
        if (codeSnap.exists) {
          throw new Error("referral-code-collision");
        }

        const now = admin.firestore.Timestamp.now();
        transaction.create(codeRef, {
          code,
          createdBy: userId,
          isActive: true,
          usedBy: [],
          maxUses: 10,
          usedCount: 0,
          createdAt: now,
        });
        transaction.create(ownerRef, {
          code,
          userId,
          createdAt: now,
        });
        return code;
      });
    } catch (error) {
      if (error instanceof Error && error.message === "referral-code-collision") {
        continue;
      }
      throw error;
    }
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
    ? new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
    : undefined;

  if (PROMO_CODES.has(usedCode)) {
    return { usedCode, freeAccessUntil };
  }

  const codeQuery = db
    .collection(REFERRAL_COLLECTION)
    .where("code", "==", usedCode)
    .limit(1);
  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(codeQuery);
    const codeDoc = snap.docs[0];
    const data = codeDoc?.data();
    if (!codeDoc || !data) return {};

    const usedCount = typeof data.usedCount === "number" ? data.usedCount : 0;
    const maxUses = typeof data.maxUses === "number" ? data.maxUses : 0;
    const createdBy = data.createdBy as string | undefined;
    const usedBy = Array.isArray(data.usedBy) ? data.usedBy as string[] : [];
    if (
      data.isActive !== true
      || usedCount >= maxUses
      || !createdBy
      || createdBy === userId
      || usedBy.includes(userId)
    ) {
      return {};
    }

    transaction.update(codeDoc.ref, {
      usedCount: usedCount + 1,
      usedBy: [...usedBy, userId],
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { referredBy: createdBy, usedCode };
  });
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

// ═══════════════════════════════════════════════════════════════════════════════
// Security boundary: public projections and privileged mutations
// ═══════════════════════════════════════════════════════════════════════════════

type DocumentData = Record<string, unknown>;

function requiredString(value: unknown, field: string, maxLength = 256): string {
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", `${field} is required.`);
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) {
    throw new HttpsError("invalid-argument", `${field} is invalid.`);
  }
  return trimmed;
}

function optionalString(value: unknown, maxLength: number): string | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", "Text value is invalid.");
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new HttpsError("invalid-argument", "Text value is too long.");
  }
  return trimmed || undefined;
}

function requireUid(request: { auth?: { uid: string } | null }): string {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Please sign in and try again.");
  }
  return uid;
}

async function requireActiveUser(uid: string): Promise<DocumentData> {
  const userSnap = await db.collection("users").doc(uid).get();
  const userData = userSnap.data();
  if (
    !userData
    || userData.accountStatus !== "active"
    || userData.isOnboarded !== true
    || !hasCurrentAccess(userData as DocumentData)
  ) {
    throw new HttpsError("permission-denied", "Your account is not active.");
  }
  return userData as DocumentData;
}

async function requireProvisionedUser(uid: string): Promise<DocumentData> {
  const userSnap = await db.collection("users").doc(uid).get();
  const userData = userSnap.data();
  if (!userData) {
    throw new HttpsError("permission-denied", "Complete phone sign-up first.");
  }
  return userData as DocumentData;
}

function roundedPublicLocation(value: unknown): {
  location?: { latitude: number; longitude: number };
  locationGeohash?: string;
} {
  if (!value || typeof value !== "object") return {};
  const raw = value as { latitude?: unknown; longitude?: unknown };
  if (typeof raw.latitude !== "number" || typeof raw.longitude !== "number") return {};
  if (
    !Number.isFinite(raw.latitude)
    || !Number.isFinite(raw.longitude)
    || raw.latitude < -90
    || raw.latitude > 90
    || raw.longitude < -180
    || raw.longitude > 180
  ) {
    return {};
  }

  // Two decimals is roughly 0.7 miles at NYC latitude. The exact coordinate
  // remains only in users/{uid} and swapPosts/{id}.
  const latitude = Math.round(raw.latitude * 100) / 100;
  const longitude = Math.round(raw.longitude * 100) / 100;
  return {
    location: { latitude, longitude },
    locationGeohash: geohashForLocation([latitude, longitude]),
  };
}

function copyDefined(source: DocumentData, keys: string[]): DocumentData {
  const result: DocumentData = {};
  for (const key of keys) {
    if (source[key] !== undefined) result[key] = source[key];
  }
  return result;
}

function buildPublicProfile(data: DocumentData): DocumentData | null {
  if (
    data.accountStatus !== "active"
    || data.isOnboarded !== true
    || !hasCurrentAccess(data)
  ) return null;

  const location = roundedPublicLocation(data.location);
  return {
    ...copyDefined(data, [
      "displayName",
      "photoURL",
      "bio",
      "instagramHandle",
      "locationName",
      "rating",
      "reviewCount",
      "createdAt",
    ]),
    ...location,
    accountStatus: "active",
    isOnboarded: true,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

function sanitizeWalkSession(value: unknown): DocumentData | null {
  if (!value || typeof value !== "object") return null;
  return copyDefined(value as DocumentData, [
    "flexible",
    "startTime",
    "endTime",
    "durationMins",
    "dogIds",
    "repeatSchedule",
    "repeatDaily",
  ]);
}

function sanitizeFeedingSlot(value: unknown): DocumentData | null {
  if (!value || typeof value !== "object") return null;
  return copyDefined(value as DocumentData, [
    "time",
    "repeatSchedule",
    "daily",
    "dogIds",
  ]);
}

function sanitizeMedicationSlot(value: unknown): DocumentData | null {
  if (!value || typeof value !== "object") return null;
  return copyDefined(value as DocumentData, [
    "time",
    "extraTimes",
    "repeatSchedule",
    "daily",
    "dogIds",
  ]);
}

function sanitizedArray(
  value: unknown,
  sanitizer: (entry: unknown) => DocumentData | null
): DocumentData[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map(sanitizer).filter((entry): entry is DocumentData => entry != null);
}

function buildPublicPost(data: DocumentData): DocumentData | null {
  if (data.status !== "open" && data.status !== "claimed") return null;

  const location = roundedPublicLocation(data.posterLocation);
  const result: DocumentData = {
    ...copyDefined(data, [
      "posterId",
      "posterName",
      "posterPhotoURL",
      "posterLocationName",
      "dogId",
      "dogName",
      "dogBreed",
      "dogPhotoURL",
      "dogIds",
      "dogNames",
      "dogBreeds",
      "dogPhotoURLs",
      "startDate",
      "endDate",
      "compensationType",
      "pointsCost",
      "paymentAmount",
      "paymentRate",
      "totalPayment",
      "totalUnits",
      "careType",
      "pointsOffered",
      "walkDurationMinutes",
      "feedingTime",
      "startTime",
      "endTime",
      "addOnCareTypes",
      "overnightLocation",
      "sitterTransport",
      "walkDurationMins",
      "status",
      "pointsDisabled",
      "createdAt",
    ]),
    ...location,
    // Free text, addresses, instructions, medication details, photos, helper
    // identity, responses, and reminder IDs intentionally never enter this doc.
    careDetails: "",
    carePhotos: [],
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    projectionVersion: 1,
  };

  const walkSessions = sanitizedArray(data.walkSessions, sanitizeWalkSession);
  const feedingSlots = sanitizedArray(data.feedingSlots, sanitizeFeedingSlot);
  const playSessions = sanitizedArray(data.playSessions, sanitizeWalkSession);
  const medicationSlots = sanitizedArray(data.medicationSlots, sanitizeMedicationSlot);
  if (walkSessions) result.walkSessions = walkSessions;
  if (feedingSlots) result.feedingSlots = feedingSlots;
  if (playSessions) result.playSessions = playSessions;
  if (medicationSlots) result.medicationSlots = medicationSlots;
  return result;
}

export const syncPublicProfile = onDocumentWritten(
  "users/{userId}",
  async (event) => {
    const userId = event.params.userId;
    const target = db.collection("publicProfiles").doc(userId);
    const data = event.data?.after.data() as DocumentData | undefined;
    if (!data) {
      await target.delete();
      return;
    }

    const projection = buildPublicProfile(data);
    if (!projection) {
      await target.delete();
      await deleteQueryResults(
        db.collection("publicSwapPosts").where("posterId", "==", userId)
      );
      return;
    }
    await target.set(projection);
  }
);

export const syncPublicSwapPost = onDocumentWritten(
  "swapPosts/{postId}",
  async (event) => {
    const postId = event.params.postId;
    const target = db.collection("publicSwapPosts").doc(postId);
    const data = event.data?.after.data() as DocumentData | undefined;
    if (!data) {
      await target.delete();
      return;
    }

    const projection = buildPublicPost(data);
    const posterId = data.posterId;
    const posterSnap = typeof posterId === "string"
      ? await db.collection("users").doc(posterId).get()
      : null;
    const poster = posterSnap?.data() as DocumentData | undefined;
    if (
      !projection
      || !poster
      || poster.accountStatus !== "active"
      || poster.isOnboarded !== true
      || !hasCurrentAccess(poster)
    ) {
      await target.delete();
      return;
    }
    await target.set(projection);
  }
);

function responseDocumentId(postId: string, userId: string): string {
  return `${postId}_${userId}`;
}

async function assertUsersNotBlocked(userIdA: string, userIdB: string): Promise<void> {
  const [forward, reverse] = await Promise.all([
    db.collection("blocks").doc(`${userIdA}_${userIdB}`).get(),
    db.collection("blocks").doc(`${userIdB}_${userIdA}`).get(),
  ]);
  if (forward.exists || reverse.exists) {
    throw new HttpsError("permission-denied", "You cannot interact with this member.");
  }
}

const USER_MESSAGE_TYPES = new Set([
  "text",
  "reschedule",
  "reschedule_request",
  "image",
  "help_request",
]);
const MESSAGE_METADATA_FIELDS = new Set([
  "postId",
  "proposedStart",
  "proposedEnd",
  "helperId",
  "ownerId",
  "caregiverId",
  "eventLabel",
  "dateLabel",
]);
const OBJECTIONABLE_TEXT_PATTERNS = [
  /\b(?:kys|kill\s+yourself|go\s+die)\b/i,
  /\b(?:n[i1!]gg(?:er|a)|f[a@]gg?ot|ch[i1]nk|sp[i1]c)\b/i,
  /\b(?:child\s+porn|rape\s+(?:you|her|him|them))\b/i,
];

function assertAllowedUserContent(text: string): void {
  const normalized = text.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (OBJECTIONABLE_TEXT_PATTERNS.some((pattern) => pattern.test(normalized))) {
    throw new HttpsError(
      "invalid-argument",
      "This message contains content that is not allowed."
    );
  }
}

function conversationKey(userIdA: string, userIdB: string): string {
  return [userIdA, userIdB].sort().join("__");
}

function deterministicConversationId(participantKey: string): string {
  return crypto.createHash("sha256")
    .update(`watchdog-conversation:${participantKey}`)
    .digest("hex");
}

async function validateConversationPost(
  postId: string,
  userIdA: string,
  userIdB: string
): Promise<void> {
  const postSnap = await db.collection("swapPosts").doc(postId).get();
  const post = postSnap.data();
  if (!post) {
    throw new HttpsError("not-found", "The linked booking was not found.");
  }

  const participants = new Set([userIdA, userIdB]);
  const ownerId = post.posterId;
  const caregiverId = post.claimedBy;
  const isOpenOwnerConversation =
    post.status === "open"
    && typeof ownerId === "string"
    && participants.has(ownerId);
  const isClaimedPartyConversation =
    post.status === "claimed"
    && typeof ownerId === "string"
    && typeof caregiverId === "string"
    && participants.has(ownerId)
    && participants.has(caregiverId);

  if (!isOpenOwnerConversation && !isClaimedPartyConversation) {
    throw new HttpsError(
      "permission-denied",
      "This booking cannot be linked to these members."
    );
  }
}

function sanitizeMessageMetadata(
  value: unknown,
  uid: string,
  participants: string[],
  linkedPostId?: string
): DocumentData | undefined {
  if (value == null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new HttpsError("invalid-argument", "Message details are invalid.");
  }

  const raw = value as DocumentData;
  const keys = Object.keys(raw);
  if (keys.some((key) => !MESSAGE_METADATA_FIELDS.has(key))) {
    throw new HttpsError("invalid-argument", "Message details are invalid.");
  }

  const result: DocumentData = {};
  for (const key of keys) {
    const entry = optionalString(raw[key], key === "eventLabel" || key === "dateLabel" ? 160 : 256);
    if (entry !== undefined) result[key] = entry;
  }

  const postId = result.postId;
  if (postId !== undefined && postId !== linkedPostId) {
    throw new HttpsError(
      "permission-denied",
      "Message details do not match this conversation."
    );
  }
  if (result.helperId !== undefined && result.helperId !== uid) {
    throw new HttpsError("permission-denied", "Helper identity is invalid.");
  }
  for (const identityField of ["ownerId", "caregiverId"]) {
    const identity = result[identityField];
    if (identity !== undefined && !participants.includes(identity as string)) {
      throw new HttpsError("permission-denied", "Message identity is invalid.");
    }
  }
  for (const dateField of ["proposedStart", "proposedEnd"]) {
    const dateText = result[dateField];
    if (
      dateText !== undefined
      && (typeof dateText !== "string" || !Number.isFinite(Date.parse(dateText)))
    ) {
      throw new HttpsError("invalid-argument", "Message date is invalid.");
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function validateConversationImageUrl(value: unknown, conversationId: string): string {
  const imageUrl = requiredString(value, "Image", 2048);
  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    throw new HttpsError("invalid-argument", "Image URL is invalid.");
  }
  const encodedPrefix = encodeURIComponent(`chat-images/${conversationId}/`);
  if (
    parsed.protocol !== "https:"
    || parsed.hostname !== "firebasestorage.googleapis.com"
    || !parsed.pathname.includes(`/o/${encodedPrefix}`)
  ) {
    throw new HttpsError(
      "permission-denied",
      "The image does not belong to this conversation."
    );
  }
  return imageUrl;
}

const CLIENT_POST_FIELDS = [
  "careDetails",
  "carePhotos",
  "careType",
  "addOnCareTypes",
  "careAddress",
  "overnightLocation",
  "sitterTransport",
  "walkSessions",
  "walkDurationMins",
  "feedingSlots",
  "playSessions",
  "medicationSlots",
  "startTime",
  "endTime",
];
const POST_FREE_TEXT_FIELDS = new Set(["careDetails", "instructions", "details"]);

function sanitizeClientPostValue(value: unknown, depth = 0): unknown {
  if (depth > 6) {
    throw new HttpsError("invalid-argument", "Booking details are too deeply nested.");
  }
  if (value == null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Math.abs(value) > 1_000_000) {
      throw new HttpsError("invalid-argument", "Booking number is invalid.");
    }
    return value;
  }
  if (typeof value === "string") {
    if (value.length > 5000) {
      throw new HttpsError("invalid-argument", "Booking text is too long.");
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 50) {
      throw new HttpsError("invalid-argument", "Booking list is too long.");
    }
    return value.map((entry) => sanitizeClientPostValue(entry, depth + 1));
  }
  if (typeof value === "object") {
    const raw = value as DocumentData;
    const keys = Object.keys(raw);
    if (keys.length > 30 || keys.some((key) => key.startsWith("__"))) {
      throw new HttpsError("invalid-argument", "Booking details are invalid.");
    }
    const result: DocumentData = {};
    for (const key of keys) {
      result[key] = sanitizeClientPostValue(raw[key], depth + 1);
    }
    return result;
  }
  throw new HttpsError("invalid-argument", "Booking details are invalid.");
}

function inspectPostContent(value: unknown, key?: string, depth = 0): void {
  if (depth > 6 || value == null) return;
  if (typeof value === "string" && key && POST_FREE_TEXT_FIELDS.has(key)) {
    assertAllowedUserContent(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) inspectPostContent(entry, key, depth + 1);
    return;
  }
  if (typeof value === "object") {
    for (const [childKey, childValue] of Object.entries(value as DocumentData)) {
      inspectPostContent(childValue, childKey, depth + 1);
    }
  }
}

function parsePostDate(value: unknown, field: string): admin.firestore.Timestamp {
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", `${field} is required.`);
  }
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) {
    throw new HttpsError("invalid-argument", `${field} is invalid.`);
  }
  return admin.firestore.Timestamp.fromMillis(millis);
}

function boundedNumber(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number
): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new HttpsError("invalid-argument", `${field} is invalid.`);
  }
  return number;
}

function validateUserStorageUrl(
  value: unknown,
  uid: string,
  allowedFolders: string[]
): string {
  const imageUrl = requiredString(value, "Photo", 2048);
  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    throw new HttpsError("invalid-argument", "Photo URL is invalid.");
  }
  const isOwnedPath = allowedFolders.some((folder) => (
    parsed.pathname.includes(`/o/${encodeURIComponent(`${folder}/${uid}/`)}`)
  ));
  if (
    parsed.protocol !== "https:"
    || parsed.hostname !== "firebasestorage.googleapis.com"
    || !isOwnedPath
  ) {
    throw new HttpsError("permission-denied", "Photo ownership could not be verified.");
  }
  return imageUrl;
}

function validateNestedPostPhotoOwnership(value: unknown, uid: string, depth = 0): void {
  if (depth > 6 || value == null) return;
  if (Array.isArray(value)) {
    for (const entry of value) validateNestedPostPhotoOwnership(entry, uid, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, childValue] of Object.entries(value as DocumentData)) {
    if (key === "photos" && Array.isArray(childValue)) {
      if (childValue.length > 10) {
        throw new HttpsError("invalid-argument", "Too many service photos.");
      }
      for (const photo of childValue) {
        validateUserStorageUrl(photo, uid, ["service-photos"]);
      }
    } else {
      validateNestedPostPhotoOwnership(childValue, uid, depth + 1);
    }
  }
}

const PROFILE_UPDATE_FIELDS = new Set([
  "displayName",
  "bio",
  "instagramHandle",
  "photoURL",
]);

export const updateMyProfileSecure = onCall(
  { maxInstances: 20 },
  async (request) => {
    const uid = requireUid(request);
    const raw = request.data?.profile;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new HttpsError("invalid-argument", "Profile details are required.");
    }
    const profile = raw as DocumentData;
    if (
      Object.keys(profile).length === 0
      || Object.keys(profile).some((key) => !PROFILE_UPDATE_FIELDS.has(key))
    ) {
      throw new HttpsError("invalid-argument", "Profile details are invalid.");
    }

    const update: DocumentData = {
      updatedAt: admin.firestore.Timestamp.now(),
    };
    if (profile.displayName !== undefined) {
      const displayName = requiredString(profile.displayName, "Name", 80);
      assertAllowedUserContent(displayName);
      update.displayName = displayName;
    }
    if (profile.bio !== undefined) {
      const bio = requiredString(profile.bio, "About you", 1500);
      if (bio.length < 20) {
        throw new HttpsError(
          "invalid-argument",
          "Please write at least 20 characters about yourself."
        );
      }
      assertAllowedUserContent(bio);
      update.bio = bio;
    }
    if (profile.instagramHandle !== undefined) {
      if (typeof profile.instagramHandle !== "string") {
        throw new HttpsError("invalid-argument", "Instagram handle is invalid.");
      }
      const instagramHandle = profile.instagramHandle.trim();
      if (
        instagramHandle.length > 64
        || (instagramHandle && !/^[A-Za-z0-9._]+$/.test(instagramHandle))
      ) {
        throw new HttpsError("invalid-argument", "Instagram handle is invalid.");
      }
      if (instagramHandle) assertAllowedUserContent(instagramHandle);
      update.instagramHandle = instagramHandle;
    }
    if (profile.photoURL !== undefined) {
      update.photoURL = profile.photoURL === ""
        ? ""
        : validateUserStorageUrl(profile.photoURL, uid, ["users"]);
    }

    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) throw new HttpsError("not-found", "Account not found.");
    await userRef.update(update);
    return { ok: true };
  }
);

export const registerPushTokenSecure = onCall(
  { maxInstances: 30 },
  async (request) => {
    const uid = requireUid(request);
    await requireProvisionedUser(uid);
    const token = requiredString(request.data?.token, "Push token", 256);
    if (!Expo.isExpoPushToken(token)) {
      throw new HttpsError("invalid-argument", "Push token is invalid.");
    }
    const privateRef = db.collection("privateUsers").doc(uid);
    await db.runTransaction(async (transaction) => {
      const privateSnap = await transaction.get(privateRef);
      const existing = privateSnap.data()?.pushTokens;
      const current = Array.isArray(existing)
        ? existing.filter((value): value is string => (
          typeof value === "string" && Expo.isExpoPushToken(value)
        ))
        : [];
      const pushTokens = [...current.filter((value) => value !== token), token].slice(-10);
      transaction.set(privateRef, {
        pushToken: token,
        pushTokens,
        updatedAt: admin.firestore.Timestamp.now(),
      }, { merge: true });
    });
    return { ok: true };
  }
);

const DOG_EDITABLE_FIELDS = new Set([
  "ownerId",
  "name",
  "breed",
  "ageYears",
  "ageMonths",
  "weightLbs",
  "sex",
  "energyLevel",
  "photoURLs",
  "bio",
  "isGoodWithDogs",
  "isGoodWithKids",
  "isSpayedNeutered",
  "vaccinated",
  "pottyTrained",
  "temperament",
]);

function validateDogPhotoUrl(value: unknown, uid: string, dogId?: string): string {
  const imageUrl = requiredString(value, "Dog photo", 2048);
  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    throw new HttpsError("invalid-argument", "Dog photo URL is invalid.");
  }

  const objectMatch = parsed.pathname.match(/\/o\/(.+)$/);
  let storagePath = "";
  try {
    storagePath = decodeURIComponent(objectMatch?.[1] ?? "");
  } catch {
    throw new HttpsError("invalid-argument", "Dog photo URL is invalid.");
  }
  const ownsTemporaryPath = storagePath.startsWith(`dogs/temp_${uid}_`);
  const ownsDogPath = Boolean(dogId && storagePath.startsWith(`dogs/${dogId}/`));
  if (
    parsed.protocol !== "https:"
    || parsed.hostname !== "firebasestorage.googleapis.com"
    || (!ownsTemporaryPath && !ownsDogPath)
  ) {
    throw new HttpsError("permission-denied", "Dog photo ownership could not be verified.");
  }
  return imageUrl;
}

function sanitizeDogUpdate(
  raw: unknown,
  uid: string,
  dogId?: string,
  requireComplete = false
): DocumentData {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new HttpsError("invalid-argument", "Dog details are required.");
  }
  const data = raw as DocumentData;
  if (
    Object.keys(data).length === 0
    || Object.keys(data).some((key) => !DOG_EDITABLE_FIELDS.has(key))
    || (data.ownerId !== undefined && data.ownerId !== uid)
  ) {
    throw new HttpsError("invalid-argument", "Dog details are invalid.");
  }

  const result: DocumentData = {};
  const textFields: Array<[string, string, number, boolean]> = [
    ["name", "Dog name", 120, requireComplete],
    ["breed", "Breed", 120, requireComplete],
    ["bio", "Dog bio", 1500, false],
    ["temperament", "Temperament", 500, false],
  ];
  for (const [key, label, maxLength, required] of textFields) {
    if (data[key] === undefined) {
      if (required) throw new HttpsError("invalid-argument", `${label} is required.`);
      continue;
    }
    const value = required
      ? requiredString(data[key], label, maxLength)
      : optionalString(data[key], maxLength) ?? "";
    if (value) assertAllowedUserContent(value);
    result[key] = value;
  }

  const numberFields: Array<[string, number, number]> = [
    ["ageYears", 0, 40],
    ["ageMonths", 0, 11],
    ["weightLbs", 0, 500],
  ];
  for (const [key, minimum, maximum] of numberFields) {
    if (data[key] === undefined) {
      if (requireComplete) {
        throw new HttpsError("invalid-argument", `${key} is required.`);
      }
      continue;
    }
    result[key] = boundedNumber(data[key], key, minimum, maximum);
  }

  if (data.sex !== undefined) {
    if (!["male", "female"].includes(String(data.sex))) {
      throw new HttpsError("invalid-argument", "Dog sex is invalid.");
    }
    result.sex = data.sex;
  } else if (requireComplete) {
    throw new HttpsError("invalid-argument", "Dog sex is required.");
  }
  if (data.energyLevel !== undefined) {
    if (!["low", "moderate", "high", "very_high"].includes(String(data.energyLevel))) {
      throw new HttpsError("invalid-argument", "Energy level is invalid.");
    }
    result.energyLevel = data.energyLevel;
  } else if (requireComplete) {
    throw new HttpsError("invalid-argument", "Energy level is required.");
  }

  const booleanFields = [
    "isGoodWithDogs",
    "isGoodWithKids",
    "isSpayedNeutered",
    "vaccinated",
    "pottyTrained",
  ];
  for (const key of booleanFields) {
    if (data[key] === undefined) continue;
    if (typeof data[key] !== "boolean") {
      throw new HttpsError("invalid-argument", `${key} is invalid.`);
    }
    result[key] = data[key];
  }

  if (data.photoURLs !== undefined) {
    if (!Array.isArray(data.photoURLs) || data.photoURLs.length > 10) {
      throw new HttpsError("invalid-argument", "Dog photos are invalid.");
    }
    result.photoURLs = data.photoURLs.map((url) =>
      validateDogPhotoUrl(url, uid, dogId)
    );
  } else if (requireComplete) {
    result.photoURLs = [];
  }
  return result;
}

export const createDogSecure = onCall(
  { maxInstances: 20 },
  async (request) => {
    const uid = requireUid(request);
    await requireProvisionedUser(uid);
    const dog = sanitizeDogUpdate(request.data?.dog, uid, undefined, true);
    const now = admin.firestore.Timestamp.now();
    const dogRef = db.collection("dogs").doc();
    await dogRef.create({
      ...dog,
      ownerId: uid,
      createdAt: now,
      updatedAt: now,
    });
    return { dogId: dogRef.id };
  }
);

export const updateDogSecure = onCall(
  { maxInstances: 20 },
  async (request) => {
    const uid = requireUid(request);
    const dogId = requiredString(request.data?.dogId, "Dog", 128);
    const dogRef = db.collection("dogs").doc(dogId);
    const dogSnap = await dogRef.get();
    const existing = dogSnap.data();
    if (!existing) throw new HttpsError("not-found", "Dog not found.");
    if (existing.ownerId !== uid) {
      throw new HttpsError("permission-denied", "You can edit only your own dog.");
    }

    const dog = sanitizeDogUpdate(request.data?.dog, uid, dogId);
    await dogRef.update({
      ...dog,
      updatedAt: admin.firestore.Timestamp.now(),
    });
    return { ok: true };
  }
);

export const createSwapRequestSecure = onCall(
  { maxInstances: 20 },
  async (request) => {
    const uid = requireUid(request);
    await requireActiveUser(uid);
    const raw = request.data?.swap;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new HttpsError("invalid-argument", "Swap details are required.");
    }
    const swap = raw as DocumentData;
    const receiverId = requiredString(swap.receiverId, "Recipient", 128);
    if (receiverId === uid) {
      throw new HttpsError("invalid-argument", "Choose another member.");
    }
    await requireActiveUser(receiverId);
    await assertUsersNotBlocked(uid, receiverId);

    const requesterDogIds = Array.isArray(swap.requesterDogIds)
      ? swap.requesterDogIds.map((id) => requiredString(id, "Dog", 128))
      : [];
    const receiverDogIds = Array.isArray(swap.receiverDogIds)
      ? swap.receiverDogIds.map((id) => requiredString(id, "Dog", 128))
      : [];
    if (
      requesterDogIds.length < 1
      || requesterDogIds.length > 10
      || receiverDogIds.length > 10
      || new Set(requesterDogIds).size !== requesterDogIds.length
      || new Set(receiverDogIds).size !== receiverDogIds.length
    ) {
      throw new HttpsError("invalid-argument", "Dog selection is invalid.");
    }
    const dogRefs = [...requesterDogIds, ...receiverDogIds]
      .map((dogId) => db.collection("dogs").doc(dogId));
    const dogSnaps = dogRefs.length > 0 ? await db.getAll(...dogRefs) : [];
    const requesterDogs = dogSnaps.slice(0, requesterDogIds.length);
    const receiverDogs = dogSnaps.slice(requesterDogIds.length);
    if (
      requesterDogs.some((dog) => dog.data()?.ownerId !== uid)
      || receiverDogs.some((dog) => dog.data()?.ownerId !== receiverId)
    ) {
      throw new HttpsError("permission-denied", "Dog ownership could not be verified.");
    }

    const startDate = parsePostDate(swap.startDate, "Start date");
    const endDate = parsePostDate(swap.endDate, "End date");
    const maxFuture = Date.now() + 2 * 365 * 24 * 60 * 60 * 1000;
    if (
      startDate.toMillis() < Date.now() - 60 * 60 * 1000
      || endDate.toMillis() <= startDate.toMillis()
      || endDate.toMillis() > maxFuture
    ) {
      throw new HttpsError("invalid-argument", "Swap dates are invalid.");
    }

    const careDetails = optionalString(swap.careDetails, 4000);
    const message = optionalString(swap.message, 2000);
    if (careDetails) assertAllowedUserContent(careDetails);
    if (message) assertAllowedUserContent(message);
    const paymentType = requiredString(swap.paymentType, "Payment type", 16);
    if (!["points", "payment", "either"].includes(paymentType)) {
      throw new HttpsError("invalid-argument", "Payment type is invalid.");
    }
    const pointsCost = boundedNumber(swap.pointsCost, "Points", 0, 1000);
    const paymentOffered = swap.paymentOffered == null
      ? undefined
      : boundedNumber(swap.paymentOffered, "Payment", 1, 100_000);
    if (paymentType !== "points" && paymentOffered === undefined) {
      throw new HttpsError("invalid-argument", "Payment amount is required.");
    }

    const now = admin.firestore.Timestamp.now();
    const swapRef = db.collection("swapRequests").doc();
    const record: DocumentData = {
      requesterId: uid,
      receiverId,
      requesterDogIds,
      receiverDogIds,
      startDate,
      endDate,
      status: "pending",
      pointsCost,
      paymentType,
      createdAt: now,
      updatedAt: now,
    };
    if (careDetails) record.careDetails = careDetails;
    if (message) record.message = message;
    if (paymentOffered !== undefined) record.paymentOffered = paymentOffered;
    await swapRef.create(record);
    return { swapRequestId: swapRef.id };
  }
);

export const createPostSecure = onCall(
  { maxInstances: 30 },
  async (request) => {
    const uid = requireUid(request);
    const userData = await requireActiveUser(uid);
    const raw = request.data?.post;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new HttpsError("invalid-argument", "Booking details are required.");
    }
    const rawPost = raw as DocumentData;
    const serialized = JSON.stringify(rawPost);
    if (serialized.length > 120_000) {
      throw new HttpsError("invalid-argument", "Booking details are too large.");
    }

    const rawDogIds = Array.isArray(rawPost.dogIds)
      ? rawPost.dogIds
      : [rawPost.dogId];
    const dogIds = rawDogIds.map((dogId) => requiredString(dogId, "Dog", 128));
    if (
      dogIds.length < 1
      || dogIds.length > 10
      || new Set(dogIds).size !== dogIds.length
    ) {
      throw new HttpsError("invalid-argument", "Choose between one and ten dogs.");
    }
    const dogRefs = dogIds.map((dogId) => db.collection("dogs").doc(dogId));
    const dogSnaps = await db.getAll(...dogRefs);
    const dogs = dogSnaps.map((snapshot) => snapshot.data());
    if (dogs.some((dog) => !dog || dog.ownerId !== uid)) {
      throw new HttpsError("permission-denied", "You can post only for your own dogs.");
    }

    const startDate = parsePostDate(rawPost.startDate, "Start date");
    const endDate = parsePostDate(rawPost.endDate, "End date");
    const nowMillis = Date.now();
    const maxFutureMillis = nowMillis + 2 * 365 * 24 * 60 * 60 * 1000;
    if (
      startDate.toMillis() < nowMillis - 60 * 60 * 1000
      || startDate.toMillis() > maxFutureMillis
      || endDate.toMillis() < startDate.toMillis()
      || endDate.toMillis() > maxFutureMillis
    ) {
      throw new HttpsError("invalid-argument", "Booking dates are invalid.");
    }

    const compensationType = requiredString(
      rawPost.compensationType,
      "Compensation type",
      16
    );
    if (!["points", "payment", "either"].includes(compensationType)) {
      throw new HttpsError("invalid-argument", "Compensation type is invalid.");
    }
    const points = compensationType === "payment"
      ? 0
      : boundedNumber(
        rawPost.pointsOffered ?? rawPost.pointsCost,
        "Points",
        0.5,
        1000
      );
    const payment = compensationType === "points"
      ? undefined
      : boundedNumber(
        rawPost.paymentAmount ?? rawPost.totalPayment,
        "Payment",
        1,
        100_000
      );

    const location = roundedPublicLocation(rawPost.posterLocation).location;
    if (!location) {
      throw new HttpsError("invalid-argument", "A valid booking location is required.");
    }

    const clientFields = sanitizeClientPostValue(
      copyDefined(rawPost, CLIENT_POST_FIELDS)
    ) as DocumentData;
    inspectPostContent(clientFields);
    validateNestedPostPhotoOwnership(clientFields, uid);
    if (Array.isArray(clientFields.carePhotos)) {
      if (clientFields.carePhotos.length > 10) {
        throw new HttpsError("invalid-argument", "Too many booking photos.");
      }
      clientFields.carePhotos = clientFields.carePhotos.map((photo) =>
        validateUserStorageUrl(photo, uid, ["care-photos"])
      );
    }

    const displayName = requiredString(userData.displayName, "Profile name", 120);
    const locationName = optionalString(rawPost.posterLocationName, 200);
    const now = admin.firestore.Timestamp.now();
    const postRef = db.collection("swapPosts").doc();
    const post: DocumentData = {
      ...clientFields,
      posterId: uid,
      posterName: displayName,
      posterPhotoURL: typeof userData.photoURL === "string" ? userData.photoURL : null,
      posterLocation: location,
      posterGeohash: geohashForLocation([location.latitude, location.longitude]),
      dogId: dogIds[0],
      dogName: requiredString(dogs[0]?.name, "Dog name", 120),
      dogIds,
      dogNames: dogs.map((dog) => requiredString(dog?.name, "Dog name", 120)),
      startDate,
      endDate,
      compensationType,
      pointsCost: points,
      pointsOffered: points,
      status: "open",
      pointsDisabled: false,
      respondedBy: [],
      createdAt: now,
      updatedAt: now,
    };
    if (locationName) post.posterLocationName = locationName;
    const primaryBreed = optionalString(dogs[0]?.breed, 120);
    if (primaryBreed) post.dogBreed = primaryBreed;
    const dogBreeds = dogs
      .map((dog) => optionalString(dog?.breed, 120))
      .filter((breed): breed is string => breed !== undefined);
    if (dogBreeds.length > 0) post.dogBreeds = dogBreeds;
    const dogPhotoURLs = dogs.flatMap((dog) => (
      Array.isArray(dog?.photoURLs) && typeof dog.photoURLs[0] === "string"
        ? [dog.photoURLs[0]]
        : []
    ));
    if (dogPhotoURLs.length > 0) {
      post.dogPhotoURL = dogPhotoURLs[0];
      post.dogPhotoURLs = dogPhotoURLs;
    }
    if (payment !== undefined) {
      post.paymentAmount = payment;
      post.totalPayment = payment;
    }

    await postRef.create(post);
    return { postId: postRef.id };
  }
);

export const getOrCreateConversationSecure = onCall(
  { maxInstances: 30 },
  async (request) => {
    const uid = requireUid(request);
    await requireActiveUser(uid);
    const otherUserId = requiredString(request.data?.otherUserId, "Member", 128);
    if (otherUserId === uid || otherUserId === SYSTEM_SENDER_ID) {
      throw new HttpsError("invalid-argument", "Choose another member.");
    }

    await requireActiveUser(otherUserId);
    await assertUsersNotBlocked(uid, otherUserId);

    const swapRequestId = optionalString(request.data?.swapRequestId, 256);
    if (swapRequestId) {
      await validateConversationPost(swapRequestId, uid, otherUserId);
    }

    const participantKey = conversationKey(uid, otherUserId);
    const existing = await db.collection("conversations")
      .where("participantKey", "==", participantKey)
      .limit(1)
      .get();
    if (!existing.empty) {
      const existingData = existing.docs[0].data();
      const existingParticipants = existingData.participantIds as unknown;
      if (
        !Array.isArray(existingParticipants)
        || !existingParticipants.includes(uid)
        || !existingParticipants.includes(otherUserId)
      ) {
        throw new HttpsError("failed-precondition", "Conversation membership is invalid.");
      }
      return { conversationId: existing.docs[0].id };
    }

    const conversationId = deterministicConversationId(participantKey);
    const conversationRef = db.collection("conversations").doc(conversationId);
    const now = admin.firestore.Timestamp.now();
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(conversationRef);
      if (snapshot.exists) return;
      transaction.create(conversationRef, {
        participantIds: [uid, otherUserId].sort(),
        participantKey,
        swapRequestId: swapRequestId ?? null,
        unreadCounts: { [uid]: 0, [otherUserId]: 0 },
        createdAt: now,
        updatedAt: now,
      });
    });
    return { conversationId };
  }
);

export const sendMessageSecure = onCall(
  { maxInstances: 50 },
  async (request) => {
    const uid = requireUid(request);
    await requireActiveUser(uid);
    const conversationId = requiredString(
      request.data?.conversationId,
      "Conversation",
      128
    );
    const conversationRef = db.collection("conversations").doc(conversationId);
    const conversationSnap = await conversationRef.get();
    const conversation = conversationSnap.data();
    const participants = conversation?.participantIds as unknown;
    if (
      !conversation
      || !Array.isArray(participants)
      || participants.length !== 2
      || !participants.includes(uid)
    ) {
      throw new HttpsError("permission-denied", "You cannot use this conversation.");
    }

    const otherUserId = participants.find((participant) => participant !== uid);
    if (typeof otherUserId !== "string") {
      throw new HttpsError("failed-precondition", "Conversation membership is invalid.");
    }
    if (otherUserId !== SYSTEM_SENDER_ID) {
      await requireActiveUser(otherUserId);
      await assertUsersNotBlocked(uid, otherUserId);
    }

    const rawType = request.data?.type ?? "text";
    if (typeof rawType !== "string" || !USER_MESSAGE_TYPES.has(rawType)) {
      throw new HttpsError("invalid-argument", "Message type is invalid.");
    }
    const text = optionalString(request.data?.text, 4000) ?? "";
    const imageUrl = rawType === "image"
      ? validateConversationImageUrl(request.data?.imageURL, conversationId)
      : undefined;
    if (rawType !== "image" && !text) {
      throw new HttpsError("invalid-argument", "Message text is required.");
    }
    if (rawType !== "image" && request.data?.imageURL != null) {
      throw new HttpsError("invalid-argument", "Image message type is required.");
    }
    if (text) assertAllowedUserContent(text);

    const linkedPostId = typeof conversation.swapRequestId === "string"
      ? conversation.swapRequestId
      : undefined;
    const metadata = sanitizeMessageMetadata(
      request.data?.metadata,
      uid,
      participants as string[],
      linkedPostId
    );
    const messageType = rawType as string;
    if (
      (messageType === "help_request" || messageType === "reschedule_request")
      && metadata?.postId !== linkedPostId
    ) {
      throw new HttpsError("invalid-argument", "Linked booking details are required.");
    }

    const now = admin.firestore.Timestamp.now();
    const messageRef = conversationRef.collection("messages").doc();
    const message: DocumentData = {
      conversationId,
      senderId: uid,
      text,
      read: false,
      type: messageType,
      createdAt: now,
    };
    if (imageUrl) message.imageURL = imageUrl;
    if (metadata) message.metadata = metadata;

    const preview = text || "Photo";
    const batch = db.batch();
    batch.create(messageRef, message);
    batch.set(conversationRef, {
      lastMessage: preview.slice(0, 100),
      lastMessageAt: now,
      updatedAt: now,
    }, { merge: true });
    await batch.commit();
    return { messageId: messageRef.id };
  }
);

export const addPostResponse = onCall(
  { maxInstances: 20 },
  async (request) => {
    const uid = requireUid(request);
    const userData = await requireActiveUser(uid);
    const postId = requiredString(request.data?.postId, "Post", 256);
    const rawCounter = request.data?.counterPoints;
    const counterPoints = rawCounter == null ? undefined : Number(rawCounter);
    if (
      counterPoints !== undefined
      && (!Number.isFinite(counterPoints) || counterPoints < 0.5 || counterPoints > 1000)
    ) {
      throw new HttpsError("invalid-argument", "Counter offer is invalid.");
    }

    const postRef = db.collection("swapPosts").doc(postId);
    const responseRef = db.collection("postResponses").doc(responseDocumentId(postId, uid));

    await db.runTransaction(async (transaction) => {
      const [postSnap, existingResponse] = await Promise.all([
        transaction.get(postRef),
        transaction.get(responseRef),
      ]);
      const post = postSnap.data();
      if (!post || post.status !== "open") {
        throw new HttpsError("failed-precondition", "This request is no longer open.");
      }
      if (post.posterId === uid) {
        throw new HttpsError("failed-precondition", "You cannot respond to your own request.");
      }
      await assertUsersNotBlocked(uid, post.posterId as string);
      if (existingResponse.exists) return;

      const now = admin.firestore.Timestamp.now();
      const entry: DocumentData = {
        userId: uid,
        userName: (userData.displayName as string | undefined) || "Member",
        userPhotoURL: (userData.photoURL as string | undefined) || null,
        respondedAt: now,
      };
      if (counterPoints !== undefined) {
        entry.counterPoints = counterPoints;
        entry.counterStatus = "pending";
      }

      transaction.create(responseRef, {
        postId,
        posterId: post.posterId,
        responderId: uid,
        counterPoints: counterPoints ?? null,
        counterStatus: counterPoints === undefined ? null : "pending",
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });
      transaction.update(postRef, {
        respondedBy: admin.firestore.FieldValue.arrayUnion(entry),
        updatedAt: now,
      });
    });

    return { ok: true };
  }
);

export const removePostResponse = onCall(
  { maxInstances: 20 },
  async (request) => {
    const uid = requireUid(request);
    await requireActiveUser(uid);
    const postId = requiredString(request.data?.postId, "Post", 256);
    const requestedResponderId =
      typeof request.data?.responderId === "string" ? request.data.responderId : uid;
    const postRef = db.collection("swapPosts").doc(postId);
    const responseRef = db
      .collection("postResponses")
      .doc(responseDocumentId(postId, requestedResponderId));

    await db.runTransaction(async (transaction) => {
      const [postSnap, responseSnap] = await Promise.all([
        transaction.get(postRef),
        transaction.get(responseRef),
      ]);
      const post = postSnap.data();
      if (!post) throw new HttpsError("not-found", "Request not found.");
      const isPoster = post.posterId === uid;
      if (!isPoster && requestedResponderId !== uid) {
        throw new HttpsError("permission-denied", "You cannot remove this response.");
      }

      const current = Array.isArray(post.respondedBy)
        ? (post.respondedBy as DocumentData[])
        : [];
      const next = current.filter((entry) => entry?.userId !== requestedResponderId);
      transaction.update(postRef, {
        respondedBy: next,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      if (responseSnap.exists) transaction.delete(responseRef);
    });

    return { ok: true };
  }
);

export const approvePostHelper = onCall(
  { maxInstances: 20 },
  async (request) => {
    const uid = requireUid(request);
    await requireActiveUser(uid);
    const postId = requiredString(request.data?.postId, "Post", 256);
    const helperId = requiredString(request.data?.helperId, "Helper", 128);
    if (helperId === uid) {
      throw new HttpsError("invalid-argument", "You cannot approve yourself.");
    }
    await requireActiveUser(helperId);
    await assertUsersNotBlocked(uid, helperId);

    const postRef = db.collection("swapPosts").doc(postId);
    const responseRef = db
      .collection("postResponses")
      .doc(responseDocumentId(postId, helperId));
    const helperCommitmentsQuery = db
      .collection("swapPosts")
      .where("claimedBy", "==", helperId)
      .where("status", "==", "claimed");

    await db.runTransaction(async (transaction) => {
      const [postSnap, responseSnap, commitmentSnap] = await Promise.all([
        transaction.get(postRef),
        transaction.get(responseRef),
        transaction.get(helperCommitmentsQuery),
      ]);
      const post = postSnap.data();
      if (!post) throw new HttpsError("not-found", "Request not found.");
      if (post.posterId !== uid) {
        throw new HttpsError("permission-denied", "Only the request owner can approve a helper.");
      }
      if (post.status !== "open" || post.claimedBy) {
        throw new HttpsError("failed-precondition", "This request already has a helper.");
      }
      if (!responseSnap.exists) {
        throw new HttpsError("failed-precondition", "This member has not offered to help.");
      }
      const requestedInterval = resolveInterval(post as DocumentData);
      if (requestedInterval) {
        const hasConflict = commitmentSnap.docs.some((commitmentDoc) => {
          if (commitmentDoc.id === postId) return false;
          const interval = resolveInterval(commitmentDoc.data() as DocumentData);
          return interval
            ? intervalsOverlap(
              requestedInterval.start,
              requestedInterval.end,
              interval.start,
              interval.end
            )
            : false;
        });
        if (hasConflict) {
          throw new HttpsError(
            "failed-precondition",
            "This member already has an overlapping commitment."
          );
        }
      }

      const now = admin.firestore.Timestamp.now();
      const responses = Array.isArray(post.respondedBy)
        ? (post.respondedBy as DocumentData[]).map((entry) => ({
          ...entry,
          ...(entry?.userId === helperId ? { counterStatus: "accepted" } : {}),
        }))
        : [];
      transaction.update(postRef, {
        status: "claimed",
        claimedBy: helperId,
        respondedBy: responses,
        updatedAt: now,
      });
      transaction.update(responseRef, {
        status: "accepted",
        counterStatus: "accepted",
        updatedAt: now,
      });
    });

    return { ok: true };
  }
);

export const respondToPostCounter = onCall(
  { maxInstances: 20 },
  async (request) => {
    const uid = requireUid(request);
    await requireActiveUser(uid);
    const postId = requiredString(request.data?.postId, "Post", 256);
    const responderId = requiredString(request.data?.responderId, "Responder", 128);
    const accepted = request.data?.accepted === true;
    const postRef = db.collection("swapPosts").doc(postId);
    const responseRef = db
      .collection("postResponses")
      .doc(responseDocumentId(postId, responderId));

    await db.runTransaction(async (transaction) => {
      const [postSnap, responseSnap] = await Promise.all([
        transaction.get(postRef),
        transaction.get(responseRef),
      ]);
      const post = postSnap.data();
      if (!post || post.posterId !== uid) {
        throw new HttpsError("permission-denied", "Only the request owner can respond.");
      }
      if (!responseSnap.exists) {
        throw new HttpsError("not-found", "Response not found.");
      }
      const status = accepted ? "accepted" : "declined";
      const respondedBy = Array.isArray(post.respondedBy)
        ? (post.respondedBy as DocumentData[]).map((entry) => (
          entry?.userId === responderId ? { ...entry, counterStatus: status } : entry
        ))
        : [];
      const now = admin.firestore.Timestamp.now();
      transaction.update(postRef, { respondedBy, updatedAt: now });
      transaction.update(responseRef, { counterStatus: status, updatedAt: now });
    });
    return { ok: true };
  }
);

export const reopenPostSecure = onCall(
  { maxInstances: 20 },
  async (request) => {
    const uid = requireUid(request);
    await requireActiveUser(uid);
    const postId = requiredString(request.data?.postId, "Post", 256);
    const startDateText = optionalString(request.data?.startDate, 64);
    const endDateText = optionalString(request.data?.endDate, 64);
    const postRef = db.collection("swapPosts").doc(postId);
    const responsesQuery = db.collection("postResponses").where("postId", "==", postId);

    await db.runTransaction(async (transaction) => {
      const [postSnap, responseSnap] = await Promise.all([
        transaction.get(postRef),
        transaction.get(responsesQuery),
      ]);
      const post = postSnap.data();
      if (!post) throw new HttpsError("not-found", "Booking not found.");
      if (post.status !== "claimed") {
        throw new HttpsError("failed-precondition", "This booking is not claimed.");
      }
      if (post.posterId !== uid && post.claimedBy !== uid) {
        throw new HttpsError("permission-denied", "You are not part of this booking.");
      }

      const update: DocumentData = {
        status: "open",
        claimedBy: admin.firestore.FieldValue.delete(),
        respondedBy: [],
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (startDateText || endDateText) {
        if (post.posterId !== uid || !startDateText || !endDateText) {
          throw new HttpsError("permission-denied", "Only the owner can change the dates.");
        }
        const startDate = new Date(startDateText);
        const endDate = new Date(endDateText);
        if (
          !Number.isFinite(startDate.getTime())
          || !Number.isFinite(endDate.getTime())
          || startDate.getTime() < Date.now() - 60_000
          || endDate.getTime() < startDate.getTime()
        ) {
          throw new HttpsError("invalid-argument", "The new dates are invalid.");
        }
        update.startDate = admin.firestore.Timestamp.fromDate(startDate);
        update.endDate = admin.firestore.Timestamp.fromDate(endDate);
      }

      transaction.update(postRef, update);
      responseSnap.docs.forEach((responseDoc) => transaction.delete(responseDoc.ref));
    });
    return { ok: true };
  }
);

export const rescheduleClaimedPostSecure = onCall(
  { maxInstances: 20 },
  async (request) => {
    const uid = requireUid(request);
    await requireActiveUser(uid);
    const postId = requiredString(request.data?.postId, "Post", 256);
    const startDate = new Date(requiredString(request.data?.startDate, "Start date", 64));
    const endDate = new Date(requiredString(request.data?.endDate, "End date", 64));
    if (
      !Number.isFinite(startDate.getTime())
      || !Number.isFinite(endDate.getTime())
      || startDate.getTime() < Date.now() - 60_000
      || endDate.getTime() < startDate.getTime()
    ) {
      throw new HttpsError("invalid-argument", "The new dates are invalid.");
    }

    const postRef = db.collection("swapPosts").doc(postId);
    await db.runTransaction(async (transaction) => {
      const postSnap = await transaction.get(postRef);
      const post = postSnap.data();
      if (!post) throw new HttpsError("not-found", "Booking not found.");
      if (post.posterId !== uid || post.status !== "claimed" || !post.claimedBy) {
        throw new HttpsError(
          "permission-denied",
          "Only the owner can reschedule a claimed booking."
        );
      }

      const commitmentsQuery = db
        .collection("swapPosts")
        .where("claimedBy", "==", post.claimedBy)
        .where("status", "==", "claimed");
      const commitmentSnap = await transaction.get(commitmentsQuery);
      const requested = { start: startDate, end: endDate };
      const hasConflict = commitmentSnap.docs.some((commitmentDoc) => {
        if (commitmentDoc.id === postId) return false;
        const interval = resolveInterval(commitmentDoc.data() as DocumentData);
        return interval
          ? intervalsOverlap(
            requested.start,
            requested.end,
            interval.start,
            interval.end
          )
          : false;
      });
      if (hasConflict) {
        throw new HttpsError(
          "failed-precondition",
          "The new time overlaps the caretaker's other commitment."
        );
      }

      transaction.update(postRef, {
        startDate: admin.firestore.Timestamp.fromDate(startDate),
        endDate: admin.firestore.Timestamp.fromDate(endDate),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    return { ok: true };
  }
);

export const submitReview = onCall(
  { maxInstances: 20 },
  async (request) => {
    const uid = requireUid(request);
    await requireActiveUser(uid);
    const postId = requiredString(request.data?.postId, "Post", 256);
    const revieweeId = requiredString(request.data?.revieweeId, "Review recipient", 128);
    const targetType = requiredString(request.data?.targetType, "Review type", 32);
    if (!["owner", "caregiver", "dog"].includes(targetType)) {
      throw new HttpsError("invalid-argument", "Review type is invalid.");
    }
    const rating = Number(request.data?.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new HttpsError("invalid-argument", "Rating must be between 1 and 5.");
    }
    const dogId = optionalString(request.data?.dogId, 128);
    const dogName = optionalString(request.data?.dogName, 120);
    const note = optionalString(request.data?.note, 2000);
    if (note) assertAllowedUserContent(note);
    const targetKey = targetType === "dog" ? requiredString(dogId, "Dog", 128) : revieweeId;
    const reviewId = `${postId}_${uid}_${targetType}_${targetKey}`;
    const postRef = db.collection("swapPosts").doc(postId);
    const reviewerRef = db.collection("users").doc(uid);
    const reviewRef = db.collection("reviews").doc(reviewId);
    const backupRef = db.collection("reviews_backup").doc(reviewId);
    const dogRef = dogId ? db.collection("dogs").doc(dogId) : null;

    await db.runTransaction(async (transaction) => {
      const reads = [
        transaction.get(postRef),
        transaction.get(reviewerRef),
        transaction.get(reviewRef),
      ];
      if (dogRef) reads.push(transaction.get(dogRef));
      const snapshots = await Promise.all(reads);
      const post = snapshots[0].data();
      const reviewer = snapshots[1].data();
      const existingReview = snapshots[2];
      const dog = dogRef ? snapshots[3]?.data() : undefined;
      if (!post || !reviewer) throw new HttpsError("not-found", "Booking not found.");
      if (
        post.status !== "completed"
        && !(post.status === "cancelled" && post.lateCancelled === true)
      ) {
        throw new HttpsError("failed-precondition", "This booking is not ready for review.");
      }

      const isOwner = post.posterId === uid;
      const isCaregiver = post.claimedBy === uid;
      if (!isOwner && !isCaregiver) {
        throw new HttpsError("permission-denied", "You were not part of this booking.");
      }
      const expectedReviewee = isOwner ? post.claimedBy : post.posterId;
      if (!expectedReviewee || expectedReviewee !== revieweeId || revieweeId === uid) {
        throw new HttpsError("permission-denied", "Review recipient is invalid.");
      }
      if (
        (isOwner && targetType === "owner")
        || (isCaregiver && targetType === "caregiver")
      ) {
        throw new HttpsError("invalid-argument", "Review type does not match your role.");
      }
      if (targetType === "dog") {
        if (!dogId || !dog || dog.ownerId !== revieweeId) {
          throw new HttpsError("permission-denied", "Dog review target is invalid.");
        }
      }
      if (existingReview.exists) {
        throw new HttpsError("already-exists", "You already reviewed this person or dog.");
      }

      const payload: DocumentData = {
        postId,
        reviewerId: uid,
        reviewerName: (reviewer.displayName as string | undefined) || "Anonymous",
        revieweeId,
        targetType,
        rating,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (dogId) payload.dogId = dogId;
      if (dogName) payload.dogName = dogName;
      if (note) payload.note = note;
      transaction.create(reviewRef, payload);
      transaction.create(backupRef, {
        ...payload,
        originalId: reviewId,
        backedUpAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    return { reviewId };
  }
);

export const clearMyPendingReview = onCall(async (request) => {
  const uid = requireUid(request);
  await db.collection("users").doc(uid).update({
    pendingReview: admin.firestore.FieldValue.delete(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

export const clearMyPendingReferralReward = onCall(async (request) => {
  const uid = requireUid(request);
  await db.collection("users").doc(uid).update({
    pendingReferralReward: admin.firestore.FieldValue.delete(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

export const acceptConductStandards = onCall(async (request) => {
  const uid = requireUid(request);
  await db.collection("users").doc(uid).update({
    conductAgreedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

export const signMembershipAgreement = onCall(async (request) => {
  const uid = requireUid(request);
  const signedName = requiredString(request.data?.signedName, "Legal name", 120);
  const [userSnap, privateSnap] = await Promise.all([
    db.collection("users").doc(uid).get(),
    db.collection("privateUsers").doc(uid).get(),
  ]);
  const user = userSnap.data();
  if (!user) throw new HttpsError("not-found", "Account not found.");

  const signedAt = admin.firestore.Timestamp.now();
  const agreementRef = db
    .collection("signed-agreements")
    .doc(`${uid}_${CURRENT_CONTRACT_VERSION.replace(/\./g, "_")}`);
  await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(agreementRef);
    if (!existing.exists) {
      transaction.create(agreementRef, {
        userId: uid,
        userEmail: (user.email as string | undefined) || "",
        userPhoneNumber: (privateSnap.data()?.phoneNumber as string | undefined) || "",
        signedName,
        contractVersion: CURRENT_CONTRACT_VERSION,
        signedAt,
      });
    }
    transaction.update(userSnap.ref, {
      contractSignedAt: signedAt,
      contractSignedName: signedName,
      contractVersion: CURRENT_CONTRACT_VERSION,
      updatedAt: signedAt,
    });
  });
  await ensureServerWelcomeMessage(uid);
  return { ok: true, contractVersion: CURRENT_CONTRACT_VERSION };
});

function hasCurrentAccess(user: DocumentData): boolean {
  const now = Date.now();
  const subscriptionExpiresAt = user.subscriptionExpiresAt as
    | admin.firestore.Timestamp
    | undefined;
  const freeAccessUntil = user.freeAccessUntil as admin.firestore.Timestamp | Date | undefined;
  const freeAccessMillis = freeAccessUntil instanceof admin.firestore.Timestamp
    ? freeAccessUntil.toMillis()
    : freeAccessUntil instanceof Date
      ? freeAccessUntil.getTime()
      : 0;
  return (
    user.subscriptionStatus === "active"
    && (!subscriptionExpiresAt || subscriptionExpiresAt.toMillis() > now)
  ) || freeAccessMillis > now;
}

export const finalizeOnboarding = onCall(async (request) => {
  const uid = requireUid(request);
  const userRef = db.collection("users").doc(uid);
  const [userSnap, authUser] = await Promise.all([
    userRef.get(),
    admin.auth().getUser(uid),
  ]);
  const user = userSnap.data() as DocumentData | undefined;
  if (!user) throw new HttpsError("not-found", "Account not found.");
  if (!authUser.phoneNumber) {
    throw new HttpsError(
      "permission-denied",
      "Verify your phone number before activating this account."
    );
  }
  if (user.profileSetupComplete !== true) {
    throw new HttpsError("failed-precondition", "Complete your profile first.");
  }
  if (
    typeof user.displayName !== "string"
    || user.displayName.trim().length < 1
    || typeof user.bio !== "string"
    || user.bio.trim().length < 20
    || typeof user.photoURL !== "string"
    || !user.photoURL.startsWith("https://")
  ) {
    throw new HttpsError(
      "failed-precondition",
      "Add your name, photo, and at least 20 characters about yourself."
    );
  }
  if (!user.conductAgreedAt || !user.contractSignedAt) {
    throw new HttpsError("failed-precondition", "Complete the community agreements first.");
  }
  if (!hasCurrentAccess(user)) {
    throw new HttpsError(
      "failed-precondition",
      "Your subscription is still being confirmed. Restore purchases or try again shortly."
    );
  }
  if (
    !["pending_referral", "pending_vetting", "pending_approval", "active"]
      .includes(String(user.accountStatus))
  ) {
    throw new HttpsError("permission-denied", "This account cannot be activated.");
  }

  await userRef.update({
    isOnboarded: true,
    accountStatus: "active",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

export const validateReferralCodeSecure = onCall(
  { maxInstances: 20 },
  async (request) => {
    const code = requiredString(request.data?.code, "Referral code", 32).toUpperCase();
    if (PROMO_CODES.has(code)) {
      return { valid: true, code, kind: "promo", createdBy: "system" };
    }
    const snap = await db
      .collection(REFERRAL_COLLECTION)
      .where("code", "==", code)
      .limit(1)
      .get();
    const data = snap.docs[0]?.data();
    const valid = Boolean(
      data
      && data.isActive === true
      && typeof data.usedCount === "number"
      && typeof data.maxUses === "number"
      && data.usedCount < data.maxUses
    );
    return {
      valid,
      code,
      kind: valid ? "referral" : "invalid",
      createdBy: valid ? data?.createdBy ?? null : null,
    };
  }
);

export const redeemReferralCodeSecure = onCall(
  { maxInstances: 20 },
  async (request) => {
    const uid = requireUid(request);
    const code = requiredString(request.data?.code, "Referral code", 32).toUpperCase();
    const userRef = db.collection("users").doc(uid);
    if (PROMO_CODES.has(code)) {
      await db.runTransaction(async (transaction) => {
        const userSnap = await transaction.get(userRef);
        const user = userSnap.data();
        if (!user) throw new HttpsError("not-found", "Account not found.");
        if (user.referralCodeUsed === code) return;
        if (user.referralCodeUsed || user.promoRedeemedAt) {
          throw new HttpsError(
            "failed-precondition",
            "An introductory code was already used."
          );
        }

        const now = admin.firestore.Timestamp.now();
        transaction.update(userRef, {
          referralCodeUsed: code,
          promoRedeemedAt: now,
          freeAccessUntil: admin.firestore.Timestamp.fromMillis(
            now.toMillis() + 3 * 24 * 60 * 60 * 1000
          ),
          updatedAt: now,
        });
      });
      return { ok: true, kind: "promo" };
    }

    const codeQuery = db
      .collection(REFERRAL_COLLECTION)
      .where("code", "==", code)
      .limit(1);
    await db.runTransaction(async (transaction) => {
      const [userSnap, codeSnap] = await Promise.all([
        transaction.get(userRef),
        transaction.get(codeQuery),
      ]);
      const user = userSnap.data();
      const codeDoc = codeSnap.docs[0];
      const referral = codeDoc?.data();
      if (!user || !codeDoc || !referral) {
        throw new HttpsError("not-found", "Referral code not found.");
      }
      if (user.referredBy) {
        if (user.referralCodeUsed === code) return;
        throw new HttpsError("failed-precondition", "A referral code was already used.");
      }
      const createdBy = referral.createdBy as string | undefined;
      const usedBy = Array.isArray(referral.usedBy) ? referral.usedBy as string[] : [];
      const usedCount = typeof referral.usedCount === "number" ? referral.usedCount : 0;
      const maxUses = typeof referral.maxUses === "number" ? referral.maxUses : 0;
      if (
        referral.isActive !== true
        || !createdBy
        || createdBy === uid
        || usedBy.includes(uid)
        || usedCount >= maxUses
      ) {
        throw new HttpsError("failed-precondition", "Referral code is invalid or expired.");
      }

      const now = admin.firestore.Timestamp.now();
      transaction.update(codeDoc.ref, {
        usedCount: usedCount + 1,
        usedBy: [...usedBy, uid],
        updatedAt: now,
      });
      transaction.update(userRef, {
        referredBy: createdBy,
        referralCodeUsed: code,
        updatedAt: now,
      });
    });
    return { ok: true, kind: "referral" };
  }
);

export const ensureReferralCodeSecure = onCall(async (request) => {
  const uid = requireUid(request);
  await requireActiveUser(uid);
  const code = await generateReferralCodeForUser(uid);
  await db.collection("users").doc(uid).set(
    {
      referralCode: code,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return { code };
});

export const getReferralCountSecure = onCall(async (request) => {
  const uid = requireUid(request);
  await requireActiveUser(uid);
  const snap = await db
    .collection("users")
    .where("referredBy", "==", uid)
    .count()
    .get();
  return { count: snap.data().count };
});

export const placesAutocompleteSecure = onCall(
  {
    secrets: [googlePlacesApiKey],
    maxInstances: 20,
  },
  async (request) => {
    const uid = requireUid(request);
    await requireActiveUser(uid);
    const input = requiredString(request.data?.input, "Search text", 200);
    const sessionToken = requiredString(request.data?.sessionToken, "Session token", 128);
    const params = new URLSearchParams({
      input,
      key: googlePlacesApiKey.value(),
      sessiontoken: sessionToken,
      components: "country:us|country:ca",
      language: "en",
    });
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/place/autocomplete/json?${params.toString()}`
    );
    if (!response.ok) throw new HttpsError("unavailable", "Address search is unavailable.");
    const data = await response.json() as {
      predictions?: Array<{ place_id?: string; description?: string }>;
    };
    const predictions = (data?.predictions ?? [])
      .filter((prediction) => prediction.place_id && prediction.description)
      .slice(0, 8)
      .map((prediction) => ({
        placeId: prediction.place_id,
        description: prediction.description,
      }));
    return { predictions };
  }
);

export const placeDetailsSecure = onCall(
  {
    secrets: [googlePlacesApiKey],
    maxInstances: 20,
  },
  async (request) => {
    const uid = requireUid(request);
    await requireActiveUser(uid);
    const placeId = requiredString(request.data?.placeId, "Place", 300);
    const sessionToken = requiredString(request.data?.sessionToken, "Session token", 128);
    const params = new URLSearchParams({
      place_id: placeId,
      key: googlePlacesApiKey.value(),
      sessiontoken: sessionToken,
      fields: "formatted_address,geometry,address_components",
    });
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?${params.toString()}`
    );
    if (!response.ok) throw new HttpsError("unavailable", "Address details are unavailable.");
    const data = await response.json() as {
      result?: {
        formatted_address?: string;
        geometry?: { location?: { lat?: number; lng?: number } };
        address_components?: Array<{ long_name?: string; types?: string[] }>;
      };
    };
    const result = data?.result;
    const location = result?.geometry?.location;
    if (
      !result
      || typeof location?.lat !== "number"
      || typeof location?.lng !== "number"
    ) {
      throw new HttpsError("not-found", "Address details were not found.");
    }
    const cityComponent = result.address_components?.find((component) => (
      Array.isArray(component.types)
      && (
        component.types.includes("locality")
        || component.types.includes("sublocality")
      )
    ));
    return {
      formattedAddress: result.formatted_address ?? "",
      city: cityComponent?.long_name ?? "",
      lat: location.lat,
      lng: location.lng,
    };
  }
);

async function ensureServerWelcomeMessage(userId: string): Promise<void> {
  const participantKey = [SYSTEM_SENDER_ID, userId].sort().join("__");
  const existing = await db
    .collection("conversations")
    .where("participantKey", "==", participantKey)
    .limit(1)
    .get();
  if (!existing.empty) return;

  const welcomeText =
    "Welcome to WatchDog!\n\n"
    + "We're happy to have you in the community. If you need help, contact "
    + "hi@joinwatchdog.com.";
  const conversationRef = db.collection("conversations").doc();
  const messageRef = conversationRef.collection("messages").doc();
  const now = admin.firestore.Timestamp.now();
  const batch = db.batch();
  batch.create(conversationRef, {
    participantIds: [userId, SYSTEM_SENDER_ID],
    participantKey,
    swapRequestId: null,
    unreadCounts: { [userId]: 1 },
    lastMessage: "Welcome to WatchDog!",
    lastMessageAt: now,
    createdAt: now,
    updatedAt: now,
  });
  batch.create(messageRef, {
    conversationId: conversationRef.id,
    senderId: SYSTEM_SENDER_ID,
    text: welcomeText,
    read: false,
    createdAt: now,
  });
  await batch.commit();
}

export const cancelCommitmentSecure = onCall(
  { maxInstances: 20 },
  async (request) => {
    const uid = requireUid(request);
    const postId = requiredString(request.data?.postId, "Post", 256);
    const postRef = db.collection("swapPosts").doc(postId);

    const lateSitterMessage = await db.runTransaction<{
      ownerId: string;
      sitterName: string;
      dogName: string;
    } | null>(async (transaction) => {
      let message: {
        ownerId: string;
        sitterName: string;
        dogName: string;
      } | null = null;
      const postSnap = await transaction.get(postRef);
      const post = postSnap.data();
      if (!post) throw new HttpsError("not-found", "Booking not found.");
      if (post.status !== "open" && post.status !== "claimed") {
        throw new HttpsError("failed-precondition", "This booking cannot be cancelled.");
      }
      const isOwner = post.posterId === uid;
      const isSitter = post.claimedBy === uid;
      if (!isOwner && !isSitter) {
        throw new HttpsError("permission-denied", "You are not part of this booking.");
      }

      const start = post.startDate as admin.firestore.Timestamp | Date | undefined;
      const end = post.endDate as admin.firestore.Timestamp | Date | undefined;
      const startMillis = start instanceof admin.firestore.Timestamp
        ? start.toMillis()
        : start instanceof Date ? start.getTime() : 0;
      const endMillis = end instanceof admin.firestore.Timestamp
        ? end.toMillis()
        : end instanceof Date ? end.getTime() : startMillis;
      const hoursUntilStart = (startMillis - Date.now()) / (60 * 60 * 1000);
      const isLate = post.status === "claimed" && hoursUntilStart > 0 && hoursUntilStart < 24;
      const now = admin.firestore.Timestamp.now();
      const update: DocumentData = {
        status: "cancelled",
        updatedAt: now,
      };

      if (isLate && isSitter) {
        const ownerRef = db.collection("users").doc(post.posterId as string);
        const sitterRef = db.collection("users").doc(uid);
        const [ownerSnap, sitterSnap] = await Promise.all([
          transaction.get(ownerRef),
          transaction.get(sitterRef),
        ]);
        if (!ownerSnap.exists || !sitterSnap.exists) {
          throw new HttpsError("failed-precondition", "Booking members were not found.");
        }
        transaction.update(ownerRef, {
          points: admin.firestore.FieldValue.increment(2),
          updatedAt: now,
        });
        transaction.create(ownerRef.collection("pointsHistory").doc(), {
          type: "bonus",
          description: "Late cancellation compensation from WatchDog",
          points: 2,
          relatedPostId: postId,
          createdAt: now,
        });
        update.lateCancelled = true;
        update.lateCancelledBy = "sitter";
        message = {
          ownerId: post.posterId as string,
          sitterName: (sitterSnap.data()?.displayName as string | undefined) || "Your caretaker",
          dogName: (post.dogName as string | undefined) || "your dog",
        };
      } else if (isLate && isOwner && typeof post.claimedBy === "string") {
        const sitterId = post.claimedBy;
        const ownerRef = db.collection("users").doc(uid);
        const sitterRef = db.collection("users").doc(sitterId);
        const [ownerSnap, sitterSnap] = await Promise.all([
          transaction.get(ownerRef),
          transaction.get(sitterRef),
        ]);
        if (!ownerSnap.exists || !sitterSnap.exists) {
          throw new HttpsError("failed-precondition", "Booking members were not found.");
        }
        const totalDays = Math.max(
          1,
          Math.round((endMillis - startMillis) / (24 * 60 * 60 * 1000))
        );
        const pointsValue = Number(post.pointsOffered ?? post.pointsCost ?? 0);
        const paymentValue = Number(post.paymentAmount ?? 0);
        const cashOnly =
          post.compensationType === "payment"
          || (post.compensationType === "either" && !post.pointsOffered);
        const penalty = cashOnly
          ? Math.max(1, Math.ceil((totalDays > 1 ? paymentValue / totalDays : paymentValue) / 20))
          : Math.max(
            0,
            totalDays > 1
              ? Math.round((pointsValue / totalDays) * 10) / 10
              : pointsValue
          );
        transaction.update(ownerRef, {
          points: admin.firestore.FieldValue.increment(-penalty),
          updatedAt: now,
        });
        transaction.update(sitterRef, {
          points: admin.firestore.FieldValue.increment(penalty),
          updatedAt: now,
        });
        transaction.create(ownerRef.collection("pointsHistory").doc(), {
          type: "deduction",
          description: `Late cancellation penalty - ${(post.dogName as string | undefined) ?? "dog"} care`,
          points: -penalty,
          relatedPostId: postId,
          createdAt: now,
        });
        transaction.create(sitterRef.collection("pointsHistory").doc(), {
          type: "bonus",
          description: `Late cancellation compensation - ${(post.dogName as string | undefined) ?? "dog"} care`,
          points: penalty,
          relatedPostId: postId,
          createdAt: now,
        });
        update.lateCancelled = true;
        update.lateCancelledBy = "owner";
      }
      transaction.update(postRef, update);
      return message;
    });

    if (lateSitterMessage) {
      await sendServerSystemMessage(
        lateSitterMessage.ownerId,
        `We see that ${lateSitterMessage.sitterName} cancelled their commitment to care for `
        + `${lateSitterMessage.dogName} less than 24 hours in advance. We added 2 points `
        + "to your account to help compensate."
      );
    }
    return { ok: true };
  }
);

export const completeBookingSecure = onCall(
  { maxInstances: 20 },
  async (request) => {
    const uid = requireUid(request);
    const postId = requiredString(request.data?.postId, "Post", 256);
    const postRef = db.collection("swapPosts").doc(postId);

    await db.runTransaction(async (transaction) => {
      const postSnap = await transaction.get(postRef);
      const post = postSnap.data();
      if (!post) throw new HttpsError("not-found", "Booking not found.");
      if (post.status === "completed") return;
      if (post.status !== "claimed") {
        throw new HttpsError("failed-precondition", "This booking cannot be completed.");
      }
      if (post.posterId !== uid && post.claimedBy !== uid) {
        throw new HttpsError("permission-denied", "You are not part of this booking.");
      }

      const endMillis = timestampMillis(post.endDate);
      if (endMillis === null) {
        throw new HttpsError("failed-precondition", "This booking has no valid end date.");
      }
      if (Date.now() < endMillis) {
        throw new HttpsError("failed-precondition", "This booking has not ended yet.");
      }

      const now = admin.firestore.Timestamp.now();
      transaction.update(postRef, {
        status: "completed",
        completedAt: now,
        updatedAt: now,
      });
    });

    return { ok: true };
  }
);

async function sendServerSystemMessage(userId: string, text: string): Promise<void> {
  const participantKey = [SYSTEM_SENDER_ID, userId].sort().join("__");
  const existing = await db
    .collection("conversations")
    .where("participantKey", "==", participantKey)
    .limit(1)
    .get();
  let conversationRef: admin.firestore.DocumentReference;
  if (existing.empty) {
    conversationRef = db.collection("conversations").doc();
    await conversationRef.create({
      participantIds: [userId, SYSTEM_SENDER_ID],
      participantKey,
      swapRequestId: null,
      unreadCounts: { [userId]: 0 },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } else {
    conversationRef = existing.docs[0].ref;
  }
  const now = admin.firestore.Timestamp.now();
  const messageRef = conversationRef.collection("messages").doc();
  const batch = db.batch();
  batch.create(messageRef, {
    conversationId: conversationRef.id,
    senderId: SYSTEM_SENDER_ID,
    text,
    read: false,
    createdAt: now,
  });
  batch.set(conversationRef, {
    lastMessage: text.slice(0, 100),
    lastMessageAt: now,
    updatedAt: now,
    [`unreadCounts.${userId}`]: admin.firestore.FieldValue.increment(1),
  }, { merge: true });
  await batch.commit();
}

export const deleteMyAccount = onCall(
  { timeoutSeconds: 120 },
  async (request) => {
    const uid = requireUid(request);
    await admin.auth().deleteUser(uid);
    return { ok: true };
  }
);

type SuperwallEvent = {
  object?: string;
  type?: string;
  timestamp?: number;
  data?: {
    id?: string;
    name?: string;
    originalAppUserId?: string | null;
    expirationAt?: number | null;
    productId?: string;
    transactionId?: string;
    originalTransactionId?: string;
    environment?: string;
    price?: number;
    proceeds?: number;
    ts?: number;
    userAttributes?: Record<string, unknown>;
  };
};

export const superwallWebhook = onRequest(
  {
    secrets: [superwallWebhookSecret],
    maxInstances: 10,
    timeoutSeconds: 30,
  },
  async (request, response) => {
    if (request.method !== "POST") {
      response.status(405).send("Method not allowed");
      return;
    }
    const rawBody = request.rawBody?.toString("utf8") ?? "";
    const headers = {
      "svix-id": request.header("svix-id") ?? "",
      "svix-timestamp": request.header("svix-timestamp") ?? "",
      "svix-signature": request.header("svix-signature") ?? "",
    };

    let event: SuperwallEvent;
    try {
      event = new Webhook(superwallWebhookSecret.value()).verify(
        rawBody,
        headers
      ) as SuperwallEvent;
    } catch (error) {
      console.warn("[superwallWebhook] Signature verification failed:", error);
      response.status(400).send("Invalid signature");
      return;
    }

    const data = event.data;
    const eventId = data?.id;
    const attributeUid = data?.userAttributes?.firebaseUid;
    const uid = typeof attributeUid === "string"
      ? attributeUid
      : typeof data?.originalAppUserId === "string"
        ? data.originalAppUserId
        : "";
    if (!eventId || !uid || uid.length > 128) {
      response.status(202).send("Event has no linked Firebase user");
      return;
    }

    const eventRef = db.collection("superwallEvents").doc(
      crypto.createHash("sha256").update(eventId).digest("hex")
    );
    const userRef = db.collection("users").doc(uid);
    await db.runTransaction(async (transaction) => {
      const [processed, userSnap] = await Promise.all([
        transaction.get(eventRef),
        transaction.get(userRef),
      ]);
      if (processed.exists || !userSnap.exists) return;

      const eventName = data?.name ?? event.type ?? "";
      const now = admin.firestore.Timestamp.now();
      const eventTimestamp = typeof data?.ts === "number"
        ? data.ts
        : typeof event.timestamp === "number"
          ? event.timestamp
          : now.toMillis();
      const previousEventAt = userSnap.data()?.subscriptionEventAt as
        | admin.firestore.Timestamp
        | undefined;
      const isStale =
        previousEventAt !== undefined
        && previousEventAt.toMillis() > eventTimestamp;
      const userUpdate: DocumentData = {
        subscriptionUpdatedAt: now,
        subscriptionEventAt: admin.firestore.Timestamp.fromMillis(eventTimestamp),
        subscriptionProductId: data?.productId ?? null,
      };
      const isRefund =
        (typeof data?.price === "number" && data.price < 0)
        || (typeof data?.proceeds === "number" && data.proceeds < 0);
      if (isRefund) {
        userUpdate.subscriptionStatus = "expired";
        userUpdate.subscriptionAutoRenews = false;
      } else if (["initial_purchase", "renewal", "uncancellation"].includes(eventName)) {
        userUpdate.subscriptionStatus = "active";
        userUpdate.subscriptionAutoRenews = true;
        if (typeof data?.expirationAt === "number") {
          userUpdate.subscriptionExpiresAt =
            admin.firestore.Timestamp.fromMillis(data.expirationAt);
        }
      } else if (eventName === "expiration") {
        userUpdate.subscriptionStatus = "expired";
        userUpdate.subscriptionAutoRenews = false;
      } else if (eventName === "cancellation") {
        // Cancellation disables renewal but access lasts through expiration.
        userUpdate.subscriptionAutoRenews = false;
      } else if (eventName === "billing_issue") {
        userUpdate.subscriptionBillingIssue = true;
      }

      if (!isStale) {
        transaction.set(userRef, userUpdate, { merge: true });
      }
      transaction.create(eventRef, {
        eventId,
        eventName,
        userId: uid,
        productId: data?.productId ?? null,
        transactionId: data?.transactionId ?? null,
        originalTransactionId: data?.originalTransactionId ?? null,
        environment: data?.environment ?? null,
        ignoredAsStale: isStale,
        receivedAt: now,
      });
    });
    response.status(200).send("OK");
  }
);

export const backfillSecurityProjections = onCall(
  {
    timeoutSeconds: 540,
    memory: "1GiB",
  },
  async (request) => {
    const uid = requireUid(request);
    if (request.auth?.token.admin !== true) {
      throw new HttpsError("permission-denied", "Admin access required.");
    }

    const writer = db.bulkWriter();
    let profileCount = 0;
    let postCount = 0;
    let responseCount = 0;
    let blockCount = 0;
    let completedProfileCount = 0;
    const usersSnap = await db.collection("users").get();
    for (const userDoc of usersSnap.docs) {
      const data = userDoc.data() as DocumentData;
      const projection = buildPublicProfile(data);
      const publicRef = db.collection("publicProfiles").doc(userDoc.id);
      const userUpdates: DocumentData = {};
      if (projection) {
        writer.set(publicRef, projection);
        profileCount += 1;
      } else {
        writer.delete(publicRef);
      }
      if (data.pushToken || data.pushTokens) {
        writer.set(db.collection("privateUsers").doc(userDoc.id), {
          ...(data.pushToken ? { pushToken: data.pushToken } : {}),
          ...(data.pushTokens ? { pushTokens: data.pushTokens } : {}),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        userUpdates.pushToken = admin.firestore.FieldValue.delete();
        userUpdates.pushTokens = admin.firestore.FieldValue.delete();
      }
      if (
        data.profileSetupComplete !== true
        && typeof data.displayName === "string"
        && data.displayName.trim().length >= 1
        && typeof data.bio === "string"
        && data.bio.trim().length >= 20
        && typeof data.photoURL === "string"
        && data.photoURL.startsWith("https://")
      ) {
        userUpdates.profileSetupComplete = true;
        completedProfileCount += 1;
      }
      if (Object.keys(userUpdates).length > 0) {
        userUpdates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        writer.update(userDoc.ref, userUpdates);
      }
    }

    const postsSnap = await db.collection("swapPosts").get();
    for (const postDoc of postsSnap.docs) {
      const data = postDoc.data() as DocumentData;
      const projection = buildPublicPost(data);
      const publicRef = db.collection("publicSwapPosts").doc(postDoc.id);
      if (projection) {
        writer.set(publicRef, projection);
        postCount += 1;
      } else {
        writer.delete(publicRef);
      }
      if (Array.isArray(data.respondedBy)) {
        for (const response of data.respondedBy as DocumentData[]) {
          if (typeof response?.userId !== "string") continue;
          writer.set(
            db.collection("postResponses").doc(
              responseDocumentId(postDoc.id, response.userId)
            ),
            {
              postId: postDoc.id,
              posterId: data.posterId,
              responderId: response.userId,
              counterPoints: response.counterPoints ?? null,
              counterStatus: response.counterStatus ?? null,
              status: data.claimedBy === response.userId ? "accepted" : "pending",
              createdAt: response.respondedAt
                ?? admin.firestore.FieldValue.serverTimestamp(),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
          responseCount += 1;
        }
      }
    }

    const blocksSnap = await db.collection("blocks").get();
    for (const blockDoc of blocksSnap.docs) {
      const block = blockDoc.data();
      if (typeof block.blockerId !== "string" || typeof block.blockedId !== "string") continue;
      const deterministicId = `${block.blockerId}_${block.blockedId}`;
      if (blockDoc.id !== deterministicId) {
        writer.set(db.collection("blocks").doc(deterministicId), block);
        writer.delete(blockDoc.ref);
        blockCount += 1;
      }
    }
    await writer.close();
    console.log(`[backfillSecurityProjections] completed by ${uid}`);
    return {
      profileCount,
      postCount,
      responseCount,
      blockCount,
      completedProfileCount,
    };
  }
);

// ─── Helper: get all valid Expo push tokens for a user (multi-device) ─────────
async function getUserTokens(userId: string): Promise<string[]> {
  const [privateSnap, legacySnap] = await Promise.all([
    db.collection("privateUsers").doc(userId).get(),
    db.collection("users").doc(userId).get(),
  ]);
  const data = privateSnap.data() ?? legacySnap.data();
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

  const userRef = db.collection("privateUsers").doc(userId);
  const snap = await userRef.get();
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

  await userRef.update(update);
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
  const expo = new Expo({ accessToken: expoAccessToken.value() });

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
      console.error("[sendPush] Expo rejected a push ticket:", ticket.message);
    }
  });

  // Remove immediately-detected dead tokens
  if (immediateDeadTokens.length > 0) {
    await removeDeadTokens(userId, immediateDeadTokens);
  }

  // Check receipts after a delay (Expo recommends ~15 min, but we check after 30s
  // since Cloud Functions have a limited execution window)
  if (receiptIds.length > 0) {
    await checkReceipts(expo, userId, tokens, receiptIds);
  }
}

// ─── Receipt checking: find DeviceNotRegistered errors, clean up dead tokens ──
async function checkReceipts(
  expo: Expo,
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
  {
    document: "conversations/{convId}/messages/{msgId}",
    secrets: [expoAccessToken],
  },
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
  {
    document: "swapPosts/{postId}",
    secrets: [expoAccessToken],
  },
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
  {
    document: "swapPosts/{postId}",
    secrets: [expoAccessToken],
  },
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
  {
    document: "users/{userId}",
    secrets: [expoAccessToken],
  },
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

    const rewardRef = db.collection("referralRewards").doc(newUserId);
    const referrerRef = db.collection("users").doc(referrerId);
    let awarded = false;
    await db.runTransaction(async (transaction) => {
      const [rewardSnap, referrerSnap] = await Promise.all([
        transaction.get(rewardRef),
        transaction.get(referrerRef),
      ]);
      if (rewardSnap.exists) return;
      if (!referrerSnap.exists) {
        throw new Error(`Referrer ${referrerId} no longer exists`);
      }

      const now = admin.firestore.Timestamp.now();
      transaction.create(rewardRef, {
        referredUserId: newUserId,
        referrerId,
        points: REFERRAL_REWARD,
        createdAt: now,
      });
      transaction.update(referrerRef, {
        points: admin.firestore.FieldValue.increment(REFERRAL_REWARD),
        pendingReferralReward: {
          fromUserId: newUserId,
          fromUserName: newUserName,
          points: REFERRAL_REWARD,
          createdAt: now,
        },
        updatedAt: now,
      });
      transaction.create(
        referrerRef.collection("pointsHistory").doc(`referral_${newUserId}`),
        {
          type: "referral",
          description: `Referral reward - ${newUserName} joined using your code`,
          points: REFERRAL_REWARD,
          createdAt: now,
        }
      );
      awarded = true;
    });
    if (!awarded) return;

    const tokens = await getUserTokens(referrerId);
    if (tokens.length > 0) {
      await sendPushNotifications(
        referrerId,
        tokens,
        "You earned 3 points!",
        `${newUserName} joined WatchDog using your referral code!`,
        {
          type: "referral_reward",
          fromUserId: newUserId,
        }
      );
    }

    console.log(`[onReferralUsed] Awarded ${REFERRAL_REWARD} pts to ${referrerId} for referring ${newUserId}`);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 5. onPostCompleted — fires when a post status changes to "completed"
//    Sends push notifications to both owner and caregiver to leave a review.
//    Also sets pendingReview flag on both user docs for in-app popup.
// ─────────────────────────────────────────────────────────────────────────────
export const onPostCompleted = onDocumentUpdated(
  {
    document: "swapPosts/{postId}",
    secrets: [expoAccessToken],
  },
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
//   Idempotent (recompute-from-source). Keep this Gen 1 so the existing deployed
//   function can be updated in place; authorization uses an administrator claim.
// ─────────────────────────────────────────────────────────────────────────────
export const backfillReviewAggregates = functionsV1.https.onCall(async (_data, context) => {
  if (!context.auth?.uid || context.auth.token.admin !== true) {
    throw new functionsV1.https.HttpsError(
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
 * Trigger: swapPosts document created
 * Reads: users/{uid}/favorites where notifyOnPost === true
 */
export const onFavoriteUserPost = onDocumentCreated(
  {
    document: "swapPosts/{postId}",
    secrets: [expoAccessToken],
  },
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
  {
    schedule: "every 5 minutes",
    timeoutSeconds: 120,
    secrets: [expoAccessToken],
  },
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

export const onUserDeleted = functionsV1.auth.user().onDelete(async (user) => {
  const userId = user.uid;
  console.log(`[onUserDeleted] Cleaning up data for user ${userId}`);

  const results: Record<string, number> = {};

  try {
    const bucket = admin.storage().bucket();

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

    // Re-open bookings where the deleted user was the caregiver.
    const caregiverPosts = await db.collection("swapPosts")
      .where("claimedBy", "==", userId)
      .where("status", "==", "claimed")
      .get();
    if (!caregiverPosts.empty) {
      const batch = db.batch();
      caregiverPosts.docs.forEach((postDoc) => {
        const post = postDoc.data();
        const responses = Array.isArray(post.respondedBy)
          ? (post.respondedBy as DocumentData[]).filter(
            (entry) => entry?.userId !== userId
          )
          : [];
        batch.update(postDoc.ref, {
          status: "open",
          claimedBy: admin.firestore.FieldValue.delete(),
          respondedBy: responses,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });
      await batch.commit();
      results.reopenedBookings = caregiverPosts.size;
    }

    // Remove the user's responses from every still-existing post.
    const responseSnap = await db.collection("postResponses")
      .where("responderId", "==", userId).get();
    for (const responseDoc of responseSnap.docs) {
      const postId = responseDoc.data().postId as string | undefined;
      if (!postId) continue;
      const postRef = db.collection("swapPosts").doc(postId);
      const postSnap = await postRef.get();
      const post = postSnap.data();
      if (!post) continue;
      const responses = Array.isArray(post.respondedBy)
        ? (post.respondedBy as DocumentData[]).filter(
          (entry) => entry?.userId !== userId
        )
        : [];
      await postRef.update({
        respondedBy: responses,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    // 2. Delete reminders where user is the recipient (sitter-side)
    const sitterReminders = await deleteQueryResults(
      db.collection("reminders").where("recipientId", "==", userId)
    );
    results.sitterReminders = sitterReminders;

    // 3. Delete user's dogs
    const dogsSnap = await db.collection("dogs").where("ownerId", "==", userId).get();
    for (const dogDoc of dogsSnap.docs) {
      await bucket.deleteFiles({ prefix: `dogs/${dogDoc.id}/` });
      await dogDoc.ref.delete();
    }
    results.dogs = dogsSnap.size;

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
        await bucket.deleteFiles({ prefix: `chat-images/${convDoc.id}/` });
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
    await deleteQueryResults(
      db.collection("blockReports").where("reporterId", "==", userId)
    );
    await deleteQueryResults(
      db.collection("blockReports").where("reportedUserId", "==", userId)
    );

    // 8. Delete swap requests (legacy)
    await deleteQueryResults(
      db.collection("swapRequests").where("requesterId", "==", userId)
    );
    await deleteQueryResults(
      db.collection("swapRequests").where("receiverId", "==", userId)
    );

    await deleteQueryResults(
      db.collection("postResponses").where("responderId", "==", userId)
    );
    await deleteQueryResults(
      db.collection("postResponses").where("posterId", "==", userId)
    );

    // 9. Delete user doc + subcollections (pointsHistory, favorites)
    await deleteSubcollection(`users/${userId}`, "pointsHistory");
    await deleteSubcollection(`users/${userId}`, "favorites");
    await db.doc(`users/${userId}`).delete();
    await db.doc(`privateUsers/${userId}`).delete();
    await db.doc(`publicProfiles/${userId}`).delete();
    await db.doc(`referralRewards/${userId}`).delete();
    await db.doc(`referralCodeOwners/${userId}`).delete();
    results.userDoc = 1;

    // 10. Delete referral codes created by this user
    await deleteQueryResults(
      db.collection("referral_codes").where("createdBy", "==", userId)
    );
    await deleteQueryResults(
      db.collection("referralRewards").where("referrerId", "==", userId)
    );
    await deleteQueryResults(
      db.collection("signed-agreements").where("userId", "==", userId)
    );
    await deleteQueryResults(
      db.collection("superwallEvents").where("userId", "==", userId)
    );

    await Promise.all([
      bucket.deleteFiles({ prefix: `users/${userId}/` }),
      bucket.deleteFiles({ prefix: `care-photos/${userId}/` }),
      bucket.deleteFiles({ prefix: `service-photos/${userId}/` }),
      bucket.deleteFiles({ prefix: `dogs/temp_${userId}_` }),
    ]);

    console.log(`[onUserDeleted] Cleanup complete for ${userId}:`, JSON.stringify(results));
  } catch (error) {
    console.error(`[onUserDeleted] Failed for ${userId}:`, error);
    throw error;
  }
});
