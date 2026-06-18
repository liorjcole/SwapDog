import * as admin from "firebase-admin";
import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
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
  "posts/{postId}",
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
