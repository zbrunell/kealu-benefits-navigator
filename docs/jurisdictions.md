# Jurisdictions: how a location decides which programs exist

## The failure this design exists to prevent

A household in ZIP 78705 — Austin, Travis County, Texas — received Medi-Cal,
CalFresh, CalWORKs, SAWS 2 PLUS, BenefitsCal, Covered California and California
CARE. The output was well-formatted, internally consistent, and completely wrong
for where the household lives.

It was not one bug. Four layers each contributed:

1. **Location resolution stopped at the state.** `ZIP_LOCATIONS` listed
   California cities only, so 78705 resolved `state: 'TX'` from the prefix table
   and left city and county blank. Nothing downstream could match a county or
   city program because there was no county or city.
2. **The demo fixture *was* the rules engine.** `e2e-fixture.ts` held
   `screenMediCal`, `screenCalFresh` and `screenCalWorks` and called all three
   unconditionally. It never read the state. Its phase documents interpolated
   BenefitsCal, GetCalFresh, Covered California and CARE as string literals.
3. **The report route defaulted to California.** `state: session.vars.state ||
   "CA"` — so an unresolved location was silently treated as a California
   household.
4. **The production prompt gave up outside California.** The workflow YAML told
   the model "for households outside California, return an empty `applications`
   array", so a Texas household got no structured output at all, while the prose
   phases had no jurisdiction constraint and free-associated California programs.

The common thread: **nowhere did a program declare where it was valid.** The only
thing that made "Medi-Cal" Californian was the name, and recognising a name is
not something a system can be built on.

## The architecture

```
ZIP / address
     ↓
Jurisdiction  (country → state → county → city)      lib/jurisdiction.ts
     ↓
discoverPrograms(jurisdiction)                       lib/programs/
     ↓                    ← HARD FILTER: geography only, before any policy
Screening                                            lib/program-screening.ts
     ↓
assertJurisdictionInvariant()                        lib/jurisdiction-invariant.ts
     ↓
resolveApplicationBundle()                           lib/state-applications.ts
     ↓
Action plan / forms / completion guide
```

### `Jurisdiction` — resolved once, then passed

```ts
Jurisdiction {
  country: 'US',
  state:   'TX',
  county:  'Travis',
  city:    'Austin',
  zipCode: '78705',
}
```

Resolved from the ZIP at intake and carried through. Nothing downstream
re-derives it. Unresolved levels are empty strings, never guesses — a ZIP
straddling two counties (78717, spanning Travis and Williamson) resolves its
state and leaves the county blank, and county programs are then withheld. That
is a real loss of coverage for the applicant and still the right answer: sending
someone to an office that will turn them away is worse.

### The program registry — programs declare their own geography

`lib/programs/` holds one file per jurisdiction plus an index:

```
programs/
  types.ts      ProgramDefinition, EligibilityRuleSet, appliesTo()
  federal.ts    marketplace, WIC, LIHEAP, Lifeline, Medicare Savings
  ca.ts         Medi-Cal, CalFresh, CalWORKs, Covered California, CARE, LifeLine, WIC
  tx.ts         Texas statewide + Travis County + City of Austin
  index.ts      the registry, discoverPrograms(), audit helpers
```

Every program carries `level` plus the geography that level implies:

```ts
{ id: 'tx_snap',                   level: 'state',  state: 'TX' }
{ id: 'travis_central_health_map', level: 'county', state: 'TX', county: 'Travis' }
{ id: 'austin_energy_cap',         level: 'city',   state: 'TX', county: 'Travis',
                                   cities: ['Austin'] }
{ id: 'federal_marketplace',       level: 'federal',
    excludedStates: [/* states running their own ACA exchange */] }
```

`appliesTo(program, jurisdiction)` is a total function that reads only declared
geography — never the program's name. `discoverPrograms` is the single
jurisdiction gate, and it runs *before* eligibility reasoning. A program it does
not return cannot be recommended, cannot reach an action plan, and cannot reach a
form — not because a later stage filters it again, but because no later stage
ever sees it.

**Adding a third state** means adding a data file and one line in `REGISTRIES`.
No function in `lib/programs/` branches on a state code.

### Provenance is part of the data

Every encoded threshold carries where it came from and when it took effect:

```ts
rules: {
  program: 'tx_snap',
  monthlyGrossByHouseholdSize: [1696, 2292, 2888, ...],   // 130% FPL
  monthlyCategoricalByHouseholdSize: [2152, 2908, ...],    // 165% FPL
  source: {
    url: 'https://fhb.hhs.texas.gov/handbooks/texas-works-handbook/c-120-...',
    revision: 'Revision 25-4',
    effectiveFrom: '2025-10-01',
    verified: true,
  },
}
```

`verified: false` does not stop the screening using a number — it stops us
claiming the number is checked. `unverifiedRuleSets()` computes the audit list
from the data, and the report's Evidence Verification phase prints it as a
"NEEDS REVIEW" column so a stale threshold is visible in the output rather than
hidden in a prompt.

### Texas is not California with different labels

The single most important encoded fact is a negative one: **Texas did not adopt
ACA Medicaid expansion.** There is no "adults under 138% FPL get Medicaid" rule
to write.

