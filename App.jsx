import React, { useState, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LabelList,
} from "recharts";
import {
  CheckCircle2, XCircle, HelpCircle, Inbox, ShieldCheck, ChevronRight, ChevronDown,
  Send, RotateCcw, TrendingUp, Clock, Search, FileText,
} from "lucide-react";

/* ============================================================================
   ENGINE  (portable — no React; lift this block into a Node/Python service)
============================================================================ */

const TAU = 0.85;
const TODAY = new Date("2026-06-11");

const getPath = (obj, path) =>
  path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);

const C = {
  f2f: {
    id: "f2f", kind: "doc_present", hard: true,
    description: "Face-to-face evaluation documenting OSA symptoms before the sleep test",
    source: { policy_id: "L33718", effective: "2026-01-01", cite: "Initial.A" },
    requires: ["evidence.face_to_face"], confFields: ["face_to_face"], docPath: "evidence.face_to_face.doc_id",
    evaluate: (c) => getPath(c, "evidence.face_to_face.symptoms_documented") === true,
    gap: {
      missing: "Request the face-to-face evaluation note from the ordering physician",
      unmet: "Note present but does not document qualifying symptoms — request a corrected note",
      uncertain: "Re-verify the face-to-face note (low extraction confidence)",
    },
    fix: { evidence: { face_to_face: { date: "2026-05-02", symptoms_documented: true, doc_id: "D-F2F" } }, meta: { face_to_face: 0.97 } },
  },
  ahi: {
    id: "ahi_qualifying", kind: "clinical_threshold", hard: true,
    description: "Sleep test AHI/RDI ≥ 15, or 5–14.9 with documented symptoms or comorbidity",
    source: { policy_id: "L33718", effective: "2026-01-01", cite: "Initial.B" },
    requires: ["evidence.sleep_study.ahi"], confFields: ["sleep_study.ahi"], docPath: "evidence.sleep_study.doc_id",
    evaluate: (c) => {
      const ahi = getPath(c, "evidence.sleep_study.ahi");
      const sym = (getPath(c, "evidence.symptoms") || []).length > 0;
      const com = (getPath(c, "evidence.comorbidities") || []).length > 0;
      return ahi >= 15 || (ahi >= 5 && (sym || com));
    },
    gap: {
      missing: "Obtain the qualifying sleep study report",
      unmet: "Documented AHI does not meet the threshold — add qualifying symptoms/comorbidity or re-test",
      uncertain: "Re-verify the sleep study result (low extraction confidence)",
    },
    fix: { evidence: { sleep_study: { type: "psg", ahi: 18, recording_hours: 6.5, date: "2026-04-20", doc_id: "D-PSG" } }, meta: { "sleep_study.ahi": 0.97 } },
  },
  ahiUHC: {
    id: "ahi_qualifying", kind: "clinical_threshold", hard: true,
    description: "Sleep test AHI/RDI ≥ 15, or 5–14.9 with a qualifying comorbidity",
    source: { policy_id: "UHC-CHOICE-OSA", effective: "2026-01-01", cite: "MED.OSA.2" },
    requires: ["evidence.sleep_study.ahi"], confFields: ["sleep_study.ahi"], docPath: "evidence.sleep_study.doc_id",
    evaluate: (c) => {
      const ahi = getPath(c, "evidence.sleep_study.ahi");
      const com = (getPath(c, "evidence.comorbidities") || []).length > 0;
      return ahi >= 15 || (ahi >= 5 && com);
    },
    gap: {
      missing: "Obtain the qualifying sleep study report",
      unmet: "AHI 5–14.9 requires a documented comorbidity under this plan — add it or re-test",
      uncertain: "Re-verify the sleep study result (low extraction confidence)",
    },
    fix: { evidence: { comorbidities: ["Hypertension"] }, meta: { "sleep_study.ahi": 0.97 } },
  },
  rx: {
    id: "valid_rx", kind: "doc_present", hard: true,
    description: "Order from the treating physician",
    source: { policy_id: "L33718", effective: "2026-01-01", cite: "Initial.C" },
    requires: ["order.prescriber_npi"], confFields: [], docPath: null,
    evaluate: (c) => !!getPath(c, "order.prescriber_npi"),
    gap: { missing: "Obtain a valid order with the prescriber NPI", unmet: "", uncertain: "" },
    fix: null,
  },
  adherence: {
    id: "adherence", kind: "adherence_threshold", hard: true,
    description: "Used ≥4 hrs/night on ≥70% of nights over a 30-day window in the first 90 days",
    source: { policy_id: "L33718", effective: "2026-01-01", cite: "Continued.1" },
    requires: ["evidence.adherence"], confFields: ["adherence"], docPath: "evidence.adherence.doc_id",
    evaluate: (c) => {
      const a = getPath(c, "evidence.adherence");
      if (!a) return false;
      return a.total_nights >= 30 && a.nights_used_ge4h / a.total_nights >= 0.70;
    },
    gap: {
      missing: "Pull the 30-day adherence report from the device modem",
      unmet: "Adherence below 70% — extend monitoring and coach the patient before resubmission",
      uncertain: "Re-verify adherence data (low confidence / manual source)",
    },
    fix: { evidence: { adherence: { window_start: "2026-04-01", window_end: "2026-04-30", nights_used_ge4h: 24, total_nights: 30, source: "modem", doc_id: "D-ADH" } }, meta: { adherence: 0.98 } },
  },
  reeval: {
    id: "benefit_reeval", kind: "doc_present", hard: true,
    description: "Clinical re-evaluation (day 31–91) documenting symptom benefit",
    source: { policy_id: "L33718", effective: "2026-01-01", cite: "Continued.2" },
    requires: ["evidence.benefit_reeval"], confFields: ["benefit_reeval"], docPath: "evidence.benefit_reeval.doc_id",
    evaluate: (c) => getPath(c, "evidence.benefit_reeval.improved") === true,
    gap: {
      missing: "Schedule and obtain the day 31–91 re-evaluation note",
      unmet: "Re-eval note does not document benefit — request a corrected note",
      uncertain: "Re-verify the re-evaluation note",
    },
    fix: { evidence: { benefit_reeval: { date: "2026-06-01", improved: true, doc_id: "D-RE" } }, meta: { benefit_reeval: 0.96 } },
  },
};

