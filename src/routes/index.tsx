import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { reconcileWork, selectCandidate } from "@/lib/mlc.functions";
import type { ReconcileInput, ReconcileResult, WorkProfile } from "@/lib/mlc-types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MLC Reconciliation Engine — Work Metadata Audit" },
      {
        name: "description",
        content:
          "Reconcile song metadata against The MLC public work registry: ISWC matching, writer IPIs, publisher splits and linked ISRCs with a full audit trail.",
      },
      { property: "og:title", content: "MLC Reconciliation Engine — Work Metadata Audit" },
      {
        property: "og:description",
        content:
          "Audit writers, IPIs, publisher splits and linked ISRCs against The MLC public registry.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const EMPTY: ReconcileInput = {
  trackTitle: "",
  iswc: "",
  mainArtist: "",
  composers: "",
  publishers: "",
};

const STATUS_STYLES: Record<string, string> = {
  MATCHED: "bg-success/15 text-success border-success/40",
  CONFLICT_FOUND: "bg-destructive/15 text-destructive border-destructive/40",
  MANUAL_REVIEW_REQUIRED: "bg-warning/15 text-warning border-warning/40",
};

const SEVERITY_STYLES: Record<string, string> = {
  info: "border-accent/40 text-accent",
  warning: "border-warning/40 text-warning",
  critical: "border-destructive/40 text-destructive",
};