So there is deliberately no shared "adult Medicaid" rule. California's single
138% FPL test lives in `caMediCalRule`. Texas Medicaid is several separate
programs with separate thresholds — children by age band (198% under 1, 144%
ages 1–5, 133% ages 6–18), pregnancy (198%), CHIP (201%), CHIP Perinatal (202%),
parents and caretaker relatives (a 1996 AFDC dollar standard, far below the
poverty line) — and an adult matching none of them is ineligible at any income.

Below 100% FPL they are also below the marketplace subsidy floor. That is the
coverage gap, and `inCoverageGap` computes it from the discovered program set
rather than from a state code, so it can never be asserted for California.

A county program does **not** close the gap. Central Health MAP is the right
answer *to* the gap — local network access, not insurance, and it does not
travel. Treating it as coverage would suppress the warning for exactly the
households that most need to understand their position.

### One engine, demo and production

`screenHousehold` is called by both the demo fixture and the production report
path. `e2e-fixture.ts` now contains no eligibility logic at all; it supplies
deterministic household values and renders phase prose from the registry. There
is no demo-only rules engine left to drift.

### Two id spaces, kept apart

- **Registry ids** (`tx_medicaid_child`, `travis_central_health_map`) answer
  "what programs exist, and where are they valid".
- **`BenefitProgramId`** (`medi_cal`, `tx_snap`) answers "what does this *form*
  cover".

Form H1010 has one healthcare section, so three Texas Medicaid categories map to
one `tx_medicaid` box. Central Health MAP maps to no form at all — which is
exactly the fact the action plan needs, and would lose if every program were
forced onto a form. `resolveApplicationBundle` returns both the form boxes and
the programs needing their own separate application.

### Defense in depth, clearly labelled

`assertJurisdictionInvariant` is a **structural** check at the
program-selection / action-plan boundary. It re-derives what `discoverPrograms`
would allow and rejects anything else. It cannot be fooled by naming because it
does not read names. This is a real guarantee.

`detectJurisdictionLeaks` scans *rendered text* for another state's vocabulary.
This is a **last line of defense only**, and must never be mistaken for the
first. A string blocklist cannot enumerate every way a model might name a
California program, and passing it proves nothing about whether program
resolution was correct. It exists because one producer in the pipeline is an LLM
writing prose we do not control.

It also has to be written carefully. The original CA pattern was
`/\bMedi-?Cal\b/i`, which also matches the ordinary word "Medical" — and so
fired on Travis County's **Medical** Access Program, reporting a California leak
inside the most important Austin program in the registry. A detector that flags
correct output is worse than no detector, because the fix is to silence it.

## Supported markets

| Level | California | Texas |
|---|---|---|
| State health | Medi-Cal, Covered California | Children's Medicaid (STAR), CHIP, Medicaid for Pregnant Women, CHIP Perinatal, Healthy Texas Women, Parents/Caretaker Relatives |
| State food | CalFresh, CA WIC | Texas SNAP, Texas WIC |
| State cash | CalWORKs | Texas TANF |
| State utilities | CARE, California LifeLine | CEAP |
| County | — | Central Health MAP (Travis) |
| City | — | Austin Energy CAP, Austin Energy Plus 1 |
| Form | SAWS 2 PLUS (`generated`) | Form H1010 (`generated`) |

Federal, both: HealthCare.gov marketplace (TX only — CA has its own exchange),
WIC, LIHEAP, Lifeline, Medicare Savings Programs.

## Adding a jurisdiction

1. Add `lib/programs/<state>.ts` with the programs and their sourced rule sets.
2. Add it to `REGISTRIES` in `lib/programs/index.ts`.
3. Add the state's ZIPs to `ZIP_LOCATIONS` in `lib/location.ts` — city and
   county are what promote a ZIP from "some state" to a jurisdiction that county
   and city programs can match against.
4. Add screening rules to `RULES` in `lib/program-screening.ts` for programs
   whose thresholds you encoded. A program with no rule is still discovered and
   shown as available-but-undetermined, never dropped.
5. Add its form to `DEFINITIONS` in `lib/state-applications.ts`, plus entries in
   `REGISTRY_TO_FORM_PROGRAM`. A state whose form we cannot fill is `manual`
   and stops here with a transcription guide; one we can fill is `generated`
   and needs the two steps below.
6. Describe the form for the mapping layer: a module under
   `src/benefits_navigator/formmap/forms/` and an entry in its registry. See
   `docs/h1010-mapping-audit.md`.
7. Configure its intake: a question set under `web/src/lib/form-intake/`, and an
   entry in `APPLICATION_FLOWS` in `app-shell.tsx`. The questions bind to
   canonical fields, so a state that needs an answer no other state does is the
   signal to extend the canonical model — not to add a state-named field.
6. Add catalog keys for names, summaries and eligibility reasons in all three
   locales.
7. Add the state's vocabulary to `STATE_TERMINOLOGY` — word-boundary matched,
   and checked against ordinary English words.

The cross-jurisdiction leak tests are written generically over the registry, so
they cover a new state without being edited.
