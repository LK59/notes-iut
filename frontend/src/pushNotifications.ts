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

/**
 * Désabonne UNIQUEMENT cet appareil. L'endpoint est capturé avant l'unsubscribe local et
 * transmis au serveur : sans lui, la route supprimait toutes les lignes du compte, donc
 * couper les notifications sur le PC les coupait aussi sur le téléphone — dont l'interface
 * continuait pourtant d'afficher « activées ».
 */
export async function unsubscribeFromPush(): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  const endpoint = subscription?.endpoint ?? null;
  if (subscription) await subscription.unsubscribe();
  await request<{ ok: boolean }>("/api/push/subscribe", {
    method: "DELETE",
    body: JSON.stringify({ endpoint }),
  });
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

export interface PushState {
  includeGradeValue: boolean;
  /** Le serveur connaît-il TOUJOURS l'abonnement de cet appareil ? Un abonnement local
   * peut survivre à sa ligne serveur (rotation de clé VAPID, purge après un 410, ancienne
   * révocation globale depuis un autre appareil) : l'app affichait alors « notifications
   * activées » alors que plus aucune notification ne pouvait arriver. */
  subscribedHere: boolean;
}

export async function getPushPreferences(endpoint?: string): Promise<PushState> {
  try {
    const query = endpoint ? `?endpoint=${encodeURIComponent(endpoint)}` : "";
    const data = await request<{ includeGradeValue: boolean; subscribedHere?: boolean }>(
      `/api/push/preferences${query}`
    );
    return { includeGradeValue: data.includeGradeValue, subscribedHere: Boolean(data.subscribedHere) };
  } catch {
    return { includeGradeValue: false, subscribedHere: false };
  }
}

/**
 * État réel des notifications sur cet appareil : abonnement local valide ET connu du
 * serveur. Si l'abonnement local est valide mais orphelin côté serveur, on le réenregistre
 * au passage — la permission est déjà accordée et l'intention de l'utilisateur inchangée.
 */
export async function loadPushState(): Promise<PushState & { subscribed: boolean }> {
  const subscription = await getCurrentPushSubscription();
  if (!subscription) return { subscribed: false, subscribedHere: false, includeGradeValue: false };
  const state = await getPushPreferences(subscription.endpoint);
  if (!state.subscribedHere) {
    try {
      await subscribeToPush(state.includeGradeValue);
      return { ...state, subscribedHere: true, subscribed: true };
    } catch {
      return { ...state, subscribed: false };
    }
  }
  return { ...state, subscribed: true };
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