function getPolicy(payerId, phase) {
  const base = {
    payer_id: payerId, plan_id: payerId, device: "E0601",
    coverage_phase: phase, pa_required: true,
    benefit_routing: payerId === "medicare" ? "medicare_dme" : "commercial_dme",
    submission_channel: payerId === "medicare" ? "payer_portal" : "epa",
    version: "2026.1",
  };
  if (phase === "continued") return { ...base, criteria: [C.adherence, C.reeval] };
  const ahi = payerId === "uhc" ? C.ahiUHC : C.ahi;
  return { ...base, criteria: [C.f2f, ahi, C.rx] };
}

function evaluateCriterion(c, crit) {
  const present = crit.requires.every((p) => getPath(c, p) !== undefined);
  const conf = crit.confFields.length
    ? Math.min(...crit.confFields.map((k) => (c.field_meta?.[k]?.confidence ?? 1)))
    : 1;
  let status;
  if (!present) status = "missing";
  else if (conf < TAU) status = "uncertain";
  else status = crit.evaluate(c) ? "satisfied" : "unmet";
  return {
    criterion_id: crit.id, description: crit.description, cite: crit.source.cite,
    status, confidence: present ? conf : null, hasConf: crit.confFields.length > 0,
    gap_action: status === "satisfied" ? null : crit.gap[status],
    fixable: !!crit.fix, doc_id: crit.docPath ? getPath(c, crit.docPath) : null,
  };
}

function evaluateCase(c) {
  const policy = getPolicy(c.coverage.payer_id, c.coverage_phase);
  const results = policy.criteria.map((crit) => evaluateCriterion(c, crit));
  const isHard = (id) => policy.criteria.find((x) => x.id === id)?.hard;
  const any = (sts) => results.some((r) => sts.includes(r.status) && isHard(r.criterion_id));
  let verdict;
  if (any(["missing", "unmet"])) verdict = "needs_info";
  else if (any(["uncertain"])) verdict = "abstain";
  else verdict = "submit_ready";
  return { policy, results, verdict };
}

// --- Learned layer: payer adjudication profile from the linked outcomes ------
const CRIT_REASON = {
  f2f: "no_face_to_face", ahi_qualifying: "sleep_study_insufficient",
  adherence: "adherence_not_met", benefit_reeval: "adherence_not_met", valid_rx: "admin_error",
};

function payerProfiles(outcomes) {
  const prof = {};
  Object.keys(PAYERS).forEach((pid) => {
    const set = outcomes.filter((o) => o.linked && o.case_id && o.payer_id === pid);
    const n = set.length;
    const approved = set.filter((o) => o.decision === "approved").length;
    const reasonRate = {};
    set.filter((o) => o.decision === "denied").forEach((o) => {
      reasonRate[o.reason_code] = (reasonRate[o.reason_code] || 0) + 1;
    });
    Object.keys(reasonRate).forEach((r) => (reasonRate[r] = reasonRate[r] / n));
    prof[pid] = { base: n ? approved / n : 0.85, reasonRate, n };
  });
  return prof;
}

function predictApproval(c, ev, profiles) {
  const pr = profiles[c.coverage.payer_id] || { base: 0.85, reasonRate: {}, n: 0 };
  const factors = [];
  let p;
  const blocking = ev.results.filter((r) => r.status === "missing" || r.status === "unmet");
  const uncertain = ev.results.filter((r) => r.status === "uncertain");
  if (blocking.length) {
    p = 0.07;
    factors.push({ label: `${blocking.length} required criterion not met as submitted`, effect: "blocks" });
  } else if (uncertain.length) {
    p = 0.45;
    factors.push({ label: "Key field below the confidence threshold — outcome unverified", effect: "hold" });
  } else {
    p = pr.base;
    factors.push({ label: `${PAYERS[c.coverage.payer_id].short} base first-pass approval`, effect: `${Math.round(pr.base * 100)}%` });
    ev.results.forEach((r) => {
      const reason = CRIT_REASON[r.criterion_id];
      const rr = pr.reasonRate[reason] || 0;
      if (rr > 0) {
        p -= rr;
        factors.push({ label: `Payer denies “${REASON_LABEL[reason]}” even when documented`, effect: `−${Math.round(rr * 100)}%` });
      }
    });
  }
  p = Math.max(0.03, Math.min(0.99, p));
  return { p, band: p >= 0.8 ? "high" : p >= 0.5 ? "medium" : "low", factors, n: pr.n };
}

// --- Outcome loop: scored linkage --------------------------------------------
function scoreLink(outcome, cases) {
  return cases
    .map((c) => {
      let s = 0;
      if (c.coverage.member_id === outcome.member_id) s += 0.6;
      else if (fuzzyMember(c.coverage.member_id, outcome.member_id)) s += 0.3;
      if (c.order.device.hcpcs === outcome.device) s += 0.2;
      if (outcome.auth_ref && c.auth_ref === outcome.auth_ref) s += 0.2;
      return { case_id: c.case_id, score: Math.min(s, 0.99), member: c.coverage.member_id };
    })
    .sort((a, b) => b.score - a.score);
}
const fuzzyMember = (a, b) => {
  if (!a || !b || Math.abs(a.length - b.length) > 1) return false;
  let diff = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) diff++;
  return diff <= 2;
};

const daysOld = (d) => Math.round((TODAY - new Date(d)) / 86400000);

/* ============================================================================
   SAMPLE DATA  (synthetic — no PHI)
============================================================================ */

