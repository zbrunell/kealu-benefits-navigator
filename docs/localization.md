# Localization

The SAWS 2 PLUS flow is served in three languages, end to end: intake,
questionnaire, validation, review, the generated PDF, and the completion guide.

## Supported locales

| Code    | Language           | Interface | Completion guide | Official state form |
| ------- | ------------------ | --------- | ---------------- | ------------------- |
| `en`    | English            | yes       | yes              | yes — English       |
| `es`    | Spanish            | yes       | yes              | yes — Spanish       |
| `zh-CN` | Simplified Chinese | yes       | yes              | **no** — see below  |

These are the only three values `Locale` admits. `normalizeLocale()` in
`web/src/lib/locale.ts` reduces any incoming tag to one of them.

Traditional Chinese tags (`zh-Hant`, `zh-TW`, `zh-HK`, `zh-MO`) deliberately do
**not** collapse into `zh-CN`. This product renders Simplified Chinese; answering
a Traditional request with Simplified would promise a script we do not produce.
They fall back to English, which is at least honest.

## Where the translations live

```
web/src/i18n/
  index.ts            t(), interpolate(), tPlural(), missingKeys()
  messages/en.ts      the source of truth for the key set
  messages/es.ts      typed as `typeof en`, so the compiler enforces parity
  messages/zh-CN.ts   likewise
```

English is the source of truth for the *shape*: `Messages` is derived from
`en.ts`, so a key added there and nowhere else fails the build.

### Adding or changing a string

1. Add the key to `en.ts`, in the section comment for the file that uses it.
2. Add it to `es.ts` and `zh-CN.ts`. The compiler requires this.
3. Use it through `useTranslation()` in a component, or `t(messages[locale], key)`
   in a library module that has no React context.
4. Run `npx vitest run tests/unit/localization.test.ts`. It sweeps every key in
   every catalog and reports both absent keys and keys left identical to English
   — which is what an untranslated placeholder looks like once someone has copied
   `en.ts` over `es.ts` to quiet the compiler.

### Whole sentences, not fragments

A catalog entry is always a complete sentence. Values are substituted with
`{name}` placeholders through `interpolate()` (or `tv()` from the hook), never
by concatenation. Spanish and Chinese put the number, the noun and the verb in
different places, and a fragment gives the translator nowhere to move them.

Counted sentences use `tPlural()` (`tn()` from the hook) with `_one` / `_other`
keys. `pluralCategory()` is deliberately small — English and Spanish split one
from everything else, Chinese has a single form — and says so rather than
pretending to be CLDR. A language with dual or paucal forms needs a real
implementation; the parity tests make adding one loudly visible.

### Terminology

Held consistent across all three catalogs:

| English            | Spanish                   | Simplified Chinese |
| ------------------ | ------------------------- | ------------------ |
| household          | hogar                     | 家庭               |
| applicant          | solicitante               | 申请人             |
| county             | condado                   | 县                 |
| signature          | firma                     | 签名               |
| form               | formulario                | 表格               |
| draft              | borrador                  | 草稿               |
| Social Security Number | número de Seguro Social | 社会安全号码    |

Program names and portals stay proper nouns in every language: **CalFresh**,
**CalWORKs**, **Medi-Cal**, **BenefitsCal**, **Covered California**. Translating
one would send an applicant looking for something that does not exist. A test
asserts this.

## Fallback policy

`t()` is staged deliberately rather than uniform:

- **development / test** — throw. A missing key is a bug, and the loudest place
  to learn about it is the first render.
- **production** — fall back to the English string, then to the key. English is
  wrong for a Spanish reader but it is a real sentence; `intake_zip_code_prompt`
  is not, and a raw key tells an applicant nothing about their benefits.

The English fallback is a floor, not a licence. `missingKeys()` exists so that
floor is never quietly relied on.

## How the locale reaches the server

The applicant's choice is written to a cookie (`kbn-locale`) by
`language-context.tsx`. Server code reads it with `localeFromCookieHeader()`.

`Accept-Language` is **never** consulted at generation time. It is the machine's
opinion, not the applicant's — someone who switched to Spanish on a borrowed
English laptop gets Spanish, and gets it on the PDF and the guide too.

## PDF templates

`src/benefits_navigator/form_templates.py` maps a locale to an official CDSS
asset. `web/src/lib/locale.ts` performs the same normalization for the
TypeScript side, and a test asserts the two agree.

