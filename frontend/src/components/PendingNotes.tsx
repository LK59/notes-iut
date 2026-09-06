import type { PendingItem } from "../simulator";
import { Card, NoteInput, Panel } from "./ui";
import { SECTION_LABEL } from "./SectionNav";

interface Props {
  items: PendingItem[];
  overrides: Record<string, number>;
  onChange: (key: string, value: number | undefined) => void;
}

export default function PendingNotes({ items, overrides, onChange }: Props) {
  if (items.length === 0) {
    return (
      <Card className="border-pos/40 bg-pos-soft/40 px-4 py-3">
        <p className="text-sm text-pos">
          Toutes les évaluations publiées sont notées — rien à simuler pour ce semestre.
        </p>
      </Card>
    );
  }

  const filled = items.filter((item) => item.key in overrides).length;

  return (
    <Panel
      title={SECTION_LABEL["notes-non-publiees"]}
      subtitle="Saisis une estimation : les moyennes se recalculent partout dans l'app."
      aside={
        <span className="mono text-xs text-muted">
          {filled > 0 ? `${filled}/${items.length}` : items.length}
        </span>
      }
      defaultOpen
    >
      <div className="divide-y divide-line">
        {items.map((item) => (
          <div key={item.key} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <div className="min-w-0">
              <p className="text-[13px] text-fg truncate">{item.evalLabel}</p>
              <p className="text-xs text-subtle truncate">
                {item.moduleLabel} · {item.ueLabel}
              </p>
            </div>
            <NoteInput
              value={overrides[item.key]}
              simulated={item.key in overrides}
              placeholder="note"
              ariaLabel={`Note estimée pour ${item.evalLabel}`}
              onChange={(value) => onChange(item.key, value)}
            />
          </div>
        ))}
      </div>
    </Panel>
  );
}
