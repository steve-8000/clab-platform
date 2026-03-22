export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-gray-800 ${className}`} />;
}

export function CardSkeleton() {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
      <Skeleton className="mb-2 h-4 w-24" />
      <Skeleton className="h-8 w-16" />
    </div>
  );
}
