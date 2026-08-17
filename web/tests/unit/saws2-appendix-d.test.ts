import { describe, expect, it } from 'vitest';
import {
  APPENDIX_D_JOBS_PER_PERSON,
  APPENDIX_D_PERSON_BLOCKS,
  planAppendixDRows,
} from '@/lib/appendix-d-rows';
import { buildApplicationFieldPlan } from '@/lib/application-mapper';
import { buildInventory } from '@/lib/saws2-inventory';
import {
  appendixDApplies,
  getActiveAppendices,
  getRequiredApplicationQuestions,
  writePath,
} from '@/lib/saws2-question-planner';
import {
  EMPTY_APPLICATION_DATA,
  type HouseholdMember,
  type Saws2PlusApplicationData,
} from '@/types/application';

function member(id: string, firstName: string): HouseholdMember {
  return {
    ...EMPTY_APPLICATION_DATA.householdMembers[0],
    id,
    firstName,
    lastName: 'Reyes',
    dateOfBirth: '1988-05-04',
    age: 37,
    relationshipToApplicant: 'spouse',
  } as HouseholdMember;
}

/*
 * The printed page states the scope: "If you are applying for cash aid and have
 * two or more adults in the home who are applying for aid". So the default seed
 * carries a second adult; the tests that check the boundary pass [] explicitly.
 */
function seed(
  members: HouseholdMember[] = [member('spouse', 'Luis')],
): Saws2PlusApplicationData {
  return {
    ...EMPTY_APPLICATION_DATA,
    selectedPrograms: ['calworks'],
    applicant: {
      ...EMPTY_APPLICATION_DATA.applicant,
      firstName: 'Maria',
      lastName: 'Delgado',
      dateOfBirth: '1990-01-01',
    },
    householdMembers: members,
  };
}

const w = (d: Saws2PlusApplicationData, p: string, v: unknown) => ({
  ...d,
  questionnaire: writePath(d.questionnaire, p, v),
});

const ids = (d: Saws2PlusApplicationData) =>
  new Set(getRequiredApplicationQuestions(d).outstanding.map((q) => q.id));

const plan = (d: Saws2PlusApplicationData) => buildApplicationFieldPlan(d, {});
const val = (d: Saws2PlusApplicationData, k: string) =>
  plan(d).find((e) => e.key === k)?.value;
const keys = (d: Saws2PlusApplicationData) => plan(d).map((e) => e.key);

function job(over: Record<string, unknown> = {}) {
  return {
    id: `j${Math.random()}`,
    memberId: 'applicant',
    employerName: 'Bright Star Cafe',
    employerAddress: '12 Oak St, Fresno CA',
    jobTitle: 'Cook',
    startDate: '03/2024',
    endDate: '11/2025',
    reasonForLeaving: 'Hours were cut',
    ...over,
  };
}

function withJobs(
  d: Saws2PlusApplicationData,
  entries: Array<Record<string, unknown>>,
) {
  const x = w(d, 'appendices.employmentHistory.answer', true);
  return w(x, 'appendices.employmentHistory.entries', entries);
}

// ---------------------------------------------------------------------------
// Applicability
// ---------------------------------------------------------------------------

