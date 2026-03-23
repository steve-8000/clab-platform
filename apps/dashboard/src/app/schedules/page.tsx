"use client";

import { useCallback, useEffect, useState } from "react";
import { cp } from "@/lib/api";

interface ScheduledJob {
  id: string;
  worker_id: string;
  name: string;
  cron_expression: string;
  command_type: string;
  payload: Record<string, unknown>;
  enabled: boolean;
  last_run_at: string | null;
  run_count: number;
  created_at: string;
}

export default function SchedulesPage() {
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [workers, setWorkers] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ worker_id: "", name: "", cron_expression: "", command_type: "prompt", payload: "{}" });

  const refresh = useCallback(async () => {
    try {
      const [j, w] = await Promise.all([cp.schedules(), cp.workers()]);
      setJobs(j);
      setWorkers(w);
    } catch {}
  }, []);

  useEffect(() => { refresh(); const t = setInterval(refresh, 5000); return () => clearInterval(t); }, [refresh]);

  const create = async () => {
    try {
      let payload = {};
      try { payload = JSON.parse(form.payload); } catch {}
      await cp.createSchedule({ ...form, payload });
      setShowForm(false);
      setForm({ worker_id: "", name: "", cron_expression: "", command_type: "prompt", payload: "{}" });
      refresh();
    } catch {}
  };

  const toggle = async (job: ScheduledJob) => {
    await cp.updateSchedule(job.id, { enabled: !job.enabled });
    refresh();
  };

  const remove = async (id: string) => {
    await cp.deleteSchedule(id);
    refresh();
  };

  const runNow = async (job: ScheduledJob) => {
    const prompt = (job.payload as any)?.prompt || job.name;
    await cp.dispatchPrompt({ worker_id: job.worker_id, prompt });
    refresh();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Schedules</h1>
          <p className="mt-1 text-sm text-neutral-500">Cron jobs and scheduled tasks for worker nodes.</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="rounded-lg bg-white/[0.08] px-4 py-2 text-sm text-white hover:bg-white/[0.14]">
          {showForm ? "Cancel" : "+ New Schedule"}
        </button>
      </div>

      {showForm && (
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-neutral-500 mb-1">Worker</label>
              <select value={form.worker_id} onChange={e => setForm({...form, worker_id: e.target.value})}
                className="w-full rounded-lg border border-white/[0.1] bg-black px-3 py-2 text-sm text-white">
                <option value="">Select worker...</option>
                {workers.map(w => <option key={w.worker_id} value={w.worker_id}>{w.worker_id}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-neutral-500 mb-1">Name</label>
              <input value={form.name} onChange={e => setForm({...form, name: e.target.value})}
                className="w-full rounded-lg border border-white/[0.1] bg-black px-3 py-2 text-sm text-white" placeholder="Daily health check" />
            </div>
            <div>
              <label className="block text-xs text-neutral-500 mb-1">Cron Expression</label>
              <input value={form.cron_expression} onChange={e => setForm({...form, cron_expression: e.target.value})}
                className="w-full rounded-lg border border-white/[0.1] bg-black px-3 py-2 text-sm text-white font-mono" placeholder="*/5 * * * *" />
            </div>
            <div>
              <label className="block text-xs text-neutral-500 mb-1">Command Type</label>
              <select value={form.command_type} onChange={e => setForm({...form, command_type: e.target.value})}
                className="w-full rounded-lg border border-white/[0.1] bg-black px-3 py-2 text-sm text-white">
                <option value="prompt">Prompt</option>
                <option value="mission">Mission</option>
                <option value="heartbeat">Heartbeat</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-neutral-500 mb-1">Payload (JSON)</label>
            <textarea value={form.payload} onChange={e => setForm({...form, payload: e.target.value})} rows={3}
              className="w-full rounded-lg border border-white/[0.1] bg-black px-3 py-2 text-sm text-white font-mono" placeholder='{"prompt": "run health check"}' />
          </div>
          <button onClick={create} disabled={!form.worker_id || !form.name || !form.cron_expression}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40">
            Create Schedule
          </button>
        </div>
      )}

      {jobs.length === 0 ? (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-8 text-center">
          <p className="text-neutral-500">No scheduled jobs yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map(job => (
            <div key={job.id} className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <span className={`h-2.5 w-2.5 rounded-full ${job.enabled ? "bg-emerald-400" : "bg-neutral-600"}`} />
                <div>
                  <p className="text-sm font-medium text-white">{job.name}</p>
                  <p className="text-xs text-neutral-500">
                    <span className="font-mono">{job.cron_expression}</span> · {job.worker_id} · {job.command_type} · {job.run_count} runs
                    {job.last_run_at && <> · last: {new Date(job.last_run_at).toLocaleString()}</>}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => runNow(job)} className="rounded-lg bg-white/[0.06] px-3 py-1.5 text-xs text-neutral-300 hover:bg-white/[0.12]">Run Now</button>
                <button onClick={() => toggle(job)} className={`rounded-lg px-3 py-1.5 text-xs ${job.enabled ? "bg-amber-600/20 text-amber-300" : "bg-emerald-600/20 text-emerald-300"}`}>
                  {job.enabled ? "Disable" : "Enable"}
                </button>
                <button onClick={() => remove(job.id)} className="rounded-lg bg-rose-600/20 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-600/30">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
