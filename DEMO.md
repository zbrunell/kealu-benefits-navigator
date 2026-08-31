# Demo Script

## Austin, Texas — the multi-jurisdiction demo (web app)

The scenario to run to confirm a household outside California gets a correct
plan. Everything below flows through the real jurisdiction resolution, program
registry and eligibility screening — demo mode replaces only the LLM that writes
the phase prose, not any of the logic.

### Run it

```bash
cd web
E2E_MODE=1 E2E_PHASE_DELAY_MS=300 caffeinate -i npm run dev
```

Open http://localhost:3000 and answer the three Tier-1 questions:

| Question | Answer |
|---|---|
| ZIP code | `78705` |
| Annual household income | `20000` |
| Household | `Two adults, ages 34 and 31` |

Then click **Skip remaining questions** → **Run Analysis**.

### What you should see

**Jurisdiction** — the Benefits Research phase opens with:

```
Country: US   State: TX   County: Travis   City: Austin   ZIP: 78705
```

**18 programs**, each tagged with the level it is administered at — Federal,
State, County, or City / local — with its agency, source URL and the effective
date of the thresholds used.

**Recommended:** Texas SNAP (screened against the real HHSC gross limit of
$2,292/month for a household of 2), Central Health MAP, the Austin Energy
Customer Assistance Program, CEAP, and federal Lifeline.

**Correctly refused:** every Texas Medicaid category, because two non-pregnant
adults with no children match none of them — and **not** on a 138% FPL test,
which does not exist in Texas. TANF is refused on household composition, not on
income.

**The coverage gap, named plainly:**

> Texas did not expand Medicaid, so adults who are not pregnant, not caring for
> a child, and not disabled usually cannot get Medicaid at any income. Below the
> poverty line they also cannot get marketplace subsidies. Local programs are
> the realistic route to care.

**Evidence Verification** shows a jurisdiction check (`California-only programs
offered | 0 | 0 | PASS`) and a threshold-provenance table marking each figure
VERIFIED or NEEDS REVIEW.

**Documents** are three lists, not one: what you need to submit (you can submit
today), what will likely be verified, and what may be requested.

**Values** are estimated only where a published formula exists — SNAP shows
~$109/mo from the allotment formula; coverage programs read "Not estimated" with
the reason.

Click **Continue with 1 recommended program** → the Texas Form H1010
application: the four Texas programs to tick, then Texas's own screens — where
you live and get your mail, who lives with you, money, bills, things you own,
the SNAP expedited screen, your situation, and anyone applying on your behalf.

**Generate** produces a filled H1010 worksheet plus a review sheet naming what
was filled in, what a blank completes, and what your own answers make
inapplicable — with the reason for each. The screen says plainly that HHSC
publishes H1010 only through its own website, so what you are holding carries
your answers rather than being the agency's paper.

### What must NOT appear

Medi-Cal · CalFresh · CalWORKs · SAWS 2 PLUS · BenefitsCal · GetCalFresh ·
Covered California · California CARE · California LifeLine ·
benefitscal.com · getcalfresh.org · coveredca.com

### The California control

Same server, ZIP `90001`, income `42000`, household
`Single parent with 2 kids ages 4 and 9`. This must still produce Medi-Cal,
CalFresh, CalWORKs and a generated SAWS 2 PLUS draft — and no Texas program.

### Automated equivalents

```bash
cd web
npx vitest run tests/unit/austin-scenarios.test.ts tests/unit/jurisdiction-routing.test.ts
caffeinate -i npx playwright test --project=applications
```

---

# MCP server demo script

## Prerequisites

1. Antigravity running with benefits-navigator MCP server loaded
2. `CMS_API_KEY` configured (enables live Healthcare.gov data)

## MCP Config

```json
{
  "mcpServers": {
    "benefits-navigator": {
      "command": "/bin/zsh",
      "args": [
        "-c",
        "set -a && source ~/.env && source /path/to/kealu-benefits-navigator/.env && set +a && exec /path/to/kealu-benefits-navigator/.venv/bin/python -m benefits_navigator"
      ],
      "cwd": "/path/to/kealu-benefits-navigator"
    }
  }
}
```

> **Note:** Replace `/path/to/kealu-benefits-navigator` with your actual project path.