| Locale  | Template file                          | Revision | Official translation |
| ------- | -------------------------------------- | -------- | -------------------- |
| `en`    | `CA-SAWS-2-PLUS.pdf`                   | 4/15     | yes                  |
| `es`    | `CA-SAWS-2-PLUS-ES.pdf`                | 4/15     | yes                  |
| `zh-CN` | `CA-SAWS-2-PLUS.pdf` (English)         | 4/15     | **no**               |

Field mappings are verified separately per template — the field names are not
assumed to match across languages. For Spanish, all 276 destinations this
project writes exist on the Spanish form, on the same pages, with the same
checkbox on-state names.

### The Simplified Chinese limitation

CDSS publishes a Chinese SAWS 2 PLUS (`saws2plus_chinese.pdf`, kept here as
`CA-SAWS-2-PLUS-ZH-HANT-REFERENCE.pdf`) and it fails both things this product
needs from it:

1. It is **Traditional** Chinese, not Simplified. The CDSS Chinese forms index
   states the page's forms are Traditional unless noted, and the file confirms
   it (補充 / 醫療 / 殘障 / 計劃, where Simplified would be 补充 / 医疗 / 残障 /
   计划).
2. It has **zero AcroForm fields**. It is a flat, scan-style PDF — nothing can be
   written into it programmatically at all.

Neither is fixable without forging a state form, so we do not try. Simplified
Chinese applicants get a Simplified Chinese interface and guide, the **English**
official form, and a notice at the top of the guide saying so — because saying
nothing would send them hunting for Chinese labels that are not on the page.

`documentLanguageFor(locale)` is the single source of that decision, and
`hasOfficialTranslatedForm(locale)` is what surfaces it.

## What is still English

Deliberately, and for a reason in each case:

**Proper nouns.** `SAWS 2 PLUS`, `Medi-Cal`, `CalFresh`, `CalWORKs`,
`BenefitsCal`, `Covered California`. These are the names the applicant will see
on the county's website and on the printed form. Translating them would send
someone looking for a program that does not exist under that name.

**Server diagnostics.** When an API route returns an `error` string, the flow
shows a translated headline (`mkt_unavailable`, and the phase-tracker's error
banner) with that string beneath it as detail. The detail is not translated
because it does not come from our catalog — it is the upstream service's own
message. The applicant-facing line above it always is.

**Stored values and identifiers.** Record keys, enum values, AcroForm field
names, phase ids. Someone choosing "Cada dos semanas" stores `every_two_weeks`;
the boolean behind "Sí" is `true`. This is what lets a language switch
mid-application leave the answers alone — see
`tests/unit/language-switch-mid-flow.test.ts`.

**An unrecognised phase id.** `report-assembler.ts` carries English display
names. `report-view` resolves `phase_*` keys from the catalog first and uses
those names only for a phase id the catalog does not know, via `tOr` rather than
`t` — a phase id from workflow output is data, and throwing on it would blank
the report.

### The report body

The five phase sections are written by the workflow, not by the catalog. The
report route derives a `preferredLanguage` from the locale cookie and passes it
in, so the generated prose follows the applicant's language. For `zh-CN` it asks
for **Simplified Chinese** specifically — "Chinese" alone is ambiguous, and this
project cares about the difference (see the PDF note above).

The frame around that prose — headings, the bottom-line label, the expand and
collapse affordances, the screening statuses, the application call to action —
comes from the catalog and is covered by tests.

### Printed quotations

`printedSection` and `printedLabel` follow the **document** language, not the
interface language, because they quote what the paper in the applicant's hands
actually says. `web/src/lib/printed-labels.ts` holds the Spanish text extracted
from `forms/CA-SAWS-2-PLUS-ES.pdf` — extracted, not translated. Entries that
describe a region rather than quote a heading ("Signature block at the foot of
page 1") carry no `es` value, because the form prints no such words. For `zh-CN`
the document is the English form, so English quotations are correct there.

## Running the tests

```sh
cd web
npx vitest run tests/unit/localization.test.ts        # catalog parity + sweeps
npx vitest run tests/unit/guide-localization.test.ts  # guide frame per locale
npx vitest run tests/unit/guide-body-localization.test.ts
npx vitest run tests/unit/component-english-leaks.test.ts   # source leak sweep
npx vitest run tests/unit/instruction-keys.test.ts          # guide instructions
npx vitest run tests/unit/language-switch-mid-flow.test.ts  # state survives
npx vitest run                                        # everything

npx playwright test tests/e2e/language-switcher.spec.ts     # in a real browser

cd ..
PYTHONPATH=src python3 -m pytest tests/ -q            # template selection + PDF
```
