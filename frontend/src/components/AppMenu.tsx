import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRegisterSW } from "virtual:pwa-register/react";
import { useTheme } from "../theme";
import { useAnchoredPopover } from "../hooks/useAnchoredPopover";
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

interface Props {
  semestreId: string | null;
  isAdmin?: boolean;
  onExportSimulation: () => void;
  onOpenSessions: () => void;
  onOpenAdmin: () => void;
  onLogout: () => void;
}

/**
 * Menu unique de l'application.
 *
 * Remplace les six actions qui vivaient côte à côte dans l'en-tête (Export, réglages,
 * Prévisions, Sessions, Admin, Déconnexion) : toutes au même poids typographique, elles
 * occupaient trois rangées et près d'un tiers de l'écran en mobile avant la première note.
 * Elles sont ici regroupées par intention, et l'en-tête retombe à deux rangées.
 */
export default function AppMenu({
  semestreId,
  isAdmin,
  onExportSimulation,
  onOpenSessions,
  onOpenAdmin,
  onLogout,
}: Props) {
  const { theme, toggle: toggleTheme } = useTheme();
  const { open, toggle, close, anchorRef, panelRef, style } = useAnchoredPopover();

  const [isSubscribed, setIsSubscribed] = useState(false);
  const [includeGradeValue, setIncludeGradeValue] = useState(false);
  const [preferencesLoading, setPreferencesLoading] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [testState, setTestState] = useState<"idle" | "sending" | "sent">("idle");

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  useEffect(() => {
    getCurrentPushSubscription().then(async (subscription) => {
      setIsSubscribed(Boolean(subscription));
      if (!subscription) return;
      const preferences = await getPushPreferences();
      setIncludeGradeValue(preferences.includeGradeValue);
    });
  }, []);

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
        return;
      }
      if (Notification.permission === "denied") {
        setPushError("Notifications bloquées. Autorise-les dans les réglages de ton navigateur.");
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPushError("Permission refusée. Tu peux l'accorder plus tard dans les réglages.");
        return;
      }
      await subscribeToPush(includeGradeValue);
      setIsSubscribed(true);
    } catch (err) {
      setPushError(err instanceof Error ? err.message : "La modification des notifications a échoué.");
    } finally {
      setPushLoading(false);
    }
  }

  async function handleIncludeGradeValueChange(next: boolean) {
    setPushError(null);
    setIncludeGradeValue(next);
    setPreferencesLoading(true);
    try {
      await updatePushPreferences(next);
    } catch (err) {
      setIncludeGradeValue(!next);
      setPushError(err instanceof Error ? err.message : "La mise à jour des préférences a échoué.");
    } finally {
      setPreferencesLoading(false);
    }
  }

  async function handleTestPush() {
    setPushError(null);
    setTestState("sending");
    try {
      await sendTestPush();
      setTestState("sent");
      setTimeout(() => setTestState("idle"), 4000);
    } catch (err) {
      setTestState("idle");
      setPushError(err instanceof Error ? err.message : "L'envoi du test a échoué.");
    }
  }

  const panel = open ? (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Menu"
      tabIndex={-1}
      style={style}
      className="z-[9999] animate-fade-in rounded-xl border border-line bg-surface shadow-pop focus:outline-none overflow-hidden"
    >
      {needRefresh && (
        <div className="flex items-center gap-3 border-b border-line bg-accent-soft px-4 py-3">
          <span className="min-w-0 flex-1 text-sm font-medium text-accent">Mise à jour disponible</span>
          <button
            onClick={() => updateServiceWorker(true)}
            className="shrink-0 rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg hover:bg-accent-hover"
          >
            Installer
          </button>
        </div>
      )}

      <Group label="Affichage">
        <Row label="Thème">
          <button
            onClick={toggleTheme}
            className="flex items-center gap-1.5 rounded-lg border border-line-strong px-2.5 py-1 text-xs font-medium text-fg hover:bg-inset"
          >
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
            {theme === "dark" ? "Clair" : "Sombre"}
          </button>
        </Row>
      </Group>

      <Group label="Notifications" hint="Reçois une alerte dès qu'une note apparaît sur ton relevé.">
        <Row label="Notifications push">
          {pushAvailable ? (
            <Switch checked={isSubscribed} disabled={pushLoading} onChange={handleTogglePush} label="Notifications push" />
          ) : (
            <span className="text-xs text-subtle">{needsInstall ? "Installe l'app" : "Non supporté"}</span>
          )}
        </Row>

        <label
          className={`flex items-center justify-between gap-3 px-4 py-2 text-xs ${
            isSubscribed ? "text-muted cursor-pointer hover:bg-inset" : "text-subtle"
          }`}
        >
          <span>Afficher la note dans la notification</span>
          <input
            type="checkbox"
            checked={includeGradeValue}
            disabled={!isSubscribed || preferencesLoading}
            onChange={(event) => handleIncludeGradeValueChange(event.currentTarget.checked)}
            className="h-4 w-4 shrink-0 rounded border-line-strong accent-accent disabled:opacity-40"
          />
        </label>

        {needsInstall && (
          <p className="mx-4 mb-2 rounded-lg bg-warn-soft px-2.5 py-2 text-xs text-warn">
            Sur iPhone, les notifications demandent d'ajouter l'app à l'écran d'accueil.
          </p>
        )}

        {isSubscribed && (
          <div className="px-4 pb-2">
            <button
              onClick={handleTestPush}
              disabled={testState !== "idle"}
              className="w-full rounded-lg border border-line-strong px-3 py-1.5 text-xs font-medium text-fg hover:bg-inset disabled:opacity-50"
            >
              {testState === "sent" ? "Notification envoyée" : testState === "sending" ? "Envoi…" : "Envoyer un test"}
            </button>
          </div>
        )}

        {pushError && <p className="px-4 pb-2 text-xs text-neg">{pushError}</p>}
      </Group>

      <Group label="Exporter">
        {semestreId && (
          <Item
            as="a"
            href={`/api/bulletin-pdf/${semestreId}?type=BUT`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={close}
            hint="Le PDF généré par ScoDoc"
          >
            Bulletin officiel
          </Item>
        )}
        <Item
          onClick={() => {
            close();
            onExportSimulation();
          }}
          hint="Mise en page lisible, notes simulées incluses"
        >
          Relevé avec simulation
        </Item>
      </Group>

      <Group label="Compte">
        <Item
          onClick={() => {
            close();
            window.location.href = "/preview/s5";
          }}
          hint="Programme prévisionnel BUT R&T"
        >
          Prévisions S5/S6
        </Item>
        <Item
          onClick={() => {
            close();
            onOpenSessions();
          }}
        >
          Mes appareils connectés
        </Item>
        {isAdmin && (
          <Item
            onClick={() => {
              close();
              onOpenAdmin();
            }}
          >
            Administration
          </Item>
        )}
        <Item
          danger
          onClick={() => {
            close();
            onLogout();
          }}
        >
          Se déconnecter
        </Item>
      </Group>
    </div>
  ) : null;

  return (
    <>
      {/* Une mise à jour du service worker n'est appliquée qu'après accord explicite
          (registerType: "prompt"). Le badge sur le bouton de menu ne suffit pas à la
          signaler : sans ce bandeau, l'utilisateur peut rester des jours sur une version
          périmée sans jamais ouvrir le menu. */}
      {needRefresh && (
        <div className="fixed left-1/2 top-3 z-[9998] w-[calc(100vw-1.5rem)] max-w-sm -translate-x-1/2 rounded-xl border border-line bg-surface px-3 py-2 shadow-pop animate-fade-in">
          <div className="flex items-center gap-3">
            <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />
            <span className="min-w-0 flex-1 text-sm text-fg">Nouvelle version disponible</span>
            <button
              onClick={() => updateServiceWorker(true)}
              className="shrink-0 rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg hover:bg-accent-hover"
            >
              Installer
            </button>
          </div>
        </div>
      )}
      <button
        ref={anchorRef}
        onClick={toggle}
        aria-label="Menu"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="relative shrink-0 rounded-lg border border-line-strong bg-surface p-2 text-fg hover:bg-inset transition-colors"
      >
        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path
            fillRule="evenodd"
            d="M2.5 5.5A.75.75 0 0 1 3.25 4.75h13.5a.75.75 0 0 1 0 1.5H3.25A.75.75 0 0 1 2.5 5.5Zm0 4.5a.75.75 0 0 1 .75-.75h13.5a.75.75 0 0 1 0 1.5H3.25A.75.75 0 0 1 2.5 10Zm0 4.5a.75.75 0 0 1 .75-.75h13.5a.75.75 0 0 1 0 1.5H3.25a.75.75 0 0 1-.75-.75Z"
            clipRule="evenodd"
          />
        </svg>
        {needRefresh && (
          <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-surface" />
        )}
      </button>
      {createPortal(panel, document.body)}
    </>
  );
}

