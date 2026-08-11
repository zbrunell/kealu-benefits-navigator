//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Household composition — the single source of truth for household size.
 *
 * Household size is never asked for directly. It is derived, in this order of
 * authority:
 *
 * 1. The structured household entered in the SAWS 2 PLUS application: the
 *    primary applicant plus every household member row. This stays correct
 *    automatically as rows are added, removed, or edited because it is computed
 *    from the rows rather than stored alongside them.
 * 2. The free-text household answer from intake ("Two adults, ages 32 and 30,
 *    and two children, ages 4 and 8"), parsed here. This is what the report and
 *    eligibility screening use, since it is all that exists before the
 *    application flow starts.
 *
 * Both readings feed the same downstream consumers — report prefill, eligibility
 * screening, the demo/E2E fixture, and the canonical SAWS field plan — so no
 * consumer keeps its own copy or its own parser.
 */

import type { HouseholdMemberPrefill } from '@/types/application';

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

/** Determiners that imply a single person ("my son") or an unstated count ("my kids"). */
const DETERMINERS = new Set(['a', 'an', 'the', 'my', 'our', 'his', 'her', 'their', 'another']);

/** Age at which a person is counted as an adult rather than a child. */
const ADULT_AGE = 18;

/** Oldest age accepted from free text; anything larger is not an age. */
const MAX_AGE = 120;

/** Largest person count accepted from free text. */
const MAX_COUNT = 20;

const CHILD_NOUNS =
  'children|child|kids|kid|sons|son|daughters|daughter|babies|baby|infants|infant|' +
  'toddlers|toddler|stepchildren|stepchild|grandchildren|grandchild|newborns|newborn';

const ADULT_NOUNS =
  'adults|adult|people|persons|grownups|grownup|parents|parent|' +
  'grandparents|grandparent|roommates|roommate';

const SPOUSE_NOUNS = 'spouse|wife|husband|partner';

/** Role of a person in the household. Exactly one person is the applicant. */
export type HouseholdRole = 'applicant' | 'adult' | 'child';

/** One person named or implied by the household answer. */
export interface HouseholdPerson {
  role: HouseholdRole;
  /** Age when the answer stated one for this person. */
  age?: number;
  /** The noun the answer used ("kid", "spouse"), when it used one. */
  described?: string;
}

/** Structured reading of the free-text `household_profile` intake answer. */
export interface HouseholdComposition {
  /** Total household size (never below 1). */
  size: number;
  /** The applicant plus any other adults. */
  adults: number;
  children: number;
  /** Ages stated in the answer, in the order the people appear. */
  ages: number[];
  /**
   * Every person the answer accounts for, in stated order, including the
   * applicant. Downstream consumers derive size and member rows from this so an
   * age is always attributed to a specific person.
   */
  people: HouseholdPerson[];
  pregnant: boolean;
  disability: boolean;
  veteran: boolean;
  /** True when any stated age is 65 or older. */
  senior: boolean;
}

/**
 * Normalize the phrasings people actually type so one set of patterns covers
 * them: lowercase, straight quotes, and every "6-year-old" / "6 yo" / "6 yrs
 * old" variant rewritten to the canonical "6 year old".
 */
function normalizeProfile(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/(\d)\s*-?\s*(?:years?|yrs?)\s*-?\s*old/g, '$1 year old')
    .replace(/(\d)\s*(?:y\/o|y\.o\.|yo)\b/g, '$1 year old')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parse a count token ("2", "two", "a") into a number, or null. */
function parseCount(token: string | undefined): number | null {
  if (!token) return null;

  const normalized = token.toLowerCase();
  if (DETERMINERS.has(normalized)) return null;

  const value = NUMBER_WORDS[normalized] ?? Number(normalized);

  return Number.isFinite(value) && value >= 1 && value <= MAX_COUNT ? value : null;
}

function isAge(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= MAX_AGE;
}

/** Role implied by an age alone. */
function roleForAge(age: number): 'adult' | 'child' {
  return age < ADULT_AGE ? 'child' : 'adult';
}

/**
 * A group of people described by one phrase — "two children", "my spouse",
 * "a 6 year old", "me".
 */
interface PersonGroup {
  /** Character offset of the phrase, used to attach nearby age lists. */
  index: number;
  role: HouseholdRole | 'unknown';
  count: number;
  /** Ages already attached to this group, one per person. */
  ages: number[];
  /** True when a plural noun gave no explicit count ("my kids"). */
  countIsAssumed: boolean;
  described?: string;
}

/** An "ages 4 and 8" / "age 6" phrase awaiting attachment to a group. */
interface AgeList {
  index: number;
  ages: number[];
}

const AGE_LIST_PATTERN = /\bage(?:s|d)?\s+(\d{1,3}(?:\s*(?:,|and|&|\/)\s*\d{1,3})*)/g;

/**
 * Ordered scan for the ways a household answer names a person.
 *
 * Alternatives are ordered so that a noun phrase carrying an age ("a 6 year old
 * child") is consumed as one person rather than as an age plus a noun.
 */
const MENTION_PATTERN = new RegExp(
  [
    // The applicant describing their own role — "I am the parent", "I'm a
    // grandparent". The noun describes the applicant, so it must not also be
    // counted as another adult.
    `(?<selfRole>\\b(?:i\\s+am|i'm)\\s+(?:a|an|the)?\\s*(?:\\w+\\s+){0,2}?` +
      `(?:${SPOUSE_NOUNS}|${ADULT_NOUNS})\\b)`,
    // The applicant referring to themselves.
    `(?<self>\\b(?:just\\s+)?(?:me|myself|i\\s+am|i'm|i)\\b)`,
    // A lone-parent phrase: the applicant, stated as a role.
    `(?<lone>\\bsingle\\s+(?:parent|mother|father|mom|dad|guardian)\\b)`,
    // A spouse or partner: one other adult.
    `(?<spouse>\\b(?:my\\s+)?(?:${SPOUSE_NOUNS})\\b)`,
    // A counted and/or aged noun phrase: "two children", "a 6 year old child".
    `(?<group>\\b(?:(?<count>\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|` +
      `a|an|the|my|our|his|her|their|another)\\s+)?` +
      `(?:(?<groupAge>\\d{1,3})\\s+year\\s+old\\s+)?(?<noun>${CHILD_NOUNS}|${ADULT_NOUNS})\\b)`,
    // A person identified only by age: "my 6 year old".
    `(?<aged>\\b(?:my|our|a|an|the|his|her|their)?\\s*(?<agedAge>\\d{1,3})\\s+year\\s+old\\b)`,
  ].join('|'),
  'gi',
);

/** Replace each match with spaces so later scans keep the original offsets. */
function maskRange(text: string, start: number, length: number): string {
  return text.slice(0, start) + ' '.repeat(length) + text.slice(start + length);
}

/** Extract "age(s) N …" phrases, masking them so they are not read as counts. */
function extractAgeLists(text: string): { masked: string; ageLists: AgeList[] } {
  const ageLists: AgeList[] = [];
  let masked = text;

  for (const match of text.matchAll(AGE_LIST_PATTERN)) {
    const ages: number[] = [];

    for (const raw of match[1].matchAll(/\d{1,3}/g)) {
      const age = Number(raw[0]);
      if (isAge(age)) ages.push(age);
    }

    if (ages.length > 0 && match.index !== undefined) {
      ageLists.push({ index: match.index, ages });
      masked = maskRange(masked, match.index, match[0].length);
    }
  }

  return { masked, ageLists };
}

/** Scan the masked text for person groups, in the order they are written. */
function extractPersonGroups(masked: string): PersonGroup[] {
  const groups: PersonGroup[] = [];
  let sawSelf = false;

  for (const match of masked.matchAll(MENTION_PATTERN)) {
    const captures = match.groups ?? {};
    const index = match.index ?? 0;

    // "me", "myself", "I", "I am the parent", "single mother" — the applicant,
    // counted once no matter how often the answer refers to themselves.
    if (captures.self || captures.lone || captures.selfRole) {
      if (sawSelf) continue;
      sawSelf = true;
      groups.push({
        index,
        role: 'applicant',
        count: 1,
        ages: [],
        countIsAssumed: false,
      });
      continue;
    }

    if (captures.spouse) {
      groups.push({
        index,
        role: 'adult',
        count: 1,
        ages: [],
        countIsAssumed: false,
        described: captures.spouse.replace(/^my\s+/, ''),
      });
      continue;
    }

    if (captures.noun) {
      const noun = captures.noun.toLowerCase();
      const isChildNoun = new RegExp(`^(?:${CHILD_NOUNS})$`).test(noun);
      const isPlural = noun.endsWith('s') && !noun.endsWith('ss');
      const explicitCount = parseCount(captures.count);
      const groupAge = captures.groupAge ? Number(captures.groupAge) : undefined;

      // An age attached to the noun ("a 6 year old child") settles the role
      // even when the noun itself is ambiguous.
      const role: HouseholdRole | 'unknown' = isChildNoun
        ? 'child'
        : groupAge !== undefined
          ? roleForAge(groupAge)
          : /^(?:people|persons)$/.test(noun)
            ? 'unknown'
            : 'adult';

      groups.push({
        index,
        role,
        // A plural noun means at least two people; an explicit count wins, and
        // an age list attached later can correct an assumed count.
        count: explicitCount ?? (isPlural ? 2 : 1),
        ages: groupAge !== undefined && isAge(groupAge) ? [groupAge] : [],
        countIsAssumed: explicitCount === null && isPlural,
        described: noun,
      });
      continue;
    }

    if (captures.agedAge) {
      const age = Number(captures.agedAge);
      if (!isAge(age)) continue;

      groups.push({
        index,
        role: roleForAge(age),
        count: 1,
        ages: [age],
        countIsAssumed: false,
      });
    }
  }

  return groups;
}

/**
 * Attach each "ages …" phrase to the group it describes: the nearest preceding
 * group still missing ages, else the nearest following one.
 */
function attachAgeLists(groups: PersonGroup[], ageLists: AgeList[]): void {
  for (const ageList of ageLists) {
    const needsAges = (group: PersonGroup) => group.ages.length === 0;

    const preceding = groups
      .filter((group) => group.index < ageList.index && needsAges(group))
      .pop();

    const target =
      preceding ?? groups.find((group) => group.index > ageList.index && needsAges(group));

    if (!target) continue;

    // A plural noun with no stated count is settled by how many ages follow it:
    // "my kids, ages 4, 8 and 12" is three children.
    if (target.countIsAssumed) {
      target.count = ageList.ages.length;
      target.countIsAssumed = false;
    }

    target.ages = ageList.ages.slice(0, target.count);
  }
}

/** Flatten groups into one person per human, preserving stated order. */
function flattenGroups(groups: PersonGroup[]): HouseholdPerson[] {
  const people: HouseholdPerson[] = [];

  for (const group of groups) {
    for (let i = 0; i < group.count; i += 1) {
      const age = group.ages[i];

      people.push({
        // "people"/"persons" says nothing about who is a child.
        role: group.role === 'unknown' ? 'adult' : group.role,
        ...(age !== undefined ? { age } : {}),
        ...(group.described ? { described: group.described } : {}),
      });
    }
  }

  return people;
}

/**
 * Ensure exactly one person is the applicant.
 *
 * The applicant always counts as one household member. When the answer names
 * them ("me", "single parent") that mention is the applicant; when it only
 * counts adults ("two adults") the first adult is the applicant rather than an
 * extra person; when it names nobody who could be the applicant ("my 6 year
 * old") the applicant is added.
 */
function ensureApplicant(people: HouseholdPerson[]): HouseholdPerson[] {
  if (people.some((person) => person.role === 'applicant')) return people;

  const firstAdultIndex = people.findIndex((person) => person.role === 'adult');

  if (firstAdultIndex !== -1) {
    const promoted = [...people];
    promoted[firstAdultIndex] = { ...promoted[firstAdultIndex], role: 'applicant' };
    return promoted;
  }

  return [{ role: 'applicant' }, ...people];
}

/**
 * Assign a bare trailing number list as ages, positionally.
 *
 * Covers "just me, 20" and "me and my son, 34 and 7", where the answer gives
 * ages without the word "age". Only consulted when no ages were found any other
 * way, so a count like "2 kids" is never mistaken for an age.
 */
function applyTrailingAges(people: HouseholdPerson[], masked: string): void {
  const trailing = masked.match(/(?:^|[,\s])\d{1,3}(?:\s*(?:,|and|&)\s*\d{1,3})*\s*[.!]?$/);
  if (!trailing) return;

  const ages: number[] = [];
  for (const raw of trailing[0].matchAll(/\d{1,3}/g)) {
    const age = Number(raw[0]);
    if (isAge(age)) ages.push(age);
  }

  ages.slice(0, people.length).forEach((age, i) => {
    people[i].age = age;
  });
}

/**
 * Parse the natural-language household answer into people, counts, and flags.
 *
 * Unstated details stay unstated — nothing is invented beyond the applicant,
 * who is always part of their own household.
 */
export function parseHouseholdComposition(
  profile: string | undefined,
): HouseholdComposition {
  const raw = (profile ?? '').trim();
  const text = normalizeProfile(raw);

  const { masked, ageLists } = extractAgeLists(text);
  const groups = extractPersonGroups(masked);

  attachAgeLists(groups, ageLists);

  const people = ensureApplicant(flattenGroups(groups));

  if (people.every((person) => person.age === undefined)) {
    applyTrailingAges(people, masked);
  }

  const ages = people
    .map((person) => person.age)
    .filter((age): age is number => age !== undefined);

  return {
    size: Math.max(1, people.length),
    adults: people.filter((person) => person.role !== 'child').length,
    children: people.filter((person) => person.role === 'child').length,
    ages,
    people,
    pregnant: /\bpregnan\w*|expecting\b/i.test(text),
    disability: /\bdisab\w*|ssi\b|blind\b/i.test(text),
    veteran: /\bveteran|military|va\b/i.test(text),
    senior: ages.some((age) => age >= 65),
  };
}

/**
 * Household size for a structured application: the primary applicant plus every
 * additional member row.
 *
 * Derived on read, so adding, removing, or editing member rows keeps the size
 * correct with no separate field to synchronize.
 */
export function householdSizeFromMembers(memberCount: number): number {
  const members = Number.isFinite(memberCount) ? Math.max(0, Math.floor(memberCount)) : 0;
  return members + 1;
}

/**
 * Build the additional-member prefill rows implied by the intake answer.
 *
 * One row per household member other than the applicant, carrying the age the
 * answer gave for that specific person — the parser tracks people individually,
 * so an age is never mapped onto the wrong row. A person the answer gave no age
 * for simply has no age. Names and dates of birth are never invented; the
 * applicant fills those in.
 */
export function buildHouseholdMemberPrefill(
  composition: HouseholdComposition,
): HouseholdMemberPrefill[] {
  const others = composition.people.filter((person) => person.role !== 'applicant');

  return others.map((person) => (person.age !== undefined ? { age: person.age } : {}));
}
