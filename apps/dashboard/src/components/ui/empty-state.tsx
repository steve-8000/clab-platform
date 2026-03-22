export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-700 py-12 text-center">
      <p className="text-lg font-medium text-gray-400">{title}</p>
      {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
    </div>
  );
}