describe('Appendix D applicability', () => {
  it('does not apply without cash aid', () => {
    expect(appendixDApplies({ ...seed(), selectedPrograms: ['medi_cal'] })).toBe(
      false,
    );
  });

  it('does not apply to a cash-aid household with only one adult', () => {
    expect(appendixDApplies(seed([]))).toBe(false);
  });

  it('applies for cash aid with two or more adults', () => {
    expect(appendixDApplies(seed())).toBe(true);
  });

  it('uses one definition shared with the appendix list', () => {
    expect(getActiveAppendices(seed()).map((a) => a.id)).toContain('D');
  });

  it('asks for job records once the gateway is a Yes', () => {
    const d = w(seed(), 'appendices.employmentHistory.answer', true);
    expect(ids(d).has('appendices.employment_history.records')).toBe(true);
  });

  it('asks nothing further when the gateway is a No', () => {
    const d = w(seed(), 'appendices.employmentHistory.answer', false);
    expect(ids(d).has('appendices.employment_history.records')).toBe(false);
  });

  it('asks the per-job questions the printed block prints', () => {
    const d = withJobs(seed(), [job()]);
    const outstanding = ids(d);

    expect(outstanding.has('appendices.employment_history.0.selfEmployed')).toBe(
      true,
    );
    expect(
      outstanding.has('appendices.employment_history.0.countyHelpedGetJob'),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Deterministic row assignment
// ---------------------------------------------------------------------------

describe('planAppendixDRows', () => {
  it('places nobody when there is no employment history', () => {
    const result = planAppendixDRows(seed());

    expect(result.persons).toEqual([]);
    expect(result.overflow).toEqual([]);
    expect(result.overflowPersonCount).toBe(0);
  });

  it('gives the applicant the first printed person block', () => {
    const d = withJobs(seed([member('m1', 'Luis')]), [
      job({ memberId: 'm1', employerName: 'Delta Packing' }),
      job({ memberId: 'applicant' }),
    ]);

    const result = planAppendixDRows(d);

    expect(result.persons.map((p) => p.memberId)).toEqual(['applicant', 'm1']);
    expect(result.persons[0].personBlock).toBe(0);
    expect(result.persons[1].personBlock).toBe(1);
  });

  it('does not let an adult with no work history consume a person block', () => {
    const d = withJobs(seed([member('m1', 'Luis')]), [
      job({ memberId: 'm1', employerName: 'Delta Packing' }),
    ]);

    expect(planAppendixDRows(d).persons.map((p) => p.memberId)).toEqual(['m1']);
  });

  it('fills a person’s job blocks in entry order', () => {
    const d = withJobs(seed(), [
      job({ employerName: 'First' }),
      job({ employerName: 'Second' }),
      job({ employerName: 'Third' }),
    ]);

    const jobs = planAppendixDRows(d).persons[0].jobs;

    expect(jobs.map((j) => j.jobSlot)).toEqual([0, 1, 2]);
    expect(jobs.map((j) => j.entry.employerName)).toEqual([
      'First',
      'Second',
      'Third',
    ]);
  });

  it('fills exactly to capacity without reporting overflow', () => {
    const d = withJobs(seed([member('m1', 'Luis')]), [
      ...Array.from({ length: APPENDIX_D_JOBS_PER_PERSON }, (_, i) =>
        job({ employerName: `A${i}` }),
      ),
      ...Array.from({ length: APPENDIX_D_JOBS_PER_PERSON }, (_, i) =>
        job({ memberId: 'm1', employerName: `B${i}` }),
      ),
    ]);

    const result = planAppendixDRows(d);

    expect(result.persons).toHaveLength(APPENDIX_D_PERSON_BLOCKS);
    expect(result.overflow).toEqual([]);
  });

  it('reports a fourth job as overflow instead of dropping it', () => {
    const d = withJobs(seed(), [
      job({ employerName: 'First' }),
      job({ employerName: 'Second' }),
      job({ employerName: 'Third' }),
      job({ employerName: 'Fourth' }),
    ]);

    const result = planAppendixDRows(d);

    expect(result.persons[0].jobs).toHaveLength(APPENDIX_D_JOBS_PER_PERSON);
    expect(result.overflow).toHaveLength(1);
    expect(result.overflow[0].entry.employerName).toBe('Fourth');
    expect(result.overflow[0].reason).toBe('job_blocks_exhausted');
  });

  it('reports a third working person as overflow instead of dropping them', () => {
    const d = withJobs(seed([member('m1', 'Luis'), member('m2', 'Nia')]), [
      job(),
      job({ memberId: 'm1', employerName: 'Delta Packing' }),
      job({ memberId: 'm2', employerName: 'Rio Landscaping' }),
    ]);

    const result = planAppendixDRows(d);

    expect(result.persons).toHaveLength(APPENDIX_D_PERSON_BLOCKS);
    expect(result.overflowPersonCount).toBe(1);
    expect(result.overflow.map((o) => o.entry.employerName)).toEqual([
      'Rio Landscaping',
    ]);
    expect(result.overflow[0].reason).toBe('person_blocks_exhausted');
  });

  it('is deterministic: the same application always yields the same plan', () => {
    const d = withJobs(seed([member('m1', 'Luis'), member('m2', 'Nia')]), [
      job({ memberId: 'm2', employerName: 'Rio' }),
      job({ memberId: 'applicant' }),
      job({ memberId: 'm1', employerName: 'Delta' }),
      job({ memberId: 'applicant', employerName: 'Second applicant job' }),
    ]);

    const first = JSON.stringify(planAppendixDRows(d));

    for (let i = 0; i < 5; i += 1) {
      expect(JSON.stringify(planAppendixDRows(d))).toBe(first);
    }
  });

  it('keeps duplicate-looking jobs as separate records', () => {
    const d = withJobs(seed(), [job(), job()]);
    const jobs = planAppendixDRows(d).persons[0].jobs;

    expect(jobs).toHaveLength(2);
    expect(jobs[0].entryIndex).toBe(0);
    expect(jobs[1].entryIndex).toBe(1);
  });

  it('places a job naming someone outside the household after the household', () => {
    const d = withJobs(seed(), [
      job({ memberId: 'stranger', employerName: 'Outside' }),
      job({ memberId: 'applicant' }),
    ]);

    expect(planAppendixDRows(d).persons.map((p) => p.memberId)).toEqual([
      'applicant',
      'stranger',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

describe('Appendix D mapping', () => {
  it('joins the employer name and address into the one printed line', () => {
    const d = withJobs(seed(), [job()]);

    expect(val(d, 'appendices.employment.0.job.0.employer')).toBe(
      'Bright Star Cafe, 12 Oak St, Fresno CA',
    );
  });

  it('emits the printed person name and the job detail', () => {
    const d = withJobs(seed(), [
      job({
        hoursWorkedFrequency: 'weekly',
        payAmount: 18.5,
        payRateFrequency: 'hourly',
        selfEmployed: false,
        countyHelpedGetJob: false,
      }),
    ]);

    expect(val(d, 'appendices.employment.0.person_name')).toBe('Maria Delgado');
    expect(val(d, 'appendices.employment.0.job.0.worked_from')).toBe('03/2024');
    expect(val(d, 'appendices.employment.0.job.0.worked_to')).toBe('11/2025');
    expect(val(d, 'appendices.employment.0.job.0.reason_for_leaving')).toBe(
      'Hours were cut',
    );
    expect(val(d, 'appendices.employment.0.job.0.hours_frequency')).toBe('weekly');
    expect(val(d, 'appendices.employment.0.job.0.pay_amount')).toBe(18.5);
    expect(val(d, 'appendices.employment.0.job.0.pay_frequency')).toBe('hourly');
    expect(val(d, 'appendices.employment.0.job.0.self_employed')).toBe(false);
    expect(val(d, 'appendices.employment.0.job.0.county_helped')).toBe(false);
  });

  it('writes nothing at all when cash aid was not requested', () => {
    const d = withJobs({ ...seed(), selectedPrograms: ['medi_cal'] }, [job()]);

    expect(
      keys(d).some((k) => k.startsWith('appendices.employment.')),
    ).toBe(false);
  });

  it('never emits a key for a job that overflowed the printed page', () => {
    const d = withJobs(seed(), [
      job({ employerName: 'First' }),
      job({ employerName: 'Second' }),
      job({ employerName: 'Third' }),
      job({ employerName: 'Fourth' }),
    ]);

    expect(val(d, 'appendices.employment.0.job.2.employer')).toContain('Third');
    expect(
      keys(d).some((k) => k.startsWith('appendices.employment.0.job.3.')),
    ).toBe(false);
  });

  it('answers the per-block Native American question from a No on Q3', () => {
    const d = w(withJobs(seed(), [job()]), 'health.americanIndianOrAlaskaNative', false);

    expect(val(d, 'appendices.employment.0.job.0.native_american')).toBe(false);
    expect(val(d, 'appendices.employment.0.job.0.tribe_name')).toBeUndefined();
  });

  it('answers it Yes for a person Appendix B enumerates, with their tribe', () => {
    let d = w(withJobs(seed(), [job()]), 'health.americanIndianOrAlaskaNative', true);
    d = w(d, 'appendices.tribalMembership.answer', true);
    d = w(d, 'appendices.tribalMembership.entries', [
      {
        id: 't1',
        memberId: 'applicant',
        memberOfFederallyRecognizedTribe: true,
        tribeName: 'Yurok',
        tribalIncomeFrequency: '',
      },
    ]);

    expect(val(d, 'appendices.employment.0.job.0.native_american')).toBe(true);
    expect(val(d, 'appendices.employment.0.job.0.tribe_name')).toBe('Yurok');
  });

  it('leaves it blank when Q3 is Yes but this person is not enumerated', () => {
    const d = w(withJobs(seed(), [job()]), 'health.americanIndianOrAlaskaNative', true);

    expect(
      val(d, 'appendices.employment.0.job.0.native_american'),
    ).toBeUndefined();
  });

  it('repeats the person answer across every one of that person’s job blocks', () => {
    const d = w(
      withJobs(seed(), [job({ employerName: 'A' }), job({ employerName: 'B' })]),
      'health.americanIndianOrAlaskaNative',
      false,
    );

    expect(val(d, 'appendices.employment.0.job.0.native_american')).toBe(false);
    expect(val(d, 'appendices.employment.0.job.1.native_american')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

describe('Appendix D inventory', () => {
  it('is reported as collected and mapped', () => {
    const entry = buildInventory().find((e) => e.saws === 'Appendix D');

    expect(entry?.status).toBe('collected_and_mapped');
  });

  it('records the printed page Appendix D-1 sits on', () => {
    expect(buildInventory().find((e) => e.saws === 'Appendix D')?.page).toBe(27);
  });

  it('records Appendix E’s real page, which is 29 not 28', () => {
    expect(buildInventory().find((e) => e.saws === 'Appendix E')?.page).toBe(29);
  });
});
