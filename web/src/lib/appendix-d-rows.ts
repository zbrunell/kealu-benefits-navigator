//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Deterministic assignment of Appendix D employment history to printed blocks.
 *
 * Appendix D is two printed pages of identical shape:
 *
 *   D-1 (PDF page 27) — "Person1": a NAME line, then "Job 1", "Job 2", "Job 3".
 *   D-2 (PDF page 28) — "Person 2": the same again.
 *
 * So the printed capacity is exactly two people and three jobs each. The page
 * itself says what to do when that is not enough: "If using the paper
 * application and you need more space, copy this page or use a separate piece of
 * paper." That instruction is the reason overflow is *reported* here rather than
 * truncated — an unplaced job is a real answer the applicant gave, and the
 * completion guide tells them where to write it.
 *
 * The assignment rules, stated once so no consumer has to infer them:
 *
 * 1. People are ordered by the household plan — the applicant first, then other
 *    household members in application-array order. Employment entries naming
 *    someone outside the household follow, in the order they first appear.
 * 2. Only people with at least one job entry take a printed person block. An
 *    adult with no work history does not consume Person1 and push a working
 *    adult onto the overflow sheet.
 * 3. Within a person, jobs keep their entry order and fill Job 1, 2, 3.
 * 4. Nothing is dropped. Everything past the printed capacity is returned as
 *    overflow, tagged with why it did not fit.
 *
 * Ordering therefore depends only on the household array's order and the entry
 * array's order — never on object iteration order, on which optional fields
 * happen to be filled, or on filtered-array indices.
 */

import { planHouseholdRows } from '@/lib/household-rows';
import { activeEntries } from '@/lib/saws2-question-planner';
import type { Saws2PlusApplicationData } from '@/types/application';
import {
  APPLICANT_MEMBER_ID,
  type EmploymentHistoryEntry,
} from '@/types/saws-questionnaire';

/** Printed person blocks: "Person1" on D-1, "Person 2" on D-2. */
export const APPENDIX_D_PERSON_BLOCKS = 2;

/** Printed "Job n" blocks inside each person block. */
export const APPENDIX_D_JOBS_PER_PERSON = 3;

export interface AppendixDJobAssignment {
  /** Index into the active employment-history entries, for stable identity. */
  entryIndex: number;
  entry: EmploymentHistoryEntry;
  /** Zero-based printed person block, 0 = "Person1" on D-1. */
  personBlock: number;
  /** Zero-based printed job block, 0 = "Job 1". */
  jobSlot: number;
}

export interface AppendixDPersonAssignment {
  memberId: string;
  /** The person's printed name, or '' when the household has no name yet. */
  personName: string;
  personBlock: number;
  jobs: AppendixDJobAssignment[];
  /** Jobs this person has beyond the three printed blocks. */
  overflowJobs: OverflowJob[];
}

export interface OverflowJob {
  entryIndex: number;
  entry: EmploymentHistoryEntry;
  memberId: string;
  personName: string;
  /** Which printed limit this job ran past. */
  reason: 'person_blocks_exhausted' | 'job_blocks_exhausted';
}

export interface AppendixDRowPlan {
  /** People who fit on the printed pages, in printed order. */
  persons: AppendixDPersonAssignment[];
  /** Every job that did not fit, in a stable order. */
  overflow: OverflowJob[];
  /** People with work history who had no printed block left. */
  overflowPersonCount: number;
}

/** People in printed order: applicant first, then members in array order. */
function householdOrder(
  application: Saws2PlusApplicationData,
): Array<{ memberId: string; name: string }> {
  const plan = planHouseholdRows(application);

  return plan.all.map((assignment) => {
    if (assignment.isApplicant) {
      const { firstName, lastName } = application.applicant;

      return {
        memberId: APPLICANT_MEMBER_ID,
        name: `${firstName} ${lastName}`.trim(),
      };
    }

    const member = application.householdMembers[assignment.memberIndex!];

    return {
      memberId: member.id,
      name: `${member.firstName} ${member.lastName}`.trim(),
    };
  });
}

/**
 * Assign every employment-history entry to a printed Appendix D block.
 *
 * Pure: same application, same plan.
 */
export function planAppendixDRows(
  application: Saws2PlusApplicationData,
): AppendixDRowPlan {
  const entries = activeEntries<EmploymentHistoryEntry>(
    application.questionnaire.appendices?.employmentHistory,
  );

  // Group jobs by person, preserving entry order inside each group.
  const jobsByMember = new Map<string, Array<{ index: number; entry: EmploymentHistoryEntry }>>();

  entries.forEach((entry, index) => {
    const memberId = entry.memberId || APPLICANT_MEMBER_ID;
    const existing = jobsByMember.get(memberId);

    if (existing) existing.push({ index, entry });
    else jobsByMember.set(memberId, [{ index, entry }]);
  });

  /*
   * Household order first, then anyone the entries name who is not in the
   * household. `jobsByMember` keeps insertion order, which is entry order, so
   * the remainder is deterministic too.
   */
  const known = householdOrder(application);
  const knownIds = new Set(known.map((person) => person.memberId));

  const ordered = [
    ...known.filter((person) => jobsByMember.has(person.memberId)),
    ...[...jobsByMember.keys()]
      .filter((memberId) => !knownIds.has(memberId))
      .map((memberId) => ({ memberId, name: '' })),
  ];

  const persons: AppendixDPersonAssignment[] = [];
  const overflow: OverflowJob[] = [];
  let overflowPersonCount = 0;

  for (const person of ordered) {
    const jobs = jobsByMember.get(person.memberId) ?? [];

    if (persons.length >= APPENDIX_D_PERSON_BLOCKS) {
      overflowPersonCount += 1;

      for (const job of jobs) {
        overflow.push({
          entryIndex: job.index,
          entry: job.entry,
          memberId: person.memberId,
          personName: person.name,
          reason: 'person_blocks_exhausted',
        });
      }

      continue;
    }

    const personBlock = persons.length;
    const placed: AppendixDJobAssignment[] = [];
    const personOverflow: OverflowJob[] = [];

    jobs.forEach((job, jobSlot) => {
      if (jobSlot < APPENDIX_D_JOBS_PER_PERSON) {
        placed.push({
          entryIndex: job.index,
          entry: job.entry,
          personBlock,
          jobSlot,
        });

        return;
      }

      personOverflow.push({
        entryIndex: job.index,
        entry: job.entry,
        memberId: person.memberId,
        personName: person.name,
        reason: 'job_blocks_exhausted',
      });
    });

    persons.push({
      memberId: person.memberId,
      personName: person.name,
      personBlock,
      jobs: placed,
      overflowJobs: personOverflow,
    });

    overflow.push(...personOverflow);
  }

  return { persons, overflow, overflowPersonCount };
}
