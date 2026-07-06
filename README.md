[README_1.md](https://github.com/user-attachments/files/29687092/README_1.md)
# Prior Authorization Engine — DME / PAP

A working prior-authorization engine for DME (durable medical equipment), starting with CPAP/PAP therapy for obstructive sleep apnea. It evaluates a patient case against the payer's coverage policy, flags exactly what's missing, predicts first-pass approval from historical outcomes, and closes the loop by linking payer decisions back to the originating case.

**Live demo →** [your-netlify-url]

---

## Why this exists

Prior authorization is the biggest administrative bottleneck in US healthcare — it delays care, drives denials, and burns coordinator time on phone calls, portals, and faxes. The standard workflow today: a coordinator reads an assembled referral, recalls the payer's requirements from memory, hunts for the right documents, decides whether to submit, and then loses sight of the case until a decision comes back through a separate channel, usually unlinked.

This project replaces that with a structured, auditable system: rules as data, confidence-aware evaluation, and a feedback loop that learns from real outcomes.

## What it does

### 1. Policy-aware case evaluation
Takes an extracted referral, resolves the correct payer/plan/phase policy (Medicare, Anthem, UHC), checks every coverage criterion, and returns one of three verdicts:

- **Ready to submit** — all required criteria satisfied above the confidence threshold.
- **Needs info** — a required document or clinical value is missing or doesn't meet the threshold, with the specific gap and the action to close it.
- **Holding** — a required field was extracted below the confidence threshold. The engine doesn't assert "ready" on a shaky read; it routes to a human.

### 2. Outcome-driven approval prediction
Predicts first-pass approval probability per case using the linked decision history. The key insight: a case can pass every published rule and still carry denial risk that the payer's adjudication pattern reveals. The prediction shows the probability, the contributing factors, and the gap between stated policy and real-world approval behavior.

### 3. Closed outcome loop
Captures each returned payer decision, links it back to the originating case using scored fuzzy matching (member ID + device + auth reference + decision window), normalizes the denial reason, and maps it to the specific criterion that failed. Low-confidence links route to a human queue rather than auto-attaching. The linked dataset powers both the analytics and the prediction model.

### 4. Continued-coverage automation
CPAP has two coverage events — initial authorization and a compliance check within 90 days. The engine tracks the compliance window and auto-initiates the continued-phase case before it lapses, running the same evaluation flow against the continued-coverage criteria (the 4hr/70%/30-day adherence rule and the clinical re-evaluation).

## Key design decisions

**Abstention over false confidence.** The engine holds when it's unsure rather than asserting a result. Every clinical field carries an extraction confidence score; anything below the threshold (τ = 0.85) triggers a hold-for-human, not a guess. This is a deliberate choice — a confidently wrong "ready" in healthcare is worse than no answer.

**Rules as data, not code.** Each payer's coverage criteria are stored as declarative, serializable check objects (a small DSL), not hardcoded logic. Adding a payer or updating a policy is a data change, not a code change. The engine is category-agnostic — swap the policy pack and the same machinery runs oxygen, wheelchairs, or any other DME category.

**Payer-specific logic.** The same patient can get different verdicts under different payers. Example in the demo: AHI 11 with symptoms but no comorbidity passes under Medicare (symptoms qualify for the 5–14 pathway) but fails under UHC (which requires a comorbidity for that range). The engine resolves the correct policy per case.

**Shadow → Assist rollout.** Toggle between shadow mode (engine observes but doesn't act — for validation and dataset building) and assist mode (verdict renders in the console, human submits). The engine never auto-submits.

## What's real vs. synthetic

| Layer | Status |
|---|---|
| Engine logic (DSL, evaluation, abstention, verdict) | Real, working, portable |
| Medicare PAP criteria (NCD 240.4 + LCD L33718) | Sourced from CMS; thresholds are real |
| Commercial payer rules (Anthem, UHC) | Illustrative — modeled on published patterns, not verified against specific policy documents |
| Case and outcome data | Synthetic — no PHI; seeded to demonstrate every verdict path |
| Approval prediction | Heuristic over the seeded outcome set, illustrating the learned layer that trains on real linked data |

## The demo queue

The seeded cases are chosen to hit every evaluation path:

| Case | What it demonstrates |
|---|---|
| PA-2041 | Medicare initial, all criteria met → **Ready** |
| PA-2042 | AHI extracted at 62% confidence → **Holding** (abstention) |
| PA-2043 | UHC initial, AHI 11 with symptoms but no comorbidity → **Needs info** (payer-specific rule) |
| PA-2044 | Medicare initial, missing face-to-face note → **Needs info** (hit Resolve to fix) |
| PA-2045 | Anthem initial, clean case → **Ready** |
| PA-2051 | Medicare continued, adherence 87% → **Ready** |
| PA-2052 | Anthem continued, adherence 60% → **Needs info** (below threshold) |
| PA-2053 | Medicare continued, manual adherence source at 58% confidence → **Holding** |

Try: resolve PA-2044's gap → verdict flips to Ready → switch to Assist mode → Submit → Simulate payer decision → watch the outcome flow into the analytics tab and the prediction update.

## Tech

- React 18 + Vite + Tailwind CSS v4
- Recharts for analytics
- Lucide icons
- No backend — the engine runs entirely client-side
- Engine functions (`getPolicy`, `evaluateCriterion`, `evaluateCase`, `scoreLink`, `predictApproval`) are pure, React-free, and portable — lift them into a Node service unchanged

## Run locally

```
npm install
npm run dev
```

## Build & deploy

```
npm run build                              # outputs to dist/
npx netlify-cli deploy --prod --dir=dist   # or drag dist/ to app.netlify.com/drop
```

`netlify.toml` is included. Node 20+.

## Project structure

```
src/
  App.jsx       # engine + UI in one file
                #   top section: engine (portable, no React)
                #   bottom section: React components + state
index.html
vite.config.js
netlify.toml
```

## Where this goes next

- **Real policy packs.** Replace illustrative commercial rules with verified, sourced criteria from published payer policies.
- **More categories.** Home oxygen, CGMs, power mobility, nebulizers — same engine, new policy packs.
- **Backend extraction.** Move the engine server-side, consume real extractor output, and run against a live queue.
- **Outcome loop at scale.** With real submission-to-decision data, the prediction layer trains on the gap between stated policy and actual adjudication — the dataset that compounds.

## License

MIT
