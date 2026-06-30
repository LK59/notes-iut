import { useEffect, useState } from "react";
import { getMySessions, revokeAllMySessions, revokeMySession, type RememberSession } from "../api";

function fmtTime(value?: number): string {
  if (!value) return "-";
  return new Date(value * 1000).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortAgent(value?: string): string {
  if (!value) return "Appareil inconnu";
  return value.length > 90 ? `${value.slice(0, 90)}...` : value;
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
      .catch((err) => setError(err instanceof Error ? err.message : "Erreur de chargement"))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function revoke(sessionId: string) {
    await revokeMySession(sessionId);
    load();
  }

  async function revokeAll() {
    await revokeAllMySessions();
    load();
  }

  return (
    <div className="fixed inset-0 z-40 bg-slate-950/50 backdrop-blur-sm flex items-center justify-center p-4 print:hidden">
      <div className="w-full max-w-2xl rounded-xl border border-sky-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-4 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-sky-950 dark:text-sky-100">Mes appareils connectés</h2>
          <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">Fermer</button>
        </div>
        {loading && <p className="text-sm text-slate-500">Chargement...</p>}
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        {!loading && sessions.length === 0 && (
          <p className="text-sm text-slate-600 dark:text-slate-300">Aucun appareil mémorisé.</p>
        )}
        <div className="space-y-2 max-h-[60vh] overflow-y-auto">
          {sessions.map((session) => (
            <div key={session.session_id} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-slate-800 dark:text-slate-100 truncate">{shortAgent(session.user_agent)}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Dernière utilisation : {fmtTime(session.last_used_at)}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Expiration : {fmtTime(session.expires_at)}</p>
                </div>
                <button
                  onClick={() => revoke(session.session_id).catch((err) => setError(err instanceof Error ? err.message : "Erreur"))}
                  className="shrink-0 rounded-md border border-red-200 dark:border-red-800 px-2 py-1 text-xs text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40"
                >
                  Révoquer
                </button>
              </div>
            </div>
          ))}
        </div>
        {sessions.length > 0 && (
          <button
            onClick={() => revokeAll().catch((err) => setError(err instanceof Error ? err.message : "Erreur"))}
            className="rounded-md border border-red-200 dark:border-red-800 px-3 py-1.5 text-sm text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40"
          >
            Révoquer tous les appareils
          </button>
        )}
      </div>
    </div>
  );
}
