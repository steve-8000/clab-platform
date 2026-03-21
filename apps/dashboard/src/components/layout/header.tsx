"use client";

import { useEffect, useState } from "react";

export function Header() {
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    // Pulse the indicator every 5s to match polling interval
    const interval = setInterval(() => {
      setRefreshing(true);
      const timeout = setTimeout(() => setRefreshing(false), 800);
      return () => clearTimeout(timeout);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="h-12 border-b border-gray-800 bg-gray-950/80 backdrop-blur-sm flex items-center justify-between px-6">
      <div className="text-sm text-gray-500 font-medium">
        Execution Control Plane
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full transition-colors ${
              refreshing ? "bg-blue-400 animate-pulse" : "bg-green-500"
            }`}
          />
          <span className="text-xs text-gray-400">
            {refreshing ? "refreshing..." : "live"}
          </span>
        </div>
      </div>
    </header>
  );
}
