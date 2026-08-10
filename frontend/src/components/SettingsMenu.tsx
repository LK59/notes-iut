import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRegisterSW } from "virtual:pwa-register/react";
import { useTheme } from "../theme";
import {
  getCurrentPushSubscription,
  getPushPreferences,
  isPushSupported,
  isStandalonePwa,
  sendTestPush,
  subscribeToPush,
  unsubscribeFromPush,
  updatePushPreferences,
} from "../pushNotifications";

export default function SettingsMenu() {
  const { theme, toggle: toggleTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({});

  const [isSubscribed, setIsSubscribed] = useState(false);
  const [includeGradeValue, setIncludeGradeValue] = useState(false);
  const [preferencesLoading, setPreferencesLoading] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [testSent, setTestSent] = useState(false);
  const [testLoading, setTestLoading] = useState(false);

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  useEffect(() => {
    getCurrentPushSubscription().then(async (sub) => {
      const subscribed = !!sub;
      setIsSubscribed(subscribed);
      if (subscribed) {
        const preferences = await getPushPreferences();
        setIncludeGradeValue(preferences.includeGradeValue);
      }
    });
  }, []);

  function openMenu() {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const margin = 8;
      const width = Math.min(320, window.innerWidth - margin * 2);
      const top = Math.min(rect.bottom + margin, window.innerHeight - margin);
      const left =
        window.innerWidth < 640
          ? (window.innerWidth - width) / 2
          : Math.min(Math.max(margin, rect.right - width), window.innerWidth - width - margin);
      setPopupStyle({
        position: "fixed",
        top,
        left,
        width,
        maxHeight: `calc(100vh - ${top + margin}px)`,
        overflowY: "auto",
      });
    }
    setOpen((v) => !v);
  }

  // Ferme le menu au clic extérieur
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (buttonRef.current && !buttonRef.current.contains(e.target as Node)) {
        // Vérifie aussi si le clic est dans le popup (via data-settings-popup)
        const popup = document.querySelector("[data-settings-popup]");
        if (!popup?.contains(e.target as Node)) setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Ferme au clavier (Échap) et rend le focus au bouton déclencheur ; déplace le focus
  // dans le panneau à l'ouverture pour les utilisateurs au clavier/lecteur d'écran.
  useEffect(() => {
    if (!open) return;
    popupRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const pushAvailable = isPushSupported();
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const needsInstall = isIos && !isStandalonePwa();

  async function handleTogglePush() {
    setPushError(null);
    setPushLoading(true);
    try {
      if (isSubscribed) {
        await unsubscribeFromPush();
        setIsSubscribed(false);
        setIncludeGradeValue(false);
      } else {
        if (Notification.permission === "denied") {
          setPushError("Notifications bloquées. Active-les dans les paramètres de ton navigateur.");
          return;
        }
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setPushError("Permission refusée. Tu peux l'activer dans les paramètres.");
          return;
        }
        await subscribeToPush(includeGradeValue);
        setIsSubscribed(true);
      }
    } catch (err) {
      setPushError(err instanceof Error ? err.message : "Erreur lors de la modification des notifications.");
    } finally {
      setPushLoading(false);
    }
  }

  async function handleIncludeGradeValueChange(nextValue: boolean) {
    setPushError(null);
    setIncludeGradeValue(nextValue);
    setPreferencesLoading(true);
    try {
      await updatePushPreferences(nextValue);
    } catch (err) {
      setIncludeGradeValue(!nextValue);
      setPushError(err instanceof Error ? err.message : "Mise à jour des préférences échouée.");
    } finally {
      setPreferencesLoading(false);
    }
  }

  async function handleTestPush() {
    setPushError(null);
    setTestLoading(true);
    try {
      await sendTestPush();
      setTestSent(true);
      setTimeout(() => setTestSent(false), 4000);
    } catch (err) {
      setPushError(err instanceof Error ? err.message : "Envoi du test échoué.");
    } finally {
      setTestLoading(false);
    }
  }

  const popup = open ? (
    <div
      data-settings-popup
      ref={popupRef}
      role="dialog"
      aria-label="Paramètres"
      tabIndex={-1}
      style={popupStyle}
      className="z-[9999] bg-white dark:bg-slate-900 border border-sky-200/80 dark:border-slate-700/80 rounded-2xl shadow-2xl shadow-sky-900/10 dark:shadow-black/50 p-4 space-y-4 focus:outline-none"
    >
      <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
        Paramètres
      </p>

      {/* Thème */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-700 dark:text-slate-300">Thème</span>
        <button
          onClick={toggleTheme}
          className="flex items-center gap-1.5 rounded-md border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-slate-800 px-3 py-1.5 text-sm text-sky-700 dark:text-sky-200 hover:bg-sky-100 dark:hover:bg-slate-700"
        >
          {theme === "dark" ? (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path d="M10 2a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 10 2ZM10 15a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 10 15ZM10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM15.657 5.404a.75.75 0 1 0-1.06-1.06l-1.061 1.06a.75.75 0 0 0 1.06 1.06l1.06-1.06ZM6.464 14.596a.75.75 0 1 0-1.06-1.06l-1.06 1.06a.75.75 0 0 0 1.06 1.06l1.06-1.06ZM18 10a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 18 10ZM5 10a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 5 10ZM14.596 15.657a.75.75 0 0 0 1.06-1.06l-1.06-1.061a.75.75 0 1 0-1.06 1.06l1.06 1.061ZM5.404 6.464a.75.75 0 0 0 1.06-1.06L5.404 4.343a.75.75 0 1 0-1.06 1.06l1.06 1.061Z" />
              </svg>
              Clair
            </>
          ) : (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path fillRule="evenodd" d="M7.455 2.004a.75.75 0 0 1 .26.77 7 7 0 0 0 9.958 7.967.75.75 0 0 1 1.067.853A8.5 8.5 0 1 1 6.647 1.921a.75.75 0 0 1 .808.083Z" clipRule="evenodd" />
              </svg>
              Sombre
            </>
          )}
        </button>
      </div>

      <hr className="border-sky-100 dark:border-slate-800" />

      {/* Notifications push */}
      <div className="space-y-2">
        <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          Reçois une notification quand une nouvelle note apparaît sur ton relevé.
        </p>
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-700 dark:text-slate-300">Notifications push</span>
          {!pushAvailable ? (
            <span className="text-xs text-slate-400 dark:text-slate-500">
              {needsInstall ? "Installe l'app" : "Non supporté"}
            </span>
          ) : (
            <button
              onClick={handleTogglePush}
              disabled={pushLoading}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                isSubscribed ? "bg-sky-600" : "bg-slate-300 dark:bg-slate-600"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  isSubscribed ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          )}
        </div>

        <label
          className={`flex items-center justify-between gap-3 rounded-md border px-2 py-1.5 ${
            isSubscribed
              ? "border-sky-100 dark:border-slate-800"
              : "border-slate-100 dark:border-slate-800 opacity-60"
          }`}
        >
          <span className="text-xs text-slate-600 dark:text-slate-400">
            Indiquer la note dans la notification
          </span>
          <input
            type="checkbox"
            checked={includeGradeValue}
            disabled={!isSubscribed || preferencesLoading}
            onChange={(event) => handleIncludeGradeValueChange(event.currentTarget.checked)}
            className="h-4 w-4 rounded border-slate-300 text-sky-600 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </label>

        {needsInstall && (
          <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md px-2 py-1.5">
            Sur iOS, les notifications nécessitent d'installer l'app via "Ajouter à l'écran d'accueil".
          </p>
        )}

        {isSubscribed && (
          <button
            onClick={handleTestPush}
            disabled={testLoading || testSent}
            className="w-full text-center rounded-md border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-slate-800 px-3 py-1.5 text-sm text-sky-700 dark:text-sky-200 hover:bg-sky-100 dark:hover:bg-slate-700 disabled:opacity-50"
          >
            {testSent ? "Notification envoyée !" : testLoading ? "Envoi…" : "Envoyer une notification test"}
          </button>
        )}

        {pushError && <p className="text-xs text-red-600 dark:text-red-400">{pushError}</p>}
      </div>

      {/* Mise à jour PWA */}
      {needRefresh && (
        <>
          <hr className="border-sky-100 dark:border-slate-800" />
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-amber-400 rounded-full shrink-0" />
              <span className="text-sm text-slate-700 dark:text-slate-300">Mise à jour disponible</span>
            </div>
            <button
              onClick={() => updateServiceWorker(true)}
              className="w-full text-center rounded-md bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 text-sm font-medium"
            >
              Installer la mise à jour
            </button>
          </div>
        </>
      )}
    </div>
  ) : null;

  return (
    <>
      {needRefresh && (
        <div className="fixed left-1/2 top-3 z-[9998] w-[calc(100vw-1rem)] max-w-sm -translate-x-1/2 rounded-lg border border-amber-200 bg-white px-3 py-2 shadow-lg shadow-slate-900/10 dark:border-amber-800 dark:bg-slate-900">
          <div className="flex items-center gap-3">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-amber-400" />
            <span className="min-w-0 flex-1 text-sm text-slate-700 dark:text-slate-200">
              Mise à jour disponible
            </span>
            <button
              onClick={() => updateServiceWorker(true)}
              className="shrink-0 rounded-md bg-amber-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-600"
            >
              Installer
            </button>
          </div>
        </div>
      )}
      <button
        ref={buttonRef}
        onClick={openMenu}
        aria-label="Paramètres"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Paramètres"
        className="relative rounded-md border border-sky-200 dark:border-sky-800 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-sm text-sky-700 dark:text-sky-200 hover:bg-sky-50 dark:hover:bg-slate-700 flex items-center gap-1.5"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
          <path
            fillRule="evenodd"
            d="M7.84 1.804A1 1 0 0 1 8.82 1h2.36a1 1 0 0 1 .98.804l.331 1.652a6.993 6.993 0 0 1 1.929 1.115l1.598-.54a1 1 0 0 1 1.186.447l1.18 2.044a1 1 0 0 1-.205 1.251l-1.267 1.113a7.047 7.047 0 0 1 0 2.228l1.267 1.113a1 1 0 0 1 .206 1.25l-1.18 2.045a1 1 0 0 1-1.187.447l-1.598-.54a6.993 6.993 0 0 1-1.929 1.115l-.33 1.652a1 1 0 0 1-.98.804H8.82a1 1 0 0 1-.98-.804l-.331-1.652a6.993 6.993 0 0 1-1.929-1.115l-1.598.54a1 1 0 0 1-1.186-.447l-1.18-2.044a1 1 0 0 1 .205-1.251l1.267-1.114a7.05 7.05 0 0 1 0-2.227L1.821 7.773a1 1 0 0 1-.206-1.25l1.18-2.045a1 1 0 0 1 1.187-.447l1.598.54A6.992 6.992 0 0 1 7.51 3.456L7.84 1.804ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
            clipRule="evenodd"
          />
        </svg>
        <span className="hidden sm:inline">Paramètres</span>
        {needRefresh && (
          <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-amber-400 rounded-full border-2 border-white dark:border-slate-800" />
        )}
      </button>
      {createPortal(popup, document.body)}
    </>
  );
}