const PAYERS = {
  medicare: { label: "Medicare DME", short: "Medicare" },
  anthem: { label: "Anthem · commercial", short: "Anthem" },
  uhc: { label: "UnitedHealthcare · commercial", short: "UHC" },
};

const mkCase = (o) => ({ specialty: "dme_pap", status: "queue", ...o });

const initialCases = [
  mkCase({ case_id: "PA-2041", coverage_phase: "initial", received_at: "2026-06-08",
    patient: { ref: "PT-9001", dob: "1958-03-02", sex: "M" },
    coverage: { payer_id: "medicare", plan_id: "medicare", benefit: "medicare_dme", member_id: "MBR-7741" },
    order: { device: { hcpcs: "E0601", description: "CPAP" }, dx: ["G47.33"], prescriber_npi: "1992001122" }, auth_ref: "A-7741",
    evidence: { face_to_face: { date: "2026-05-02", symptoms_documented: true, doc_id: "FAX-101" },
      sleep_study: { type: "psg", ahi: 22, recording_hours: 6.4, date: "2026-04-18", doc_id: "FAX-102" }, symptoms: ["Excessive daytime sleepiness"] },
    field_meta: { face_to_face: { confidence: 0.96 }, "sleep_study.ahi": { confidence: 0.95 } } }),
  mkCase({ case_id: "PA-2042", coverage_phase: "initial", received_at: "2026-06-08",
    patient: { ref: "PT-9002", dob: "1965-11-20", sex: "F" },
    coverage: { payer_id: "medicare", plan_id: "medicare", benefit: "medicare_dme", member_id: "MBR-8810" },
    order: { device: { hcpcs: "E0601", description: "CPAP" }, dx: ["G47.33"], prescriber_npi: "1992004455" }, auth_ref: "A-8810",
    evidence: { face_to_face: { date: "2026-05-10", symptoms_documented: true, doc_id: "FAX-110" },
      sleep_study: { type: "hsat", ahi: 12, recording_hours: 5.1, date: "2026-04-30", doc_id: "FAX-111" }, symptoms: ["Excessive daytime sleepiness", "Fatigue"] },
    field_meta: { face_to_face: { confidence: 0.91 }, "sleep_study.ahi": { confidence: 0.62 } } }),
  mkCase({ case_id: "PA-2043", coverage_phase: "initial", received_at: "2026-06-09",
    patient: { ref: "PT-9003", dob: "1971-07-14", sex: "M" },
    coverage: { payer_id: "uhc", plan_id: "uhc", benefit: "commercial_dme", member_id: "MBR-3320" },
    order: { device: { hcpcs: "E0601", description: "CPAP" }, dx: ["G47.33"], prescriber_npi: "1992007788" }, auth_ref: "A-3320",
    evidence: { face_to_face: { date: "2026-05-15", symptoms_documented: true, doc_id: "FAX-120" },
      sleep_study: { type: "psg", ahi: 11, recording_hours: 6.0, date: "2026-05-01", doc_id: "FAX-121" }, symptoms: ["Excessive daytime sleepiness"], comorbidities: [] },
    field_meta: { face_to_face: { confidence: 0.94 }, "sleep_study.ahi": { confidence: 0.93 } } }),
  mkCase({ case_id: "PA-2044", coverage_phase: "initial", received_at: "2026-06-09",
    patient: { ref: "PT-9004", dob: "1960-01-09", sex: "F" },
    coverage: { payer_id: "medicare", plan_id: "medicare", benefit: "medicare_dme", member_id: "MBR-5567" },
    order: { device: { hcpcs: "E0601", description: "CPAP" }, dx: ["G47.33"], prescriber_npi: "1992009900" }, auth_ref: "A-5567",
    evidence: { sleep_study: { type: "psg", ahi: 30, recording_hours: 6.8, date: "2026-04-22", doc_id: "FAX-130" }, symptoms: ["Excessive daytime sleepiness"] },
    field_meta: { "sleep_study.ahi": { confidence: 0.96 } } }),
  mkCase({ case_id: "PA-2051", coverage_phase: "continued", received_at: "2026-06-07",
    patient: { ref: "PT-9011", dob: "1955-05-30", sex: "M" },
    coverage: { payer_id: "medicare", plan_id: "medicare", benefit: "medicare_dme", member_id: "MBR-1290" },
    order: { device: { hcpcs: "E0601", description: "CPAP" }, dx: ["G47.33"], prescriber_npi: "1992001122" }, auth_ref: "A-1290",
    evidence: { adherence: { window_start: "2026-04-01", window_end: "2026-04-30", nights_used_ge4h: 26, total_nights: 30, source: "modem", doc_id: "FAX-140" },
      benefit_reeval: { date: "2026-06-01", improved: true, doc_id: "FAX-141" } },
    field_meta: { adherence: { confidence: 0.97 }, benefit_reeval: { confidence: 0.95 } } }),
  mkCase({ case_id: "PA-2052", coverage_phase: "continued", received_at: "2026-06-07",
    patient: { ref: "PT-9012", dob: "1968-09-12", sex: "F" },
    coverage: { payer_id: "anthem", plan_id: "anthem", benefit: "commercial_dme", member_id: "MBR-4402" },
    order: { device: { hcpcs: "E0601", description: "CPAP" }, dx: ["G47.33"], prescriber_npi: "1992004455" }, auth_ref: "A-4402",
    evidence: { adherence: { window_start: "2026-04-01", window_end: "2026-04-30", nights_used_ge4h: 18, total_nights: 30, source: "modem", doc_id: "FAX-150" },
      benefit_reeval: { date: "2026-06-02", improved: true, doc_id: "FAX-151" } },
    field_meta: { adherence: { confidence: 0.96 }, benefit_reeval: { confidence: 0.94 } } }),
  mkCase({ case_id: "PA-2053", coverage_phase: "continued", received_at: "2026-06-06",
    patient: { ref: "PT-9013", dob: "1962-12-01", sex: "M" },
    coverage: { payer_id: "medicare", plan_id: "medicare", benefit: "medicare_dme", member_id: "MBR-6651" },
    order: { device: { hcpcs: "E0601", description: "CPAP" }, dx: ["G47.33"], prescriber_npi: "1992001122" }, auth_ref: "A-6651",
    evidence: { adherence: { window_start: "2026-04-01", window_end: "2026-04-30", nights_used_ge4h: 24, total_nights: 30, source: "manual", doc_id: "FAX-160" },
      benefit_reeval: { date: "2026-06-01", improved: true, doc_id: "FAX-161" } },
    field_meta: { adherence: { confidence: 0.58 }, benefit_reeval: { confidence: 0.95 } } }),
  mkCase({ case_id: "PA-2045", coverage_phase: "initial", received_at: "2026-06-10",
    patient: { ref: "PT-9005", dob: "1974-02-19", sex: "F" },
    coverage: { payer_id: "anthem", plan_id: "anthem", benefit: "commercial_dme", member_id: "MBR-2055" },
    order: { device: { hcpcs: "E0601", description: "CPAP" }, dx: ["G47.33"], prescriber_npi: "1992004455" }, auth_ref: "A-2055",
    evidence: { face_to_face: { date: "2026-05-20", symptoms_documented: true, doc_id: "FAX-170" },
      sleep_study: { type: "psg", ahi: 19, recording_hours: 6.2, date: "2026-05-04", doc_id: "FAX-171" }, symptoms: ["Excessive daytime sleepiness"] },
    field_meta: { face_to_face: { confidence: 0.95 }, "sleep_study.ahi": { confidence: 0.94 } } }),
];