/* ── Éléments internes du menu ────────────────────────────────────────────── */

function Group({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="border-b border-line last:border-b-0 py-1.5">
      <p className="px-4 pt-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-subtle">
        {label}
      </p>
      {hint && <p className="px-4 pb-1.5 text-xs text-muted">{hint}</p>}
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2">
      <span className="text-sm text-fg">{label}</span>
      {children}
    </div>
  );
}

function Item({
  as,
  hint,
  danger,
  children,
  ...props
}: {
  as?: "a";
  hint?: string;
  danger?: boolean;
  children: ReactNode;
} & React.AnchorHTMLAttributes<HTMLAnchorElement> &
  React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const className = `block w-full text-left px-4 py-2 text-sm transition-colors hover:bg-inset ${
    danger ? "text-neg" : "text-fg"
  }`;
  const content = (
    <>
      <span className="font-medium">{children}</span>
      {hint && <span className="block text-xs text-subtle">{hint}</span>}
    </>
  );
  return as === "a" ? (
    <a {...props} className={className}>
      {content}
    </a>
  ) : (
    <button type="button" {...props} className={className}>
      {content}
    </button>
  );
}

function Switch({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
        checked ? "bg-accent" : "bg-line-strong"
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-[1.125rem]" : "translate-x-[0.1875rem]"
        }`}
      />
    </button>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M10 2a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 10 2ZM10 15a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 10 15ZM10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM15.657 5.404a.75.75 0 1 0-1.06-1.06l-1.061 1.06a.75.75 0 0 0 1.06 1.06l1.06-1.06ZM6.464 14.596a.75.75 0 1 0-1.06-1.06l-1.06 1.06a.75.75 0 0 0 1.06 1.06l1.06-1.06ZM18 10a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 18 10ZM5 10a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 5 10ZM14.596 15.657a.75.75 0 0 0 1.06-1.06l-1.06-1.061a.75.75 0 1 0-1.06 1.06l1.06 1.061ZM5.404 6.464a.75.75 0 0 0 1.06-1.06L5.404 4.343a.75.75 0 1 0-1.06 1.06l1.06 1.061Z" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M7.455 2.004a.75.75 0 0 1 .26.77 7 7 0 0 0 9.958 7.967.75.75 0 0 1 1.067.853A8.5 8.5 0 1 1 6.647 1.921a.75.75 0 0 1 .808.083Z"
        clipRule="evenodd"
      />
    </svg>
  );
}
