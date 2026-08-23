// Client-safe types shared between server functions and UI.

export type AuditStatus = "MATCHED" | "CONFLICT_FOUND" | "MANUAL_REVIEW_REQUIRED";

export interface ReconciledWriter {
  full_name: string;
  ipi_number: string;
  writer_share: number;
  pro_affiliation: string;
  role: string;
  matched_input: string | null;
  match_basis: "IPI" | "NAME" | "NONE";
}

export interface ReconciledPublisher {
  publisher_name: string;
  publisher_number: string;
  ipi_number: string;
  publisher_share: number;
  administrators: {
    publisher_name: string;
    publisher_number: string;
    ipi_number: string;
    publisher_share: number;
  }[];
}

export interface LinkedRecording {
  isrc: string;
  recording_title: string;
  artist: string;
  label: string;
  dsp: string;
  release_date: string | null;
}

export interface ReconciliationFlag {
  code: string;
  severity: "info" | "warning" | "critical";
  message: string;
}

export interface WorkProfile {
  mlc_work_id: string;
  mlc_song_code: string;
  official_title: string;
  alternative_titles: string[];
  iswc: string;
  registration_status: string;
  match_confidence_score: number;
  writers: ReconciledWriter[];
  publishers: ReconciledPublisher[];
  linked_isrcs: string[];
  recordings: LinkedRecording[];
  total_writer_share: number;
  total_publisher_share: number;
  total_known_shares: number;
  flags: ReconciliationFlag[];
  audit_status: AuditStatus;
}

export interface QueryPlanStep {
  strategy: "ISWC_PRIMARY" | "SONG_CODE" | "TITLE_WRITER_FALLBACK" | "TITLE_ONLY" | "ISRC";
  endpoint: string;
  payload: Record<string, string>;
  executed: boolean;
  result_count: number;
}

export interface ReconcileInput {
  trackTitle: string;
  iswc: string;
  mainArtist: string;
  composers: string;
  publishers: string;
}

export interface ReconcileResult {
  query_plan: QueryPlanStep[];
  candidates: {
    mlc_work_id: string;
    song_code: string;
    title: string;
    iswc: string;
    writers: string[];
    score: number;
  }[];
  profile: WorkProfile | null;
  input_echo: ReconcileInput;
  generated_at: string;
}

// ---- ISRC lookup (claim status) ----

export type ClaimStatus = "FULLY_CLAIMED" | "PARTIALLY_CLAIMED" | "NOT_FOUND";

export interface IsrcLookupResult {
  isrc: string;
  searched_at: string;
  found: boolean;
  claim_status: ClaimStatus;
  claimed_percentage: number;
  unclaimed_percentage: number;
  recording_title: string;
  recording_artist: string;
  profile: WorkProfile | null;
}