const seedOutcomes = [
  { id: "O1", case_id: "H-1001", payer_id: "medicare", decision: "approved", reason_code: null, decided_at: "2026-05-30", linked: true, link_confidence: 0.97 },
  { id: "O2", case_id: "H-1002", payer_id: "medicare", decision: "approved", reason_code: null, decided_at: "2026-05-31", linked: true, link_confidence: 0.95 },
  { id: "O3", case_id: "H-1003", payer_id: "medicare", decision: "denied", reason_code: "no_face_to_face", decided_at: "2026-05-28", linked: true, link_confidence: 0.96 },
  { id: "O4", case_id: "H-1004", payer_id: "anthem", decision: "approved", reason_code: null, decided_at: "2026-06-01", linked: true, link_confidence: 0.93 },
  { id: "O5", case_id: "H-1005", payer_id: "anthem", decision: "denied", reason_code: "adherence_not_met", decided_at: "2026-06-02", linked: true, link_confidence: 0.9 },
  { id: "O6", case_id: "H-1006", payer_id: "uhc", decision: "approved", reason_code: null, decided_at: "2026-06-01", linked: true, link_confidence: 0.91 },
  { id: "O7", case_id: "H-1007", payer_id: "uhc", decision: "denied", reason_code: "sleep_study_insufficient", decided_at: "2026-05-29", linked: true, link_confidence: 0.94 },
  { id: "O8", case_id: "H-1008", payer_id: "medicare", decision: "approved", reason_code: null, decided_at: "2026-06-03", linked: true, link_confidence: 0.98 },
  { id: "O9", case_id: "H-1009", payer_id: "anthem", decision: "approved", reason_code: null, decided_at: "2026-06-04", linked: true, link_confidence: 0.92 },
  { id: "O10", case_id: null, payer_id: "medicare", decision: "denied", reason_code: "adherence_not_met",
    decided_at: "2026-06-09", linked: false, link_confidence: null, member_id: "MBR-6650", device: "E0601", auth_ref: null },
];

const seedActivity = () => {
  const a = {};
  initialCases.forEach((c) => {
    a[c.case_id] = [
      { t: c.received_at, label: "Evaluated against payer policy", kind: "eval" },
      { t: c.received_at, label: `Extracted by Coral · ${c.source ? "" : ""}${Object.keys(c.evidence).length} fields`, kind: "extract" },
    ];
  });
  return a;
};

/* ============================================================================
   UI
============================================================================ */

const STATUS = {
  satisfied: { label: "Satisfied", ring: "text-emerald-700 bg-emerald-50 border-emerald-200", dot: "bg-emerald-500", Icon: CheckCircle2, tone: "text-emerald-500" },
  missing: { label: "Missing", ring: "text-rose-700 bg-rose-50 border-rose-200", dot: "bg-rose-500", Icon: XCircle, tone: "text-rose-500" },
  unmet: { label: "Not met", ring: "text-rose-700 bg-rose-50 border-rose-200", dot: "bg-rose-500", Icon: XCircle, tone: "text-rose-500" },
  uncertain: { label: "Unverified", ring: "text-amber-700 bg-amber-50 border-amber-200", dot: "bg-amber-500", Icon: HelpCircle, tone: "text-amber-500" },
};
const VERDICT = {
  submit_ready: { label: "Ready to submit", cls: "text-emerald-700 bg-emerald-50 border-emerald-200", dot: "bg-emerald-500" },
  needs_info: { label: "Needs info", cls: "text-rose-700 bg-rose-50 border-rose-200", dot: "bg-rose-500" },
  abstain: { label: "Holding", cls: "text-amber-700 bg-amber-50 border-amber-200", dot: "bg-amber-500" },
};
const DECISION = { approved: "text-emerald-700 bg-emerald-50 border-emerald-200", denied: "text-rose-700 bg-rose-50 border-rose-200", pended: "text-amber-700 bg-amber-50 border-amber-200" };
const BAND = { high: "text-emerald-600", medium: "text-amber-600", low: "text-rose-600" };
const BAND_BG = { high: "bg-emerald-500", medium: "bg-amber-500", low: "bg-rose-500" };
const REASON_LABEL = {
  adherence_not_met: "Adherence not met", sleep_study_insufficient: "Sleep study insufficient",
  no_face_to_face: "No face-to-face", not_covered: "Not covered", step_therapy_required: "Step therapy", admin_error: "Admin error", other: "Other",
};