## Prompts

Paste each prompt after the previous response completes.

### Prompt 1 — Opening

> What benefits and health insurance options are available for my family in Los Angeles?

**What happens:** Triggers tool discovery and tier-1 intake. The MCP server returns follow-up questions (ZIP, income, household) instead of generic advice.

**What to highlight:** Conversational intake flow — no parameter dump, no form to fill out.

### Prompt 2 — Full Profile

> My ZIP is 90001, Los Angeles County. I make $42,000/year as a W-2 employee. It's me and my two kids, ages 4 and 9. I lost my employer health insurance about 6 weeks ago — they offered COBRA but it's $1,400/month, way too expensive. My son takes Zyrtec daily for allergies and I take Lisinopril 10mg for blood pressure. We see Dr. Sarah Chen at Children's Hospital Los Angeles and I see Dr. James Park at Kaiser Permanente. I'd like to keep both doctors. I can afford maybe $250-300/month for premiums. My 4-year-old has asthma so we need good urgent care and ER coverage.

**What happens:** Hits all intake tiers, triggers the full 5-phase parallel workflow — benefits research, insurance research, evidence verification, eligibility validation, and action plan.

**What to highlight:**
- SEP urgency detection (6 weeks ago = ~2 weeks left on 60-day window)
- California Medicaid expansion — Medi-Cal eligibility for the full household
- Adversarial evidence verification catches and corrects FPL calculation
- Prioritized action plan with .gov URLs and deadlines

### Prompt 3 — Insurance Comparison (Live API)

> Can you compare the actual health insurance plans available to me?

**What happens:** Calls the CMS Marketplace API with the household profile. Returns real Healthcare.gov plans with APTC-adjusted premiums.

**What to highlight:**
- **Live data from Healthcare.gov** — real plan names, real issuers, real premiums
- APTC subsidy calculated for this specific household
- CSR eligibility flagged (Silver CSR-87 at ~163% FPL)
- Premium range shows after-subsidy costs within stated budget

### Prompt 4 — Eligibility Check (CMS Enrichment)

> Am I eligible for Medi-Cal for my kids?

**What happens:** CMS API provides live APTC/FPL/Medicaid data, layered on top of Vector's AI analysis with FPL tables and state-specific rules.

**What to highlight:**
- Live FPL percentage from CMS
- State Medicaid thresholds from CMS (California is an expansion state)
- Vector analysis cross-references against program-specific rules
- Two data sources (live API + AI analysis) producing a verified answer

### Prompt 5 — Official Form Filling (Pre-filled SAWS-1)

> Can you generate a draft application for the programs I qualify for?

**What happens:** Detects California has an official fillable form (SAWS-1 for CalFresh/Medi-Cal/CalWORKs). Fills the real government form's AcroForm fields (state, ZIP, county, date, language) and checks the correct program checkboxes based on eligibility results. Saves the pre-filled PDF to disk.

**What to highlight:**
- **Fills the actual government form** — not a generic worksheet, the real SAWS-1
- Program checkboxes (CalFresh, Medi-Cal) are pre-checked based on eligibility analysis
- State, ZIP, county, date, and language fields pre-filled
- Sensitive fields (SSN, DOB, name) left blank for the applicant to complete
- **4 states supported** — CA, IL, NY, PA have official fillable forms; all others get worksheets
- pypdf is an optional dependency — core system remains zero-dep

## Key Talking Points

- **$80B problem** — that's how much goes unclaimed in US government benefits annually
- **Live data, not hallucination** — Healthcare.gov Marketplace API returns real plans, real premiums
- **Adversarial verification** — a dedicated agent fact-checks the other agents' work
- **5 specialized Gemini agents** orchestrated in parallel by Kealu Vector
- **Zero core dependencies** — MCP server is stdlib-only Python; pypdf is optional for official form filling
- **Takes action** — fills actual government application forms (CA, IL, NY, PA) or generates preparation worksheets
- **Smart fallback** — official fillable form → worksheet, based on state availability
- **4 state forms** — California SAWS-1, Illinois IL444-2378B, New York LDSS-4826-DD, Pennsylvania PA-600
- **7 ADRs** — architecture decisions documented in [ARCHITECTURE.md](ARCHITECTURE.md)
