import type { ModelInfo } from "../types";

export function Header({
  models,
  model,
  online,
  onModelChange,
}: {
  models: ModelInfo[];
  model: string;
  online: boolean | null;
  onModelChange: (m: string) => void;
}) {
  const statusColor =
    online ? "text-ok" : online === false ? "text-danger" : "text-muted";

  return (
    <header className="flex items-center justify-between border-b border-border bg-bg px-5 py-3">
      <div className="font-semibold">Enzo</div>
      <div className="flex items-center gap-3">
        <span
          className={`text-xs font-semibold ${statusColor}`}
          title={
            online
              ? "Local engine connected"
              : online === false
                ? "Ollama not running"
                : "Checking…"
          }
        >
          ● {online ? "Local" : online === false ? "Offline" : "…"}
        </span>
        <select
          className="cursor-pointer rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg"
          value={model}
          onChange={(e) => onModelChange(e.target.value)}
        >
          {models.length === 0 && <option value="">No models</option>}
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.id}
              {m.label ? ` · ${m.label}` : ""}
            </option>
          ))}
        </select>
      </div>
    </header>
  );
}
