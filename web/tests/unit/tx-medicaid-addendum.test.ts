/**
 * Texas's Medicaid / CHIP addendum in the intake: asked only when it applies,
 * and emitted only for a household applying for Medicaid or CHIP.
 *
 * The baseline these tests protect is everything that was there before: a
 * household applying for food benefits alone sees no new question and its
 * field plan carries no new key, and a California application is untouched
 * whatever its data holds.
 */
import { describe, expect, it } from 'vitest';

import { buildApplicationFieldPlan } from '@/lib/application-mapper';
import {
  askedQuestions,
  isAsked,
  questionById,
  sectionIsAsked,
  validateIntakeForm,
} from '@/lib/form-intake/model';
import {
  TAX_PERSON_SLOTS,
  TX_EMPLOYER_COVERAGE,
  TX_H1010_INTAKE,
  TX_HTW_OPT_OUTS,
  TX_QUESTION_IDS as Q,
  TX_SECTIONS,
  TX_TRIBAL_MEMBERS,
  taxSectionId,
  writeMemberDetail,
} from '@/lib/form-intake/tx-h1010';
import { needsSpouseName, rosterSpouseName } from '@/lib/medicaid-addendum';
import {
  EMPTY_APPLICATION_DATA,
  type HouseholdMember,
  type Saws2PlusApplicationData,
} from '@/types/application';
import type {
  EmployerCoverageEntry,
  TribalMembershipEntry,
} from '@/types/saws-questionnaire';

type Data = Saws2PlusApplicationData;

/** The sections the Medicaid addendum added, by id. */
const ADDENDUM_SECTIONS = [
  ...Array.from({ length: TAX_PERSON_SLOTS }, (_, slot) => taxSectionId(slot)),
  TX_SECTIONS.deductions,
  TX_SECTIONS.incomeTotals,
  TX_SECTIONS.jobCoverage,
  TX_SECTIONS.healthChildren,
  TX_SECTIONS.healthPeople,
  TX_SECTIONS.htw,
  TX_SECTIONS.healthFinal,
  TX_SECTIONS.assister,
];

function member(
  id: string,
  firstName: string,
  dateOfBirth: string,
  relationship: string,
  sex: 'male' | 'female',
): HouseholdMember {
  return writeMemberDetail(
    {
      id,
      firstName,
      middleName: '',
      lastName: 'Rodríguez',
      dateOfBirth,
      relationshipToApplicant: relationship,
      adultDetails: { applyingFor: [] },
      childDetails: { applyingFor: [], placeOfBirth: '', parentStatus: {} },
    },
    'sex',
    sex,
  );
}

function household(programs: Data['selectedPrograms']): Data {
  const data = structuredClone(EMPTY_APPLICATION_DATA);

  return {
    ...data,
    selectedPrograms: programs,
    applicant: {
      ...data.applicant,
      firstName: 'María',
      lastName: 'Rodríguez',
      dateOfBirth: '1990-04-02',
      householdDetails: {
        ...data.applicant.householdDetails,
        sex: 'female',
        maritalStatus: 'married',
      },
    },
    householdMembers: [
      member('spouse', 'Diego', '1988-01-10', 'spouse', 'male'),
      member('child', 'Mateo', '2016-06-01', 'son', 'male'),
    ],
  };
}

/** Every answer the addendum can hold, so a plan built from it is full. */
function withEveryAddendumAnswer(data: Data): Data {
  return {
    ...data,
    medicaidAddendum: {
      taxReturns: {
        applicant: {
          plansToFile: true,
          filesJointly: true,
          fearsHarmFromDisclosure: false,
          claimsDependents: true,
          dependentNames: 'Mateo Rodríguez',
          claimedAsDependent: false,
        },
      },
      hasTaxDeductions: true,
      paysAlimony: true,
      alimonyAmount: 450,
      alimonyFrequency: 'Monthly',
      childTravelsWithMigrantWorker: false,
      fosterCareAt18OrOlder: false,
      lostJobCoverage: true,
      lostJobCoverageWho: 'Diego',
      incarcerated: false,
      renewalYears: 'five',
      completedByAssister: false,
    },
  };
}

function keys(data: Data): string[] {
  return buildApplicationFieldPlan(data).map((field) => field.key);
}

