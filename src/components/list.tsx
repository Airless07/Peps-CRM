"use client";

export function List({ children }: { children: React.ReactNode }) {
  return <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">{children}</div>;
}

export function ListRow({ title, sub, right, onClick }: { title: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-surface2/60 active:bg-surface2">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{title}</div>
        {sub && <div className="mt-0.5 truncate text-sm text-muted">{sub}</div>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </button>
  );
}

