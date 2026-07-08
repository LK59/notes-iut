/** Gestion des abonnements push Web : subscribe / unsubscribe / state. */

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
  const res = await fetch("/api/push/vapid-key");
  if (!res.ok) throw new Error("Impossible de récupérer la clé VAPID.");
  const data: { vapid_public_key: string } = await res.json();
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
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    });
  }
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error("Abonnement push incomplet. Réessaie après avoir rechargé la page.");
  }
  await fetch("/api/push/subscribe", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
    body: JSON.stringify({ endpoint: json.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth, includeGradeValue }),
  }).then((r) => {
    if (!r.ok) throw new Error("Enregistrement de l'abonnement échoué.");
  });
}

export async function unsubscribeFromPush(): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (subscription) await subscription.unsubscribe();
  await fetch("/api/push/subscribe", {
    method: "DELETE",
    credentials: "include",
    headers: { "X-Requested-With": "XMLHttpRequest" },
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

export async function getPushPreferences(): Promise<{ includeGradeValue: boolean }> {
  const res = await fetch("/api/push/preferences", { credentials: "include" });
  if (!res.ok) return { includeGradeValue: false };
  return res.json();
}

export async function updatePushPreferences(includeGradeValue: boolean): Promise<void> {
  const res = await fetch("/api/push/preferences", {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
    body: JSON.stringify({ includeGradeValue }),
  });
  if (!res.ok) throw new Error("Mise à jour des préférences échouée.");
}

export async function sendTestPush(): Promise<void> {
  const res = await fetch("/api/push/test", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? "Envoi du test échoué.");
  }
}
