import { useEffect, useState } from "react";
import {
  getAdminRememberEvents,
  getAdminRememberSessions,
  getAdminStatus,
  type RememberEvent,
  type RememberSession,
} from "../api";

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

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function fmtValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === "boolean") return value ? "oui" : "non";
  return String(value);
}

function fmtDuration(seconds: unknown): string {
  if (typeof seconds !== "number") return fmtValue(seconds);
  const days = Math.round(seconds / 86400);
  if (days >= 1) return `${days} j`;
  const minutes = Math.round(seconds / 60);
  return `${minutes} min`;
}

function StatusPill({ value }: { value: unknown }) {
  const text = fmtValue(value);
  const ok = text === "ok" || text === "SECRET_KEY";
  const warn = text === "degraded" || text === "timeout";
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
        ok
          ? "bg-pos-soft text-pos"
          : warn
            ? "bg-warn-soft text-warn"
            : "bg-neg-soft text-neg"
      }`}
    >
      {text}
    </span>
  );
}

function MetricCard({ label, value, hint }: { label: string; value: unknown; hint?: string }) {
  return (
    <div className="rounded-lg border border-line p-3 bg-inset">
      <p className="text-[11px] uppercase tracking-wide text-subtle">{label}</p>
      <p className="mt-1 text-lg font-semibold text-fg">{fmtValue(value)}</p>
      {hint && <p className="mt-0.5 text-xs text-subtle">{hint}</p>}
    </div>
  );
}

export default function AdminPanel({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
  const [sessions, setSessions] = useState<RememberSession[]>([]);
  const [events, setEvents] = useState<RememberEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    Promise.all([getAdminStatus(), getAdminRememberSessions(), getAdminRememberEvents()])
      .then(([statusData, sessionData, eventData]) => {
        setStatus(statusData);
        setSessions(sessionData.sessions);
        setEvents(eventData.events);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Erreur admin"));
  }

  useEffect(load, []);

  const health = asRecord(status?.health);
  const checks = asRecord(health.checks);
  const config = asRecord(health.config);
  const remember = asRecord(status?.remember);
  const cache = asRecord(status?.cache);
  const push = asRecord(status?.push);
  const pushUsers = Array.isArray(push.users) ? push.users.map(asRecord) : [];
  const serverSessions = asRecord(status?.sessions);

  return (
    <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 print:hidden">
      <div className="w-full max-w-5xl rounded-xl border border-line bg-surface shadow-pop p-4 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-fg">Administration</h2>
          <div className="flex items-center gap-2">
            <button onClick={load} className="text-sm text-accent hover:underline">Rafraîchir</button>
            <button onClick={onClose} className="text-sm text-muted hover:text-fg">Fermer</button>
          </div>
        </div>
        {error && <p className="text-sm text-neg">{error}</p>}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 max-h-[75vh] overflow-y-auto">
          <section className="lg:col-span-2 rounded-lg border border-line p-3">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div>
                <h3 className="text-xs font-semibold text-fg">Statut général</h3>
                <p className="text-xs text-subtle">
                  v{fmtValue(status?.version)} · build {fmtValue(status?.build)}
                </p>
              </div>
              <StatusPill value={status?.health ? health.status : status?.status} />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {["api", "database", "remember", "cas", "scodoc"].map((key) => (
                <div key={key} className="rounded-lg border border-line p-2">
                  <p className="text-[11px] text-subtle uppercase">{key}</p>
                  <StatusPill value={checks[key]} />
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-line p-3">
            <h3 className="text-xs font-semibold text-fg mb-2">Remember</h3>
            <div className="grid grid-cols-2 gap-2">
              <MetricCard label="Tokens actifs" value={remember.active_tokens} />
              <MetricCard label="Events" value={remember.events} />
              <MetricCard label="Max/user" value={remember.max_tokens_per_user} />
              <MetricCard label="Idle TTL" value={fmtDuration(remember.idle_ttl_seconds)} />
              <MetricCard label="TTL absolu" value={fmtDuration(remember.absolute_ttl_seconds)} />
              <MetricCard label="Rotation clé" value={fmtDuration(remember.key_rotation_seconds)} />
            </div>
          </section>

          <section className="rounded-lg border border-line p-3">
            <h3 className="text-xs font-semibold text-fg mb-2">Cache & config</h3>
            <div className="grid grid-cols-2 gap-2">
              <MetricCard label="Clé" value={config.encryption_key_source} />
              <MetricCard label="Sessions RAM" value={serverSessions.active_sessions} />
              <MetricCard label="Semestres" value={cache.semestres_entries} />
              <MetricCard label="Relevés" value={cache.releve_entries} />
              <MetricCard label="Users cache" value={cache.users_with_cache} />
              <MetricCard label="TTL courant" value={fmtDuration(cache.releve_current_ttl_seconds)} />
            </div>
          </section>

          <section className="lg:col-span-2 rounded-lg border border-line p-3">
            <h3 className="text-xs font-semibold text-fg mb-2">Push</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
              <MetricCard label="Abonnements" value={push.active_subscriptions} />
              <MetricCard label="Utilisateurs" value={push.subscribed_users} />
              <MetricCard label="Snapshots" value={push.snapshots} />
              <MetricCard label="Checks suivis" value={pushUsers.length} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {pushUsers.slice(0, 20).map((user) => (
                <div key={String(user.username)} className="text-xs text-muted border border-line rounded p-2">
                  <p className="font-medium">{fmtValue(user.username)}</p>
                  <p>Dernier succès : {fmtTime(user.last_success_at as number | undefined)}</p>
                  <p>Prochain essai : {fmtTime(user.next_retry_at as number | undefined)}</p>
                  <p>Nouvelles notes dernier check : {fmtValue(user.last_new_grades_count)}</p>
                  {Boolean(user.last_error) && <p className="text-neg">Erreur : {fmtValue(user.last_error)}</p>}
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-line p-3">
            <h3 className="text-xs font-semibold text-fg mb-2">Remember tokens actifs</h3>
            <div className="space-y-2">
              {sessions.slice(0, 20).map((session) => (
                <div key={session.session_id} className="text-xs text-muted border-b border-line pb-2">
                  <p className="font-medium">{session.username}</p>
                  <p>{session.user_agent || "Appareil inconnu"}</p>
                  <p>Dernière utilisation : {fmtTime(session.last_used_at)}</p>
                </div>
              ))}
            </div>
          </section>
          <section className="lg:col-span-2 rounded-lg border border-line p-3">
            <h3 className="text-xs font-semibold text-fg mb-2">Événements remember récents</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {events.slice(0, 60).map((event) => (
                <div key={event.id} className="text-xs text-muted border border-line rounded p-2">
                  <p className="font-medium">{event.event} · {event.username}</p>
                  <p>{fmtTime(event.created_at)} · token {event.token_hash_prefix}</p>
                  <p className="truncate">{event.user_agent || "Appareil inconnu"}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
