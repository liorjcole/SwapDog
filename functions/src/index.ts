import * as admin from "firebase-admin";
import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as functions from "firebase-functions";
import Expo, { ExpoPushMessage, ExpoPushTicket, ExpoPushReceipt } from "expo-server-sdk";


admin.initializeApp();
const db = admin.firestore();
const expo = new Expo();

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

      // ── Set pendingReview on the CAREGIVER (they review each dog + the owner) ──
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
          `Leave a review for ${ownerName} and ${dogNameStr}!`,
          { type: "review_prompt", postId },
        );
      }

      console.log(`[onPostCompleted] Review prompts sent for post ${postId}`);
    } catch (error) {
      console.error("[onPostCompleted] Failed:", error);
    }
  }
);

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

// ── Core scheduling logic ───────────────────────────────────────────────────

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

  // Helper to determine if a responsibility fires on a given day
  const shouldFireOnDay = (
    daily: boolean,
    dayIndex: number,
    totalDays: number
  ): boolean => {
    return daily || totalDays === 1 || dayIndex === 0;
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

  // ── 2. Feeding reminders ──
  if (addOns.includes("feeding")) {
    const feedingSlots =
      (postData.feedingSlots as { time: string; daily: boolean }[]) || [];

    if (overnightDays) {
      for (let i = 0; i < overnightDays.length; i++) {
        for (const slot of feedingSlots) {
          if (shouldFireOnDay(slot.daily, i, overnightDays.length)) {
            const feedTime = buildDateTimeET(overnightDays[i], slot.time);
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
        startTime: string;
        repeatDaily?: boolean;
      }[]) || [];

    if (overnightDays) {
      for (let i = 0; i < overnightDays.length; i++) {
        for (const session of walkSessions) {
          if (
            shouldFireOnDay(
              session.repeatDaily ?? false,
              i,
              overnightDays.length
            )
          ) {
            const walkTime = buildDateTimeET(
              overnightDays[i],
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
    } else if (startDate) {
      for (const session of walkSessions) {
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
        flexible: boolean;
        startTime: string | null;
        durationMins: number;
        repeatDaily?: boolean;
      }[]) || [];

    for (const session of playSessions) {
      if (session.flexible) {
        // Flexible playtime → morning reminder at 8 AM
        const totalMins = session.durationMins;
        const durationText =
          totalMins >= 60
            ? `${Math.floor(totalMins / 60)}h${totalMins % 60 > 0 ? ` ${totalMins % 60}m` : ""}`
            : `${totalMins} minutes`;

        if (overnightDays) {
          for (let i = 0; i < overnightDays.length; i++) {
            if (
              shouldFireOnDay(
                session.repeatDaily ?? false,
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
              shouldFireOnDay(
                session.repeatDaily ?? false,
                i,
                overnightDays.length
              )
            ) {
              const playTime = buildDateTimeET(
                overnightDays[i],
                session.startTime!
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
        details: string;
        daily: boolean;
      }[]) || [];

    if (overnightDays) {
      for (let i = 0; i < overnightDays.length; i++) {
        for (const slot of medSlots) {
          if (shouldFireOnDay(slot.daily, i, overnightDays.length)) {
            const medTime = buildDateTimeET(overnightDays[i], slot.time);
            addReminder(
              medTime,
              "medication",
              "💊 Medication time!",
              `Time to give ${displayDogName} medication: ${slot.details}`
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
          `Time to give ${displayDogName} medication: ${slot.details}`
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