function ConfidenceMeter({ value }) {
  if (value == null) return <span className="font-mono text-xs text-slate-400">—</span>;
  const pct = Math.round(value * 100), ok = value >= TAU;
  return (
    <div className="flex items-center gap-2 w-36">
      <div className="relative h-1.5 flex-1 rounded-full bg-slate-200">
        <div className={`absolute inset-y-0 left-0 rounded-full ${ok ? "bg-emerald-500" : "bg-amber-500"}`} style={{ width: `${pct}%` }} />
        <div className="absolute inset-y-[-2px] w-px bg-slate-400/70" style={{ left: `${TAU * 100}%` }} />
      </div>
      <span className={`font-mono text-xs ${ok ? "text-slate-600" : "text-amber-600"}`}>{pct}%</span>
    </div>
  );
}

function VerdictPill({ verdict, small }) {
  const v = VERDICT[verdict];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-medium ${v.cls} ${small ? "text-[11px]" : "text-xs"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${v.dot}`} />{v.label}
    </span>
  );
}

function QueueRow({ c, evalr, pred, active, onClick }) {
  const p = PAYERS[c.coverage.payer_id];
  const age = daysOld(c.received_at);
  return (
    <button onClick={onClick}
      className={`w-full text-left px-4 py-3 border-l-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500
        ${active ? "border-teal-600 bg-teal-50/60" : "border-transparent hover:bg-slate-50"}`}>
      <div className="flex items-center justify-between">
        <span className="font-mono text-sm font-medium text-slate-800">{c.case_id}</span>
        <VerdictPill verdict={evalr.verdict} small />
      </div>
      <div className="mt-1.5 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">{p.short}</span>
          <span className="capitalize">{c.coverage_phase}</span>
          {c.status === "submitted" && <span className="text-teal-600">submitted</span>}
          {c.status === "decided" && <span className="text-slate-400">decided</span>}
        </div>
        <div className="flex items-center gap-2">
          <span className={`font-mono text-xs font-medium ${BAND[pred.band]}`}>{Math.round(pred.p * 100)}%</span>
          <span className="inline-flex items-center gap-0.5 text-[11px] text-slate-400"><Clock className="h-3 w-3" />{age}d</span>
        </div>
      </div>
    </button>
  );
}

function CriterionRow({ r, onResolve, canResolve }) {
  const s = STATUS[r.status];
  return (
    <div className="grid grid-cols-[1fr_auto] gap-x-6 py-3 border-t border-slate-100 first:border-t-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <s.Icon className={`h-4 w-4 ${s.tone}`} />
          <span className="text-sm text-slate-800">{r.description}</span>
        </div>
        <div className="mt-1 ml-6 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-mono text-[11px] text-slate-400">{r.cite}</span>
          {r.doc_id && <span className="font-mono text-[11px] text-slate-400">· {r.doc_id}</span>}
          {r.gap_action && <span className="text-xs text-slate-500">{r.gap_action}</span>}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1.5">
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${s.ring}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />{s.label}
        </span>
        {r.hasConf && <ConfidenceMeter value={r.confidence} />}
        {r.status !== "satisfied" && r.fixable && canResolve && (
          <button onClick={() => onResolve(r.criterion_id)}
            className="text-[11px] font-medium text-teal-700 hover:text-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 rounded">Resolve →</button>
        )}
      </div>
    </div>
  );
}

function PredictionCard({ pred, actual }) {
  const pct = Math.round(pred.p * 100);
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">
            <TrendingUp className="h-3.5 w-3.5" /> Predicted first-pass approval
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className={`text-3xl font-semibold tracking-tight ${BAND[pred.band]}`}>{pct}%</span>
            {actual && (
              <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${DECISION[actual]}`}>actual: {actual}</span>
            )}
          </div>
          <div className="mt-0.5 text-xs text-slate-400">if submitted now · learned from {pred.n} linked decisions for this payer</div>
        </div>
        <div className="w-24">
          <div className="h-1.5 rounded-full bg-slate-200">
            <div className={`h-1.5 rounded-full ${BAND_BG[pred.band]}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>
      <div className="mt-3 space-y-1 border-t border-slate-100 pt-3">
        {pred.factors.map((f, i) => (
          <div key={i} className="flex items-center justify-between text-xs">
            <span className="text-slate-600">{f.label}</span>
            <span className="font-mono text-slate-400">{f.effect}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PacketPreview({ c, ev }) {
  const [open, setOpen] = useState(false);
  const included = ev.results.filter((r) => r.status === "satisfied" && r.doc_id);
  const gaps = ev.results.filter((r) => r.status !== "satisfied");
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <button onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500">
        <span className="flex items-center gap-2 text-sm font-medium text-slate-700"><FileText className="h-4 w-4 text-slate-400" /> Assembled packet</span>
        <span className="flex items-center gap-2 text-xs text-slate-400">
          {ev.verdict === "submit_ready" ? `${included.length} documents · ready` : `${gaps.length} gap${gaps.length === 1 ? "" : "s"} outstanding`}
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      {open && (
        <div className="border-t border-slate-100 p-4">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-3">
            {[["Case", c.case_id], ["Payer", PAYERS[c.coverage.payer_id].label], ["Member", c.coverage.member_id],
              ["Device", `${c.order.device.hcpcs} ${c.order.device.description}`], ["Diagnosis", c.order.dx.join(", ")],
              ["Phase", c.coverage_phase], ["Channel", ev.policy.submission_channel], ["Policy", `${ev.policy.policy_id || ev.policy.payer_id} v${ev.policy.version}`]].map(([k, v]) => (
              <div key={k}><div className="text-slate-400">{k}</div><div className="font-mono text-slate-700">{v}</div></div>
            ))}
          </div>
          <div className="mt-4 text-xs font-medium uppercase tracking-wide text-slate-400">Included documents</div>
          <div className="mt-1.5 space-y-1">
            {included.length === 0 && <div className="text-xs text-slate-400">None yet — resolve gaps to assemble the packet.</div>}
            {included.map((r) => (
              <div key={r.criterion_id} className="flex items-center justify-between rounded bg-slate-50 px-3 py-1.5 text-xs">
                <span className="text-slate-600">{r.description}</span>
                <span className="font-mono text-slate-500">{r.doc_id}</span>
              </div>
            ))}
          </div>
          {gaps.length > 0 && (
            <div className="mt-3 rounded bg-rose-50 px-3 py-2 text-xs text-rose-700">
              Held from submission: {gaps.map((g) => g.description).join("; ")}.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ActivityTimeline({ events }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Activity</div>
      <ol className="mt-3 space-y-3">
        {events.map((e, i) => (
          <li key={i} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className="mt-1 h-2 w-2 rounded-full bg-teal-500" />
              {i < events.length - 1 && <span className="mt-1 w-px flex-1 bg-slate-200" />}
            </div>
            <div className="-mt-0.5">
              <div className="text-sm text-slate-700">{e.label}</div>
              <div className="font-mono text-[11px] text-slate-400">{e.t}</div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function StatTile({ label, value, sub }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

export default function App() {
  const [cases, setCases] = useState(initialCases);
  const [outcomes, setOutcomes] = useState(seedOutcomes);
  const [activity, setActivity] = useState(seedActivity);
  const [selectedId, setSelectedId] = useState("PA-2042");
  const [mode, setMode] = useState("shadow");
  const [tab, setTab] = useState("queue");
  const [query, setQuery] = useState("");
  const [fVerdict, setFVerdict] = useState("all");
  const [fPayer, setFPayer] = useState("all");
  const [sortBy, setSortBy] = useState("priority");

  const evals = useMemo(() => {
    const m = {}; cases.forEach((c) => (m[c.case_id] = evaluateCase(c))); return m;
  }, [cases]);
  const profiles = useMemo(() => payerProfiles(outcomes), [outcomes]);
  const preds = useMemo(() => {
    const m = {}; cases.forEach((c) => (m[c.case_id] = predictApproval(c, evals[c.case_id], profiles))); return m;
  }, [cases, evals, profiles]);

  const selected = cases.find((c) => c.case_id === selectedId);
  const selEval = selected ? evals[selected.case_id] : null;
  const selPred = selected ? preds[selected.case_id] : null;

  const appendActivity = (caseId, label) =>
    setActivity((a) => ({ ...a, [caseId]: [{ t: "just now", label }, ...(a[caseId] || [])] }));

  const patchCase = (caseId, patch) =>
    setCases((cs) => cs.map((c) => {
      if (c.case_id !== caseId) return c;
      const evidence = { ...c.evidence, ...(patch.evidence || {}) };
      const field_meta = { ...c.field_meta };
      Object.entries(patch.meta || {}).forEach(([k, v]) => (field_meta[k] = { confidence: v }));
      return { ...c, evidence, field_meta, ...(patch.top || {}) };
    }));

  const resolveGap = (caseId, critId) => {
    const crit = Object.values(C).find((x) => x.id === critId);
    if (crit?.fix) { patchCase(caseId, crit.fix); appendActivity(caseId, `Gap resolved · ${crit.description}`); }
  };
  const submitCase = (c) => {
    if (mode !== "assist") return;
    patchCase(c.case_id, { top: { status: "submitted" } });
    appendActivity(c.case_id, `Submitted to ${PAYERS[c.coverage.payer_id].short} via ${evals[c.case_id].policy.submission_channel}`);
  };
  const simulateDecision = (c) => {
    const ev = evals[c.case_id];
    const approved = ev.verdict === "submit_ready";
    const blocking = ev.results.find((r) => r.status !== "satisfied");
    const reasonMap = { ahi_qualifying: "sleep_study_insufficient", f2f: "no_face_to_face", adherence: "adherence_not_met", benefit_reeval: "adherence_not_met", valid_rx: "admin_error" };
    const outcome = { id: "O" + Math.random().toString(36).slice(2, 7), case_id: c.case_id, payer_id: c.coverage.payer_id,
      decision: approved ? "approved" : "denied", reason_code: approved ? null : (reasonMap[blocking?.criterion_id] || "other"),
      decided_at: "2026-06-11", linked: true, link_confidence: 0.96 };
    setOutcomes((o) => [outcome, ...o]);
    patchCase(c.case_id, { top: { status: "decided" } });
    appendActivity(c.case_id, `Decision linked · ${outcome.decision}${outcome.reason_code ? " (" + REASON_LABEL[outcome.reason_code] + ")" : ""}`);
  };
  const confirmLink = (outcomeId, caseId) => {
    setOutcomes((os) => os.map((o) => (o.id === outcomeId ? { ...o, linked: true, case_id: caseId, link_confidence: 0.99 } : o)));
    appendActivity(caseId, "Decision manually linked from inbox");
  };

  // analytics
  const linked = outcomes.filter((o) => o.linked && o.case_id);
  const inbox = outcomes.filter((o) => !o.linked);
  const byPayer = useMemo(() => Object.keys(PAYERS).map((pid) => {
    const set = linked.filter((o) => o.payer_id === pid);
    const appr = set.filter((o) => o.decision === "approved").length;
    return { payer: PAYERS[pid].short, rate: set.length ? Math.round((appr / set.length) * 100) : 0 };
  }), [outcomes]);
  const denialMix = useMemo(() => {
    const m = {}; linked.filter((o) => o.decision === "denied").forEach((o) => (m[o.reason_code] = (m[o.reason_code] || 0) + 1));
    return Object.entries(m).map(([k, v]) => ({ reason: REASON_LABEL[k] || k, n: v }));
  }, [outcomes]);
  const linkRate = outcomes.length ? Math.round((outcomes.filter((o) => o.linked).length / outcomes.length) * 100) : 0;
  const firstPass = linked.length ? Math.round((linked.filter((o) => o.decision === "approved").length / linked.length) * 100) : 0;
  const verdictMix = cases.reduce((a, c) => { const v = evals[c.case_id].verdict; a[v] = (a[v] || 0) + 1; return a; }, {});

  // queue filter + sort
  const order = { needs_info: 0, abstain: 1, submit_ready: 2 };
  const visibleCases = useMemo(() => {
    let list = cases.filter((c) => {
      if (fVerdict !== "all" && evals[c.case_id].verdict !== fVerdict) return false;
      if (fPayer !== "all" && c.coverage.payer_id !== fPayer) return false;
      if (query) { const q = query.toLowerCase(); if (!c.case_id.toLowerCase().includes(q) && !c.coverage.member_id.toLowerCase().includes(q)) return false; }
      return true;
    });
    list = [...list].sort((a, b) => {
      if (sortBy === "newest") return new Date(b.received_at) - new Date(a.received_at);
      const oa = order[evals[a.case_id].verdict], ob = order[evals[b.case_id].verdict];
      if (oa !== ob) return oa - ob;
      return preds[a.case_id].p - preds[b.case_id].p;
    });
    return list;
  }, [cases, evals, preds, query, fVerdict, fPayer, sortBy]);

  const actualFor = (caseId) => outcomes.find((o) => o.case_id === caseId && o.linked)?.decision;

  const Tab = ({ id, label, count }) => (
    <button onClick={() => setTab(id)}
      className={`relative px-3 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 rounded ${tab === id ? "text-slate-900" : "text-slate-500 hover:text-slate-700"}`}>
      {label}{count ? <span className="ml-1.5 rounded-full bg-rose-100 px-1.5 text-[11px] text-rose-700">{count}</span> : null}
      {tab === id && <span className="absolute -bottom-px left-2 right-2 h-0.5 rounded-full bg-teal-600" />}
    </button>
  );
  const Chip = ({ v, set, val, children }) => (
    <button onClick={() => set(val)}
      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500
        ${v === val ? "border-teal-600 bg-teal-50 text-teal-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>{children}</button>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900" style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif" }}>
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-slate-900 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="h-5 w-5 text-teal-400" />
            <span className="font-semibold tracking-tight">Coral Authorize</span>
            <span className="ml-1 rounded bg-white/10 px-1.5 py-0.5 font-mono text-[11px] text-slate-300">DME · PAP</span>
          </div>
          <div className="flex items-center rounded-full border border-white/15 p-0.5">
            {["shadow", "assist"].map((m) => (
              <button key={m} onClick={() => setMode(m)}
                className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 ${mode === m ? "bg-teal-500 text-white" : "text-slate-300 hover:text-white"}`}>{m}</button>
            ))}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5">
        <nav className="flex items-center gap-1 border-b border-slate-200 py-1">
          <Tab id="queue" label="Queue" />
          <Tab id="analytics" label="Outcomes" />
          <Tab id="inbox" label="Link inbox" count={inbox.length} />
          <div className="ml-auto flex items-center gap-1.5 pr-1 text-xs text-slate-400">
            <span className="font-mono">τ = {TAU}</span><span>·</span>
            <span>{mode === "shadow" ? "Shadow — observing" : "Assist — human submits"}</span>
          </div>
        </nav>

        {tab === "queue" && (
          <div className="grid grid-cols-1 gap-5 py-5 md:grid-cols-[340px_1fr]">
            <div className="rounded-lg border border-slate-200 bg-white">
              <div className="border-b border-slate-100 p-3">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search case or member"
                    className="w-full rounded-md border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500" />
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  <Chip v={fVerdict} set={setFVerdict} val="all">All</Chip>
                  <Chip v={fVerdict} set={setFVerdict} val="submit_ready">Ready</Chip>
                  <Chip v={fVerdict} set={setFVerdict} val="needs_info">Needs info</Chip>
                  <Chip v={fVerdict} set={setFVerdict} val="abstain">Holding</Chip>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="flex gap-1">
                    <Chip v={fPayer} set={setFPayer} val="all">All payers</Chip>
                    {Object.keys(PAYERS).map((pid) => <Chip key={pid} v={fPayer} set={setFPayer} val={pid}>{PAYERS[pid].short}</Chip>)}
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-400">
                  <span>Sort</span>
                  <button onClick={() => setSortBy("priority")} className={`rounded px-1.5 py-0.5 ${sortBy === "priority" ? "bg-slate-900 text-white" : "hover:bg-slate-100"}`}>Priority</button>
                  <button onClick={() => setSortBy("newest")} className={`rounded px-1.5 py-0.5 ${sortBy === "newest" ? "bg-slate-900 text-white" : "hover:bg-slate-100"}`}>Newest</button>
                  <span className="ml-auto font-mono">{visibleCases.length}/{cases.length}</span>
                </div>
              </div>
              <div className="divide-y divide-slate-100">
                {visibleCases.map((c) => (
                  <QueueRow key={c.case_id} c={c} evalr={evals[c.case_id]} pred={preds[c.case_id]}
                    active={c.case_id === selectedId} onClick={() => setSelectedId(c.case_id)} />
                ))}
                {visibleCases.length === 0 && <div className="px-4 py-8 text-center text-sm text-slate-400">No cases match these filters.</div>}
              </div>
            </div>

            {selected && selEval && (
              <div className="space-y-4">
                <div className="rounded-lg border border-slate-200 bg-white">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-5">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-lg font-semibold">{selected.case_id}</span>
                        <VerdictPill verdict={selEval.verdict} />
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                        <span>{PAYERS[selected.coverage.payer_id].label}</span>
                        <span className="capitalize">· {selected.coverage_phase}</span>
                        <span className="font-mono">· {selected.order.device.hcpcs}</span>
                        <span className="font-mono">· dx {selected.order.dx.join(", ")}</span>
                        <span className="font-mono">· {selected.coverage.member_id}</span>
                        <span className="inline-flex items-center gap-0.5"><Clock className="h-3 w-3" />{daysOld(selected.received_at)}d</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      {selected.status !== "submitted" && selected.status !== "decided" && (
                        <button onClick={() => submitCase(selected)} disabled={selEval.verdict !== "submit_ready" || mode !== "assist"}
                          className="inline-flex items-center gap-1.5 rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white enabled:hover:bg-teal-700 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500">
                          <Send className="h-3.5 w-3.5" />{mode === "assist" ? "Submit to payer" : "Submit (assist only)"}
                        </button>
                      )}
                      {selected.status === "submitted" && (
                        <button onClick={() => simulateDecision(selected)}
                          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500">
                          <RotateCcw className="h-3.5 w-3.5" /> Simulate payer decision
                        </button>
                      )}
                      {selected.status === "decided" && <span className="text-xs text-slate-400">Decision recorded</span>}
                      {mode === "shadow" && selEval.verdict === "submit_ready" && selected.status === "queue" && <span className="text-[11px] text-slate-400">Would submit in assist mode</span>}
                    </div>
                  </div>
                  <div className="p-5">
                    <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Criteria · {selEval.policy.payer_id} {selEval.policy.coverage_phase}</div>
                    {selEval.results.map((r) => (
                      <CriterionRow key={r.criterion_id} r={r} canResolve={selected.status === "queue"} onResolve={(cid) => resolveGap(selected.case_id, cid)} />
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <PredictionCard pred={selPred} actual={actualFor(selected.case_id)} />
                  <ActivityTimeline events={activity[selected.case_id] || []} />
                </div>
                <PacketPreview c={selected} ev={selEval} />
              </div>
            )}
          </div>
        )}

        {tab === "analytics" && (
          <div className="py-5">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatTile label="First-pass approval" value={`${firstPass}%`} sub={`${linked.length} linked decisions`} />
              <StatTile label="Decision linkage rate" value={`${linkRate}%`} sub={`${inbox.length} awaiting manual link`} />
              <StatTile label="Ready in queue" value={verdictMix.submit_ready || 0} sub={`${cases.length} active cases`} />
              <StatTile label="Held (low confidence)" value={verdictMix.abstain || 0} sub="abstained, not submitted" />
            </div>
            <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="text-sm font-medium text-slate-700">First-pass approval by payer</div>
                <div className="mt-3 h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={byPayer} margin={{ top: 12, right: 8, left: -16, bottom: 0 }}>
                      <XAxis dataKey="payer" tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                      <Tooltip cursor={{ fill: "#f1f5f9" }} formatter={(v) => [`${v}%`, "approval"]} />
                      <Bar dataKey="rate" radius={[4, 4, 0, 0]} fill="#0d9488">
                        <LabelList dataKey="rate" position="top" formatter={(v) => `${v}%`} fontSize={11} fill="#475569" />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="text-sm font-medium text-slate-700">Denial reasons</div>
                <div className="mt-3 h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart layout="vertical" data={denialMix} margin={{ top: 4, right: 16, left: 40, bottom: 0 }}>
                      <XAxis type="number" hide />
                      <YAxis type="category" dataKey="reason" width={120} tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                      <Tooltip cursor={{ fill: "#f1f5f9" }} />
                      <Bar dataKey="n" radius={[0, 4, 4, 0]} fill="#e11d48"><LabelList dataKey="n" position="right" fontSize={11} fill="#475569" /></Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
            <p className="mt-4 text-xs text-slate-400">The same linked-outcome data drives the per-case approval prediction. In production this is live submission-to-decision data, not seeded.</p>
          </div>
        )}

        {tab === "inbox" && (
          <div className="py-5">
            {inbox.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center">
                <Inbox className="mx-auto h-6 w-6 text-slate-300" />
                <div className="mt-2 text-sm text-slate-500">No decisions awaiting a manual link.</div>
                <div className="mt-1 text-xs text-slate-400">High-confidence links attach automatically; only ambiguous ones land here.</div>
              </div>
            ) : inbox.map((o) => {
              const candidates = scoreLink({ member_id: o.member_id, device: o.device, auth_ref: o.auth_ref }, cases).slice(0, 3);
              return (
                <div key={o.id} className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm">
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${DECISION[o.decision]}`}>{o.decision}</span>
                      <span className="text-slate-600">{REASON_LABEL[o.reason_code] || "—"}</span>
                      <span className="font-mono text-xs text-slate-400">member {o.member_id} · {o.device} · {o.decided_at}</span>
                    </div>
                    <span className="text-xs text-amber-600">No high-confidence match — needs review</span>
                  </div>
                  <div className="mt-3 border-t border-slate-100 pt-3">
                    <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Candidate cases</div>
                    <div className="space-y-1.5">
                      {candidates.map((cand) => (
                        <div key={cand.case_id} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2">
                          <div className="flex items-center gap-3 text-sm">
                            <span className="font-mono font-medium text-slate-800">{cand.case_id}</span>
                            <span className="font-mono text-xs text-slate-400">{cand.member}</span>
                            <span className="font-mono text-xs text-slate-500">match {Math.round(cand.score * 100)}%</span>
                          </div>
                          <button onClick={() => confirmLink(o.id, cand.case_id)}
                            className="inline-flex items-center gap-1 rounded-md border border-teal-600 px-2.5 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500">
                            Confirm match <ChevronRight className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <footer className="mx-auto max-w-6xl px-5 py-6 text-xs text-slate-400">
        Rules layer live · outcome loop capturing · prediction is a heuristic over the seeded outcomes, illustrating the learned layer that trains on the real linked dataset. Synthetic data, no PHI.
      </footer>
    </div>
  );
}
