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
