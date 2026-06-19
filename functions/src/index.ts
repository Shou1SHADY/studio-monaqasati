import * as admin from "firebase-admin";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { setGlobalOptions } from "firebase-functions/v2";
import { auth as authFunctionsV1 } from "firebase-functions/v1";

admin.initializeApp();
const db = admin.firestore();

// europe-west1 is the closest GCP region to Saudi Arabia
setGlobalOptions({ region: "europe-west1" });

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  badge?: number;
  channelId?: string;
  priority?: "default" | "normal" | "high";
}

async function sendExpoPush(message: ExpoPushMessage): Promise<void> {
  const res = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "Accept-Encoding": "gzip, deflate",
    },
    body: JSON.stringify(message),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Expo push API returned ${res.status}: ${text}`);
  }

  const json = await res.json() as { data?: { status: string; message?: string } };
  if (json.data?.status === "error") {
    console.error("[Push] Expo delivery error:", json.data.message);
  }
}

async function getUserPushToken(userId: string): Promise<string | null> {
  try {
    const snap = await db.doc(`users/${userId}`).get();
    if (!snap.exists) return null;
    const token = snap.data()?.expoPushToken as string | undefined;
    return token && token.startsWith("ExponentPushToken[") ? token : null;
  } catch {
    return null;
  }
}

// ─── Main trigger ────────────────────────────────────────────────────────────
//
// Fires when any notification document is created under users/{userId}/notifications/
// Reads the target user's Expo push token and delivers the real push notification.
//
export const onNotificationCreated = onDocumentCreated(
  "users/{userId}/notifications/{notifId}",
  async (event) => {
    const { userId } = event.params;
    const data = event.data?.data();
    if (!data) return;

    // Respect silent flag — in-app only, no push
    if (data.silent === true) return;

    const token = await getUserPushToken(userId);
    if (!token) {
      console.log(`[Push] No valid push token for user ${userId}`);
      return;
    }

    const title: string = (data.title as string) ?? "إشعار جديد";
    const body: string = (data.message as string) ?? (data.body as string) ?? "";

    const message: ExpoPushMessage = {
      to: token,
      title,
      body,
      sound: "default",
      channelId: "mdmak-default",
      priority: "high",
      data: {
        type: (data.type as string) ?? "general",
        offerId: (data.offerId as string) ?? null,
        rfqId: (data.rfqId as string) ?? null,
        chatId: (data.chatId as string) ?? null,
        notifId: event.params.notifId,
      },
    };

    try {
      await sendExpoPush(message);
      console.log(`[Push] ✓ Delivered to user ${userId}: "${title}"`);

      // Tag the in-app notification so we know push was sent
      await event.data?.ref.update({
        pushSent: true,
        pushSentAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (e: any) {
      console.error(`[Push] ✗ Delivery failed for user ${userId}:`, e.message);
      // Don't rethrow — the in-app notification already succeeded
    }
  }
);

// ─── Token cleanup on account deletion ───────────────────────────────────────
//
// When a user is deleted from Firebase Auth (console, Admin SDK, or self-delete),
// remove their push token so it doesn't accumulate as stale data.
//
export const cleanupDeletedUser = authFunctionsV1.user().onDelete(async (user) => {
  try {
    await db.doc(`users/${user.uid}`).update({
      expoPushToken: admin.firestore.FieldValue.delete(),
      pushTokenUpdatedAt: admin.firestore.FieldValue.delete(),
      devicePlatform: admin.firestore.FieldValue.delete(),
    });
    console.log(`[Push] ✓ Cleared push token for deleted user ${user.uid}`);
  } catch (e: any) {
    console.warn(`[Push] Token cleanup failed for ${user.uid}:`, e.message);
  }
});