function Field({
  label,
  value,
  onChange,
  placeholder,
  textarea,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  textarea?: boolean;
}) {
  const cls =
    "w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-ring focus:ring-1 focus:ring-ring";
  return (
    <label className="block space-y-1.5">
      <span className="eyebrow">{label}</span>
      {textarea ? (
        <textarea
          rows={2}
          className={cls}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          className={cls}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-1.5 last:border-0">
      <span className="eyebrow">{k}</span>
      <span className="mono-key text-right text-foreground">{v || "—"}</span>
    </div>
  );
}

function Index() {
  const [form, setForm] = useState<ReconcileInput>(EMPTY);
  const [result, setResult] = useState<ReconcileResult | null>(null);
  const [profile, setProfile] = useState<WorkProfile | null>(null);
  const [showJson, setShowJson] = useState(false);

  const run = useServerFn(reconcileWork);
  const pick = useServerFn(selectCandidate);

  const reconcileM = useMutation({
    mutationFn: (data: ReconcileInput) => run({ data }),
    onSuccess: (r) => {
      setResult(r);
      setProfile(r.profile);
    },
  });

  const pickM = useMutation({
    mutationFn: (workId: number) => pick({ data: { ...form, workId } }),
    onSuccess: (p) => setProfile(p),
  });

  const set = (k: keyof ReconcileInput) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const busy = reconcileM.isPending || pickM.isPending;
  const error = reconcileM.error ?? pickM.error;

  return (
    <main className="mx-auto max-w-6xl px-5 py-10">
      <header className="mb-8">
        <p className="eyebrow">The MLC · Public Work Registry</p>
        <h1 className="mt-2 text-3xl font-bold text-foreground sm:text-4xl">
          Metadata Reconciliation Engine
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Enter a work's identifiers. The engine builds a query plan, harvests the MLC record
          (writers, IPIs, publisher chains, linked ISRCs) and audits it against your source data.
        </p>
      </header>

      <section className="panel p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Track title"
            value={form.trackTitle}
            onChange={set("trackTitle")}
            placeholder="Bohemian Rhapsody"
          />
          <Field label="ISWC" value={form.iswc} onChange={set("iswc")} placeholder="T-070.180.077-9" />
          <Field
            label="Main artist"
            value={form.mainArtist}
            onChange={set("mainArtist")}
            placeholder="Queen"
          />
          <Field
            label="Composers / writers"
            value={form.composers}
            onChange={set("composers")}
            placeholder="Freddie Mercury, Brian May"
            textarea
          />
          <Field
            label="Publishers"
            value={form.publishers}
            onChange={set("publishers")}
            placeholder="Sony Music Publishing"
            textarea
          />
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            disabled={busy || (!form.trackTitle.trim() && !form.iswc.trim())}
            onClick={() => reconcileM.mutate(form)}
            className="rounded-md bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy ? "Reconciling…" : "Run reconciliation"}
          </button>
          <button
            onClick={() => {
              setForm(EMPTY);
              setResult(null);
              setProfile(null);
            }}
            className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            Reset
          </button>
        </div>

        {error ? (
          <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {(error as Error).message}
          </p>
        ) : null}
      </section>

      {result ? (
        <div className="mt-8 grid gap-6 lg:grid-cols-[320px_1fr]">
          <aside className="space-y-6">
            <section className="panel p-4">
              <h2 className="eyebrow mb-3">Query plan</h2>
              <ol className="space-y-2">
                {result.query_plan.map((s, i) => (
                  <li key={i} className="rounded-md bg-surface-raised p-2.5">
                    <div className="mono-key text-primary">{s.strategy}</div>
                    <div className="mt-1 text-xs text-muted-foreground break-all">
                      {JSON.stringify(s.payload)}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {s.result_count < 0 ? "error" : `${s.result_count} result(s)`}
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <section className="panel p-4">
              <h2 className="eyebrow mb-3">Candidates</h2>
              {result.candidates.length === 0 ? (
                <p className="text-sm text-muted-foreground">No works found.</p>
              ) : (
                <ul className="space-y-2">
                  {result.candidates.map((c) => (
                    <li key={c.mlc_work_id}>
                      <button
                        onClick={() => pickM.mutate(Number(c.mlc_work_id))}
                        className={`w-full rounded-md border p-2.5 text-left transition-colors hover:border-primary/60 ${
                          profile?.mlc_work_id === c.mlc_work_id
                            ? "border-primary/70 bg-primary/10"
                            : "border-border bg-surface-raised"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-foreground">{c.title}</span>
                          <span className="mono-key text-primary">{c.score}</span>
                        </div>
                        <div className="mono-key mt-1 text-muted-foreground">
                          {c.song_code || c.mlc_work_id} · {c.iswc || "no ISWC"}
                        </div>
                        <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {c.writers.join(", ")}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </aside>

          <div className="space-y-6">
            {profile ? (
              <>
                <section className="panel p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-semibold text-foreground">
                        {profile.official_title}
                      </h2>
                      <p className="mono-key mt-1 text-muted-foreground">
                        Work {profile.mlc_work_id} · {profile.mlc_song_code} ·{" "}
                        {profile.iswc || "no ISWC"}
                      </p>
                    </div>
                    <span
                      className={`rounded-full border px-3 py-1 mono-key ${
                        STATUS_STYLES[profile.audit_status] ?? ""
                      }`}
                    >
                      {profile.audit_status}
                    </span>
                  </div>
                  <div className="mt-4 grid gap-x-8 sm:grid-cols-2">
                    <Row k="Confidence" v={`${profile.match_confidence_score}%`} />
                    <Row k="Registration" v={profile.registration_status} />
                    <Row k="Total known shares" v={`${profile.total_known_shares}%`} />
                    <Row k="Publisher shares" v={`${profile.total_publisher_share}%`} />
                    <Row k="Linked ISRCs" v={String(profile.linked_isrcs.length)} />
                    <Row k="Alt titles" v={String(profile.alternative_titles.length)} />
                  </div>
                </section>

                {profile.flags.length ? (
                  <section className="panel p-5">
                    <h3 className="eyebrow mb-3">Audit flags</h3>
                    <ul className="space-y-2">
                      {profile.flags.map((f, i) => (
                        <li
                          key={i}
                          className={`rounded-md border-l-2 bg-surface-raised px-3 py-2 ${
                            SEVERITY_STYLES[f.severity] ?? ""
                          }`}
                        >
                          <div className="mono-key">{f.code}</div>
                          <p className="mt-1 text-sm text-foreground/90">{f.message}</p>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                <section className="panel p-5">
                  <h3 className="eyebrow mb-3">Writers</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="eyebrow">
                          <th className="pb-2">Name</th>
                          <th className="pb-2">IPI</th>
                          <th className="pb-2">Role</th>
                          <th className="pb-2">Share</th>
                          <th className="pb-2">Match</th>
                        </tr>
                      </thead>
                      <tbody>
                        {profile.writers.map((w, i) => (
                          <tr key={i} className="border-t border-border/60">
                            <td className="py-2 text-foreground">{w.full_name}</td>
                            <td className="py-2 mono-key text-muted-foreground">
                              {w.ipi_number || "—"}
                            </td>
                            <td className="py-2 text-muted-foreground">{w.role}</td>
                            <td className="py-2 mono-key text-primary">{w.writer_share}%</td>
                            <td className="py-2 mono-key text-muted-foreground">{w.match_basis}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="panel p-5">
                  <h3 className="eyebrow mb-3">Publishers</h3>
                  <ul className="space-y-3">
                    {profile.publishers.map((p, i) => (
                      <li key={i} className="rounded-md bg-surface-raised p-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm font-medium text-foreground">
                            {p.publisher_name}
                          </span>
                          <span className="mono-key text-primary">{p.publisher_share}%</span>
                        </div>
                        <div className="mono-key mt-1 text-muted-foreground">
                          {p.publisher_number || "—"} · IPI {p.ipi_number || "—"}
                        </div>
                        {p.administrators.length ? (
                          <ul className="mt-2 space-y-1 border-l border-border pl-3">
                            {p.administrators.map((a, j) => (
                              <li
                                key={j}
                                className="flex items-center justify-between gap-3 text-xs text-muted-foreground"
                              >
                                <span>{a.publisher_name}</span>
                                <span className="mono-key">{a.publisher_share}%</span>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>

                {profile.recordings.length ? (
                  <section className="panel p-5">
                    <h3 className="eyebrow mb-3">Linked recordings</h3>
                    <div className="max-h-80 overflow-auto">
                      <table className="w-full text-left text-sm">
                        <thead>
                          <tr className="eyebrow">
                            <th className="pb-2">ISRC</th>
                            <th className="pb-2">Title</th>
                            <th className="pb-2">Artist</th>
                            <th className="pb-2">Label</th>
                          </tr>
                        </thead>
                        <tbody>
                          {profile.recordings.map((r, i) => (
                            <tr key={i} className="border-t border-border/60">
                              <td className="py-1.5 mono-key text-accent">{r.isrc}</td>
                              <td className="py-1.5 text-foreground">{r.recording_title}</td>
                              <td className="py-1.5 text-muted-foreground">{r.artist}</td>
                              <td className="py-1.5 text-muted-foreground">{r.label}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                ) : null}

                <section className="panel p-5">
                  <button
                    onClick={() => setShowJson((s) => !s)}
                    className="eyebrow text-primary"
                  >
                    {showJson ? "Hide" : "Show"} JSON output
                  </button>
                  {showJson ? (
                    <pre className="mt-3 max-h-96 overflow-auto rounded-md bg-background p-3 text-xs text-foreground/90">
                      {JSON.stringify({ ...result, profile }, null, 2)}
                    </pre>
                  ) : null}
                </section>
              </>
            ) : (
              <section className="panel p-6 text-sm text-muted-foreground">
                No work profile resolved. Pick a candidate on the left or refine your input.
              </section>
            )}
          </div>
        </div>
      ) : null}
    </main>
  );
}