const ADDENDUM_KEY = /^(health\.(tax_household|tax_deductions|applying_for|child_|htw|lost_job|renewal_years)|household\.(foster_care_at_18|incarcerated|application_assister)|income\.(total_|yearly_totals))/;

describe('the addendum questions are well formed', () => {
  it('every gate names a question asked earlier in the form', () => {
    expect(validateIntakeForm(TX_H1010_INTAKE)).toEqual([]);
  });

  it('every addendum section is part of the Texas form', () => {
    const ids = TX_H1010_INTAKE.sections.map((section) => section.id);

    for (const id of ADDENDUM_SECTIONS) expect(ids).toContain(id);
  });
});

describe('a household applying for food benefits alone', () => {
  const snap = household(['tx_snap']);

  it('is asked no addendum question', () => {
    for (const id of ADDENDUM_SECTIONS) {
      const section = TX_H1010_INTAKE.sections.find((entry) => entry.id === id)!;

      expect(sectionIsAsked(TX_H1010_INTAKE, snap, section), id).toBe(false);
      expect(askedQuestions(TX_H1010_INTAKE, snap, section)).toEqual([]);
    }
  });

  it('emits no addendum key, even with addendum answers in its data', () => {
    expect(keys(withEveryAddendumAnswer(snap)).filter((key) => ADDENDUM_KEY.test(key))).toEqual([]);
  });

  it('emits exactly the plan it emitted before the addendum existed', () => {
    // The addendum record is the only new state; its presence changes nothing.
    expect(keys(withEveryAddendumAnswer(snap))).toEqual(keys(snap));
  });
});

describe('Appendix C, which every household naming a representative fills in', () => {
  // Section V on page 22 sends any household with a representative to
  // Appendix C, whatever it applies for, so its items are not addendum-only.
  function withRepresentative(data: Data): Data {
    const questionnaire = structuredClone(data.questionnaire);

    questionnaire.circumstances.authorizedRepresentative = {
      answer: true,
      entries: [
        {
          name: 'Rosa Delgado',
          organization: 'Foundation Communities',
          organizationId: 'FC-2231',
          phone: '5125550123',
          street: '1100 Congress Ave',
          apartment: 'Suite 400',
          city: 'Austin',
          state: 'TX',
          zipCode: '78701',
          forCalFresh: true,
          forHealthCoverage: true,
        },
      ],
    };

    return { ...data, questionnaire };
  }

  it.each([['tx_snap'], ['tx_medicaid']] as const)(
    'emits the apartment and organization ID for a %s household',
    (program) => {
      const plan = buildApplicationFieldPlan(withRepresentative(household([program])));
      const value = (key: string) => plan.find((field) => field.key === key)?.value;

      expect(value('household.authorized_representative.0.address.apartment')).toBe('Suite 400');
      expect(value('household.authorized_representative.0.organization_id')).toBe('FC-2231');
    },
  );
});

describe('a California application', () => {
  it('emits no addendum key, whatever its data holds', () => {
    const california = withEveryAddendumAnswer(household(['medi_cal', 'calfresh']));

    expect(keys(california).filter((key) => ADDENDUM_KEY.test(key))).toEqual([]);
  });
});

