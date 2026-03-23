export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] px-6 py-14 text-center">
      <p className="text-lg font-medium text-white">{title}</p>
      {description && <p className="mt-2 max-w-xl text-sm leading-6 text-neutral-400">{description}</p>}
    </div>
  );
}
