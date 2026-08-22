// Server-only: talks to The MLC Public Work Search backend used by portal.themlc.com.
import type {
  AuditStatus,
  LinkedRecording,
  QueryPlanStep,
  ReconcileInput,
  ReconcileResult,
  ReconciledPublisher,
  ReconciledWriter,
  ReconciliationFlag,
  WorkProfile,
} from "./mlc-types";

const API_BASE = "https://api.ptl.themlc.com/api2v/public";

const HEADERS = {
  accept: "application/json",
  "content-type": "application/json",
  "x-requested-with": "XMLHttpRequest",
  referer: "https://portal.themlc.com/",
  "user-agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
};

const ROLE_CODES: Record<number, string> = {
  7: "Adaptor",
  8: "Arranger",
  9: "Author",
  10: "Composer",
  11: "Composer/Author",
  12: "Sub Arranger",
  13: "Sub Author",
  14: "Translator",
};

interface RawWriter {
  ipId: number;
  fullName: string;
  ipiNumber: string | null;
  roleCode: number | null;
}

interface RawAdmin {
  publisherName: string;
  publisherNumber: string | null;
  hfaPublisherNumber: string | null;
  ipiNumber: string | null;
  publisherShare: number | null;
}

interface RawPublisher extends RawAdmin {
  administratorPublishers?: RawAdmin[] | null;
  writers?: RawWriter[] | null;
}

interface RawRecording {
  isrc: string | null;
  dsp: string | null;
  recordingTitle: string | null;
  recordingDisplayArtistName: string | null;
  label: string | null;
  releaseDate: string | null;
}

interface RawWork {
  id: number;
  title: string;
  songCode: string | null;
  iswc: string | null;
  isComplete: boolean | null;
  isPublicDomain: boolean | null;
  totalKnownShares: number | null;
  writers?: RawWriter[] | null;
  originalPublishers?: RawPublisher[] | null;
  alternativeTitles?: { title: string }[] | null;
  matchedRecordings?: { count: number; recordings: RawRecording[] } | null;
}

