/** Gestion des abonnements push Web : subscribe / unsubscribe / state.
 *
 * Tous les appels passent par request() d'api.ts et non par fetch brut : ils héritent
 * ainsi du timeout de 15 s, de la reconnexion silencieuse sur 401 et des messages
 * d'erreur normalisés. Sans ça, activer les notifications sur une session expirée
 * échouait avec un message générique là où le reste de l'app se reconnecte tout seul.
 */
import { request } from "./api";

export function isPushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function isStandalonePwa(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && Boolean((navigator as { standalone?: boolean }).standalone))
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function subscriptionUsesVapidKey(subscription: PushSubscription, vapidKey: string): boolean {
  const currentKey = subscription.options.applicationServerKey;
  if (!currentKey) return false;
  return arrayBufferToBase64Url(currentKey) === vapidKey;
}

async function getVapidPublicKey(): Promise<string> {
  const data = await request<{ vapid_public_key: string }>("/api/push/vapid-key");
  return data.vapid_public_key;
}

export async function subscribeToPush(includeGradeValue = false): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  const vapidKey = await getVapidPublicKey();
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !subscriptionUsesVapidKey(subscription, vapidKey)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
    });
  }
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error("Abonnement push incomplet. Réessaie après avoir rechargé la page.");
  }
  await request<{ ok: boolean }>("/api/push/subscribe", {
    method: "POST",
    body: JSON.stringify({
      endpoint: json.endpoint,
      p256dh: json.keys?.p256dh,
      auth: json.keys?.auth,
      includeGradeValue,
    }),
  });
}

export async function unsubscribeFromPush(): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (subscription) await subscription.unsubscribe();
  await request<{ ok: boolean }>("/api/push/subscribe", { method: "DELETE" });
}

export async function getCurrentPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return null;
    const vapidKey = await getVapidPublicKey();
    if (subscriptionUsesVapidKey(subscription, vapidKey)) return subscription;
    await subscription.unsubscribe();
    return null;
  } catch {
    return null;
  }
}

export async function getPushPreferences(): Promise<{ includeGradeValue: boolean }> {
  try {
    return await request<{ includeGradeValue: boolean }>("/api/push/preferences");
  } catch {
    return { includeGradeValue: false };
  }
}

export async function updatePushPreferences(includeGradeValue: boolean): Promise<void> {
  await request<{ ok: boolean }>("/api/push/preferences", {
    method: "PUT",
    body: JSON.stringify({ includeGradeValue }),
  });
}

export async function sendTestPush(): Promise<void> {
  await request<{ ok: boolean }>("/api/push/test", { method: "POST" });
}
