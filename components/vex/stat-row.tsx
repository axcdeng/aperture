export function StatRow({
  items,
}: {
  items: { label: string; value: string; hint?: string }[];
}) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
      {items.map((it) => (
        <div key={it.label} className="bg-surface px-4 py-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-2">{it.label}</div>
          <div className="mt-1 font-mono text-lg text-foreground">{it.value}</div>
          {it.hint ? <div className="text-xs text-muted">{it.hint}</div> : null}
        </div>
      ))}
    </div>
  );
}
