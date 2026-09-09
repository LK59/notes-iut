import { useEffect, useState } from "react";
import { getMySessions, revokeAllMySessions, revokeMySession, type RememberSession } from "../api";
import { Button } from "./ui";

function fmtTime(value?: number): string {
  if (!value) return "—";
  return new Date(value * 1000).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Les user-agents complets sont illisibles : on extrait navigateur + système. */
function describeDevice(userAgent?: string): string {
  if (!userAgent) return "Appareil inconnu";
  const os =
    /iPhone|iPad/i.test(userAgent) ? "iOS"
    : /Android/i.test(userAgent) ? "Android"
    : /Mac OS X/i.test(userAgent) ? "macOS"
    : /Windows/i.test(userAgent) ? "Windows"
    : /Linux/i.test(userAgent) ? "Linux"
    : null;
  const browser =
    /Edg\//i.test(userAgent) ? "Edge"
    : /Chrome\//i.test(userAgent) && !/Chromium/i.test(userAgent) ? "Chrome"
    : /Firefox\//i.test(userAgent) ? "Firefox"
    : /Safari\//i.test(userAgent) ? "Safari"
    : null;
  if (browser && os) return `${browser} sur ${os}`;
  return browser ?? os ?? "Appareil inconnu";
}

export default function SessionsPanel({ onClose }: { onClose: () => void }) {
  const [sessions, setSessions] = useState<RememberSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    getMySessions()
      .then((data) => setSessions(data.sessions))
      .catch((err) => setError(err instanceof Error ? err.message : "Chargement impossible."))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function run(action: Promise<unknown>) {
    action
      .then(load)
      .catch((err) => setError(err instanceof Error ? err.message : "Opération impossible."));
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4 print:hidden"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Mes appareils connectés"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-lg rounded-t-2xl sm:rounded-xl border border-line bg-surface shadow-pop max-h-[85vh] flex flex-col"
      >
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-fg">Mes appareils connectés</h2>
            <p className="text-xs text-muted">Chaque appareil où tu as coché « rester connecté ».</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Fermer"
            className="shrink-0 rounded-lg p-1.5 text-muted hover:bg-inset hover:text-fg"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {loading && <p className="px-4 py-6 text-sm text-muted">Chargement…</p>}
          {error && <p className="px-4 py-3 text-sm text-neg">{error}</p>}
          {!loading && sessions.length === 0 && !error && (
            <p className="px-4 py-6 text-sm text-muted">Aucun appareil mémorisé.</p>
          )}
          <div className="divide-y divide-line">
            {sessions.map((session) => (
              <div key={session.session_id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-fg">
                    {describeDevice(session.user_agent)}
                    {session.is_current && (
                      <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-normal text-accent">
                        cet appareil
                      </span>
                    )}
                  </p>
                  <p className="mono text-xs text-subtle">
                    Dernier accès {fmtTime(session.last_used_at)}
                  </p>
                  {session.expired ? (
                    <p className="mono text-xs text-neg">
                      Expiré depuis le {fmtTime(session.effective_expires_at)} — reconnexion requise
                    </p>
                  ) : (
                    <p className="mono text-xs text-subtle">
                      Expire le {fmtTime(session.effective_expires_at)}
                      {session.effective_expires_at < session.expires_at && " sans nouvel accès"}
                    </p>
                  )}
                </div>
                <Button
                  tone="quiet"
                  className="text-neg hover:text-neg"
                  onClick={() => run(revokeMySession(session.session_id))}
                >
                  Révoquer
                </Button>
              </div>
            ))}
          </div>
        </div>

        {sessions.length > 0 && (
          <footer className="border-t border-line px-4 py-3">
            <Button tone="danger" onClick={() => run(revokeAllMySessions())}>
              Révoquer tous les appareils
            </Button>
          </footer>
        )}
      </div>
    </div>
  );
}