async function searchWorks(
  payload: Record<string, string>,
  size = 10,
): Promise<RawWork[]> {
  const res = await fetch(`${API_BASE}/search/works?page=0&size=${size}`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`MLC search failed [${res.status}]: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { content?: RawWork[] };
  return json.content ?? [];
}

async function fetchWorkDetail(id: number): Promise<RawWork | null> {
  const res = await fetch(`${API_BASE}/work/${id}`, { headers: HEADERS });
  if (!res.ok) return null;
  return (await res.json()) as RawWork;
}

async function fetchRecordings(id: number, size = 50): Promise<RawRecording[]> {
  const res = await fetch(
    `${API_BASE}/work/${id}/recording?page=0&size=${size}&order=releaseDate&direction=desc`,
    { headers: HEADERS },
  );
  if (!res.ok) return [];
  const json = (await res.json()) as { content?: RawRecording[] };
  return json.content ?? [];
}

// ---------- normalization helpers ----------

const normIswc = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "");
const formatIswc = (v: string | null | undefined) => {
  if (!v) return "";
  const n = normIswc(v);
  return /^T\d{10}$/.test(n) ? `${n[0]}-${n.slice(1, 10)}-${n[10]}` : v;
};
const normName = (v: string) =>
  v
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const normIpi = (v: string | null | undefined) =>
  (v ?? "").replace(/\D/g, "").replace(/^0+/, "");
const splitList = (v: string) =>
  v
    .split(/[,;\n/]|\s+&\s+|\sfeat\.?\s/i)
    .map((s) => s.trim())
    .filter(Boolean);

function nameSimilarity(a: string, b: string): number {
  const ta = new Set(normName(a).split(" ").filter((t) => t.length > 1));
  const tb = new Set(normName(b).split(" ").filter((t) => t.length > 1));
  if (!ta.size || !tb.size) return 0;
  let hits = 0;
  ta.forEach((t) => {
    if (tb.has(t)) hits += 1;
  });
  return hits / Math.max(ta.size, tb.size);
}

function scoreCandidate(work: RawWork, input: ReconcileInput): number {
  let score = 0;
  if (input.iswc && work.iswc && normIswc(work.iswc) === normIswc(input.iswc)) score += 55;
  score += Math.round(nameSimilarity(work.title, input.trackTitle) * 20);
  const composers = splitList(input.composers);
  const mlcWriters = work.writers ?? [];
  if (composers.length && mlcWriters.length) {
    const matched = composers.filter((c) =>
      mlcWriters.some((w) => nameSimilarity(c, w.fullName) >= 0.5),
    ).length;
    score += Math.round((matched / composers.length) * 20);
  }
  const artist = normName(input.mainArtist);
  if (
    artist &&
    (work.matchedRecordings?.recordings ?? []).some(
      (r) => nameSimilarity(r.recordingDisplayArtistName ?? "", artist) >= 0.5,
    )
  ) {
    score += 5;
  }
  return Math.min(100, score);
}

// ---------- reconciliation ----------

function buildProfile(work: RawWork, recordings: RawRecording[], input: ReconcileInput): WorkProfile {
  const flags: ReconciliationFlag[] = [];
  const inputComposers = splitList(input.composers);

  const writers: ReconciledWriter[] = (work.writers ?? []).map((w) => {
    let matched: string | null = null;
    let basis: ReconciledWriter["match_basis"] = "NONE";
    const wIpi = normIpi(w.ipiNumber);
    for (const c of inputComposers) {
      const cIpi = normIpi(c.match(/\d{9,11}/)?.[0] ?? "");
      if (wIpi && cIpi && wIpi === cIpi) {
        matched = c;
        basis = "IPI";
        break;
      }
      if (nameSimilarity(c, w.fullName) >= 0.5) {
        matched = c;
        basis = "NAME";
      }
    }
    // Writer-level share is derived from the publisher chain the writer sits under.
    const linked = (work.originalPublishers ?? []).filter((p) =>
      (p.writers ?? []).some((pw) => pw.ipId === w.ipId),
    );
    const share = linked.reduce((sum, p) => {
      const admins = p.administratorPublishers ?? [];
      const chain = admins.length
        ? admins.reduce((s, a) => s + (a.publisherShare ?? 0), 0)
        : (p.publisherShare ?? 0);
      return sum + chain;
    }, 0);
    return {
      full_name: w.fullName,
      ipi_number: w.ipiNumber ?? "",
      writer_share: linked.length ? Number((share / Math.max(1, linked.length)).toFixed(2)) : 0,
      pro_affiliation: "NOT_EXPOSED",
      role: ROLE_CODES[w.roleCode ?? -1] ?? "Unknown",
      matched_input: matched,
      match_basis: basis,
    };
  });

  const publishers: ReconciledPublisher[] = (work.originalPublishers ?? []).map((p) => ({
    publisher_name: p.publisherName,
    publisher_number: p.publisherNumber ?? p.hfaPublisherNumber ?? "",
    ipi_number: p.ipiNumber ?? "",
    publisher_share: p.publisherShare ?? 0,
    administrators: (p.administratorPublishers ?? []).map((a) => ({
      publisher_name: a.publisherName,
      publisher_number: a.publisherNumber ?? a.hfaPublisherNumber ?? "",
      ipi_number: a.ipiNumber ?? "",
      publisher_share: a.publisherShare ?? 0,
    })),
  }));

  const allRecordings: LinkedRecording[] = [
    ...(work.matchedRecordings?.recordings ?? []),
    ...recordings,
  ].map((r) => ({
    isrc: r.isrc ?? "",
    recording_title: r.recordingTitle ?? "",
    artist: r.recordingDisplayArtistName ?? "",
    label: r.label ?? "",
    dsp: r.dsp ?? "",
    release_date: r.releaseDate ?? null,
  }));

  const seen = new Set<string>();
  const dedupedRecordings = allRecordings.filter((r) => {
    const key = `${r.isrc}|${r.dsp}|${r.recording_title}`;
    if (!r.isrc || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const linkedIsrcs = [...new Set(dedupedRecordings.map((r) => r.isrc))];

  // --- audit ---
  const iswcInput = input.iswc ? normIswc(input.iswc) : "";
  const iswcMlc = work.iswc ? normIswc(work.iswc) : "";
  if (iswcInput && !iswcMlc) {
    flags.push({
      code: "ISWC_MISSING_AT_MLC",
      severity: "warning",
      message: "The MLC record carries no ISWC. Cannot confirm against the Credits.fm ISWC.",
    });
  } else if (iswcInput && iswcMlc && iswcInput !== iswcMlc) {
    flags.push({
      code: "ISWC_MISMATCH",
      severity: "critical",
      message: `ISWC discrepancy: Credits.fm ${formatIswc(iswcInput)} vs MLC ${formatIswc(iswcMlc)}.`,
    });
  }

  const unmatchedInputs = inputComposers.filter(
    (c) => !writers.some((w) => w.matched_input === c),
  );
  if (unmatchedInputs.length) {
    flags.push({
      code: "WRITER_NOT_IN_MLC",
      severity: "warning",
      message: `Writers present in source data but absent from The MLC: ${unmatchedInputs.join(", ")}.`,
    });
  }
  const extraWriters = writers.filter((w) => w.match_basis === "NONE");
  if (inputComposers.length && extraWriters.length) {
    flags.push({
      code: "WRITER_EXTRA_AT_MLC",
      severity: "info",
      message: `Registered at The MLC but not in source data: ${extraWriters.map((w) => w.full_name).join(", ")}.`,
    });
  }
  if (writers.some((w) => !w.ipi_number)) {
    flags.push({
      code: "MISSING_WRITER_IPI",
      severity: "warning",
      message: "One or more writers have no IPI/CAE on file, weakening identity matching.",
    });
  }

  const totalKnown = work.totalKnownShares ?? 0;
  const totalPublisher = publishers.reduce((s, p) => {
    const admin = p.administrators.reduce((a, x) => a + x.publisher_share, 0);
    return s + (p.publisher_share || admin);
  }, 0);
  const totalWriter = writers.reduce((s, w) => s + w.writer_share, 0);

  if (totalKnown < 100) {
    flags.push({
      code: "SPLITS_UNDER_100",
      severity: "critical",
      message: `Total known shares are ${totalKnown}% — ${(100 - totalKnown).toFixed(2)}% of this work is unclaimed at The MLC.`,
    });
  } else if (totalKnown > 100) {
    flags.push({
      code: "SPLITS_OVER_100",
      severity: "critical",
      message: `Total known shares are ${totalKnown}% — conflicting ownership claims (overclaim).`,
    });
  }
  if (work.isComplete === false) {
    flags.push({
      code: "REGISTRATION_INCOMPLETE",
      severity: "warning",
      message: "Registration is marked incomplete at The MLC.",
    });
  }

  // --- confidence ---
  let confidence = 0;
  if (iswcInput && iswcMlc && iswcInput === iswcMlc) confidence += 45;
  else if (!iswcInput && iswcMlc) confidence += 15;
  confidence += nameSimilarity(work.title, input.trackTitle) * 20;
  if (inputComposers.length) {
    const matchedCount = inputComposers.length - unmatchedInputs.length;
    const ipiMatches = writers.filter((w) => w.match_basis === "IPI").length;
    confidence += (matchedCount / inputComposers.length) * 25;
    confidence += ipiMatches > 0 ? 5 : 0;
  } else {
    confidence += 15;
  }
  const artistHit = dedupedRecordings.some(
    (r) => input.mainArtist && nameSimilarity(r.artist, input.mainArtist) >= 0.5,
  );
  if (artistHit) confidence += 5;
  confidence = Math.max(0, Math.min(100, Number(confidence.toFixed(1))));

  let audit: AuditStatus = "MATCHED";
  if (flags.some((f) => f.severity === "critical")) audit = "CONFLICT_FOUND";
  else if (confidence < 70 || flags.some((f) => f.severity === "warning"))
    audit = "MANUAL_REVIEW_REQUIRED";

  const registrationStatus = work.isPublicDomain
    ? "PUBLIC_DOMAIN"
    : work.isComplete
      ? totalKnown === 100
        ? "ACTIVE_FULLY_CLAIMED"
        : "ACTIVE_PARTIALLY_CLAIMED"
      : "INCOMPLETE";

  return {
    mlc_work_id: String(work.id),
    mlc_song_code: work.songCode ?? "",
    official_title: work.title,
    alternative_titles: [...new Set((work.alternativeTitles ?? []).map((t) => t.title))],
    iswc: formatIswc(work.iswc),
    registration_status: registrationStatus,
    match_confidence_score: confidence,
    writers,
    publishers,
    linked_isrcs: linkedIsrcs,
    recordings: dedupedRecordings.slice(0, 60),
    total_writer_share: Number(totalWriter.toFixed(2)),
    total_publisher_share: Number(totalPublisher.toFixed(2)),
    total_known_shares: totalKnown,
    flags,
    audit_status: audit,
  };
}

export async function reconcile(input: ReconcileInput): Promise<ReconcileResult> {
  const plan: QueryPlanStep[] = [];
  let works: RawWork[] = [];

  const run = async (
    strategy: QueryPlanStep["strategy"],
    payload: Record<string, string>,
    size = 10,
  ) => {
    const step: QueryPlanStep = {
      strategy,
      endpoint: "POST /api2v/public/search/works?page=0&size=" + size,
      payload,
      executed: true,
      result_count: 0,
    };
    try {
      const res = await searchWorks(payload, size);
      step.result_count = res.length;
      plan.push(step);
      return res;
    } catch (e) {
      step.result_count = -1;
      plan.push(step);
      throw e;
    }
  };

  // Step 1 — ISWC is the primary unique key.
  if (input.iswc.trim()) {
    works = await run("ISWC_PRIMARY", { iswc: normIswc(input.iswc) });
  }

  // Step 2 — fallback: title + writer last name.
  if (!works.length && input.trackTitle.trim()) {
    const lastName = splitList(input.composers)[0]?.split(/\s+/).pop() ?? "";
    if (lastName) {
      works = await run("TITLE_WRITER_FALLBACK", {
        combinedTitles: input.trackTitle.trim(),
        writerFullNames: lastName,
      });
    }
  }

  // Step 3 — last resort: title only.
  if (!works.length && input.trackTitle.trim()) {
    works = await run("TITLE_ONLY", { combinedTitles: input.trackTitle.trim() }, 20);
  }

  const scored = works
    .map((w) => ({ work: w, score: scoreCandidate(w, input) }))
    .sort((a, b) => b.score - a.score);

  const candidates = scored.slice(0, 10).map(({ work, score }) => ({
    mlc_work_id: String(work.id),
    song_code: work.songCode ?? "",
    title: work.title,
    iswc: formatIswc(work.iswc),
    writers: (work.writers ?? []).map((w) => w.fullName),
    score,
  }));

  let profile: WorkProfile | null = null;
  const best = scored[0]?.work;
  if (best) {
    const detail = (await fetchWorkDetail(best.id)) ?? best;
    const recordings = await fetchRecordings(best.id);
    profile = buildProfile(detail, recordings, input);
    if (scored.length > 1 && scored[1].score >= scored[0].score - 5) {
      profile.flags.unshift({
        code: "AMBIGUOUS_MATCH",
        severity: "warning",
        message: `${scored.length} MLC works scored within 5 points of each other — verify the selected variant.`,
      });
      if (profile.audit_status === "MATCHED") profile.audit_status = "MANUAL_REVIEW_REQUIRED";
    }
  }

  return {
    query_plan: plan,
    candidates,
    profile,
    input_echo: input,
    generated_at: new Date().toISOString(),
  };
}

export async function loadProfileById(
  workId: number,
  input: ReconcileInput,
): Promise<WorkProfile | null> {
  const detail = await fetchWorkDetail(workId);
  if (!detail) return null;
  const recordings = await fetchRecordings(workId);
  return buildProfile(detail, recordings, input);
}
