import { MissionList } from "@/components/mission-list";
import { StatusCards } from "@/components/status-cards";
import { ActiveSessions } from "@/components/active-sessions";

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <StatusCards />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <MissionList />
        <ActiveSessions />
      </div>
    </div>
  );
}