describe('a household applying for Medicaid or CHIP', () => {
  const medicaid = household(['tx_snap', 'tx_medicaid']);

  it('is asked a tax-return block for each person, and no more', () => {
    const asked = Array.from({ length: TAX_PERSON_SLOTS }, (_, slot) =>
      sectionIsAsked(
        TX_H1010_INTAKE,
        medicaid,
        TX_H1010_INTAKE.sections.find((entry) => entry.id === taxSectionId(slot))!,
      ),
    );

    // The applicant and two roster members.
    expect(asked).toEqual([true, true, true, false, false, false, false]);
  });

  it('names the person in their block’s heading', () => {
    const section = TX_H1010_INTAKE.sections.find(
      (entry) => entry.id === taxSectionId(1),
    )!;

    expect(section.titleValues?.(medicaid)).toEqual({ name: 'Diego Rodríguez' });
  });

  it('takes a spouse’s name from the roster rather than asking for it', () => {
    expect(rosterSpouseName(medicaid, 'applicant')).toBe('Diego Rodríguez');
    expect(rosterSpouseName(medicaid, 'spouse')).toBe('María Rodríguez');
    expect(needsSpouseName(medicaid, 'applicant')).toBe(false);

    const spouseQuestion = questionById(TX_H1010_INTAKE, 'tx.tax.0.spouse_name')!;

    expect(isAsked(TX_H1010_INTAKE, medicaid, spouseQuestion)).toBe(false);
  });

  it('asks for a spouse’s name only when the roster cannot give it', () => {
    const noSpouseOnRoster: Data = {
      ...medicaid,
      householdMembers: medicaid.householdMembers.filter((m) => m.id !== 'spouse'),
    };
    const spouseQuestion = questionById(TX_H1010_INTAKE, 'tx.tax.0.spouse_name')!;

    expect(isAsked(TX_H1010_INTAKE, noSpouseOnRoster, spouseQuestion)).toBe(true);
  });

  it('asks the child questions for a household with a child, not without', () => {
    const children = TX_H1010_INTAKE.sections.find(
      (entry) => entry.id === TX_SECTIONS.healthChildren,
    )!;
    const adultsOnly: Data = {
      ...medicaid,
      householdMembers: medicaid.householdMembers.filter((m) => m.id !== 'child'),
    };

    expect(sectionIsAsked(TX_H1010_INTAKE, medicaid, children)).toBe(true);
    expect(sectionIsAsked(TX_H1010_INTAKE, adultsOnly, children)).toBe(false);
  });

  it('asks the Healthy Texas Women questions only for a woman 15 to 44', () => {
    const htw = TX_H1010_INTAKE.sections.find((entry) => entry.id === TX_SECTIONS.htw)!;
    const noWomen: Data = {
      ...medicaid,
      applicant: {
        ...medicaid.applicant,
        householdDetails: { ...medicaid.applicant.householdDetails, sex: 'male' },
      },
    };

    expect(sectionIsAsked(TX_H1010_INTAKE, medicaid, htw)).toBe(true);
    expect(sectionIsAsked(TX_H1010_INTAKE, noWomen, htw)).toBe(false);
  });

  it('asks for yearly income totals only when income changes during the year', () => {
    const totals = TX_H1010_INTAKE.sections.find(
      (entry) => entry.id === TX_SECTIONS.incomeTotals,
    )!;
    const varies: Data = {
      ...medicaid,
      questionnaire: {
        ...medicaid.questionnaire,
        income: { ...medicaid.questionnaire.income, incomeVariesDuringYear: true },
      },
    };

    expect(sectionIsAsked(TX_H1010_INTAKE, medicaid, totals)).toBe(false);
    expect(sectionIsAsked(TX_H1010_INTAKE, varies, totals)).toBe(true);
  });

  it('asks the narrower foster-care question only after a Yes to the broad one', () => {
    const question = questionById(TX_H1010_INTAKE, Q.fosterCareAt18)!;
    const fosterCareWrite = questionById(TX_H1010_INTAKE, Q.fosterCare)!;

    expect(isAsked(TX_H1010_INTAKE, medicaid, question)).toBe(false);
    expect(
      isAsked(TX_H1010_INTAKE, fosterCareWrite.write(medicaid, true), question),
    ).toBe(true);
  });

  it('answers the narrower foster-care question No when the broad one is No', () => {
    const neverInFosterCare = questionById(TX_H1010_INTAKE, Q.fosterCare)!.write(
      medicaid,
      false,
    );
    const plan = buildApplicationFieldPlan(neverInFosterCare);

    expect(plan).toContainEqual({ key: 'household.foster_care_at_18_or_older', value: false });
  });

  it('reuses the existing answers rather than asking twice', () => {
    expect(questionById(TX_H1010_INTAKE, Q.absentParent)!.write(medicaid, true))
      .toMatchObject({ questionnaire: { circumstances: { absentParents: { answer: true } } } });
    expect(questionById(TX_H1010_INTAKE, Q.americanIndian)!.write(medicaid, true))
      .toMatchObject({ questionnaire: { health: { americanIndianOrAlaskaNative: true } } });
    expect(questionById(TX_H1010_INTAKE, Q.jobCoverage)!.write(medicaid, true))
      .toMatchObject({ questionnaire: { health: { employerCoverage: { answer: true } } } });
  });

  it('emits each person’s block, with roster members at Person 1’s address', () => {
    const plan = buildApplicationFieldPlan(withEveryAddendumAnswer(medicaid));
    const value = (key: string) => plan.find((field) => field.key === key)?.value;

    expect(value('health.applying_for_medicaid_or_chip')).toBe(true);
    expect(value('health.tax_household.0.first_name')).toBe('María');
    expect(value('health.tax_household.0.spouse_name')).toBe('Diego Rodríguez');
    expect(value('health.tax_household.0.dependent_names')).toBe('Mateo Rodríguez');
    expect(value('health.tax_household.2.first_name')).toBe('Mateo');
    expect(value('health.tax_household.2.lives_with_applicant')).toBe(true);
    expect(value('health.tax_household.0.lives_with_applicant')).toBeUndefined();
  });

  it('emits a follow-up only while the question that opens it is Yes', () => {
    const data = withEveryAddendumAnswer(medicaid);
    const closed: Data = {
      ...data,
      medicaidAddendum: {
        ...data.medicaidAddendum!,
        lostJobCoverage: false,
        hasTaxDeductions: false,
      },
    };
    const plan = keys(closed);

    expect(plan).toContain('health.lost_job_coverage');
    expect(plan).not.toContain('health.lost_job_coverage_who');
    expect(plan).not.toContain('health.tax_deductions.alimony_amount');
  });
});

describe('the addendum tables ask a row’s follow-ups only when they apply', () => {
  const data = household(['tx_medicaid']);

  it('Appendix A stops at item 13 for someone who cannot get the coverage', () => {
    const asked = (record: Partial<EmployerCoverageEntry>) =>
      TX_EMPLOYER_COVERAGE.fields
        .map((field) => field.id)
        .filter((id) =>
          TX_EMPLOYER_COVERAGE.isFieldAsked!(id, record as EmployerCoverageEntry, data),
        );

    expect(asked({ eligibleNowOrSoon: false })).not.toContain('lowestCostPremium');
    expect(asked({ eligibleNowOrSoon: true })).toContain('lowestCostPremium');
    expect(asked({ eligibleNowOrSoon: true })).not.toContain('changedPremium');
    expect(
      asked({
        eligibleNowOrSoon: true,
        planChange: 'will_start_offering_or_change_premium',
      }),
    ).toContain('changedPremium');
  });

  it('Appendix B asks "is this person eligible" only after a No, as printed', () => {
    const asked = (record: Partial<TribalMembershipEntry>) =>
      TX_TRIBAL_MEMBERS.isFieldAsked!(
        'eligibleForIndianHealthService',
        record as TribalMembershipEntry,
        data,
      );

    expect(asked({ hasReceivedIndianHealthService: true })).toBe(false);
    expect(asked({ hasReceivedIndianHealthService: false })).toBe(true);
  });

  it('Appendix B covers eligibility and the special income, with amount and how often', () => {
    const fields = TX_TRIBAL_MEMBERS.fields.map((field) => field.id);

    expect(fields).toEqual(
      expect.arrayContaining([
        'eligibleForIndianHealthService',
        'hasExcludableTribalIncome',
        'tribalIncomeAmount',
        'tribalIncomeFrequency',
      ]),
    );
  });

  it('writing Appendix B rows opens the record the field plan reads', () => {
    const written = TX_TRIBAL_MEMBERS.write(data, [
      { id: 'r', memberId: 'applicant', tribeName: '', tribalIncomeFrequency: '' },
    ]);

    expect(written.questionnaire.appendices.tribalMembership.answer).toBe(true);
  });

  it('question 7 prints the names of the women who opted out', () => {
    const opted = TX_HTW_OPT_OUTS.write(
      {
        ...data,
        medicaidAddendum: { taxReturns: {}, declinesHtwScreening: true },
      },
      [{ memberId: 'applicant' }],
    );
    const plan = buildApplicationFieldPlan(opted);

    expect(plan).toContainEqual({
      key: 'health.htw_screening_opt_out.0.name',
      value: 'María Rodríguez',
    });
    expect(plan).toContainEqual({ key: 'health.htw_screening_opt_out.0.declines', value: true });
  });
});
