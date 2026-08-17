//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Structural boundary scenarios for the whole SAWS 2 PLUS pipeline.
 *
 * These are chosen for the *shapes* they exercise, not to raise a test count:
 * an empty table, a table filled to exactly its printed capacity, a table with
 * one record too many, a conditional branch answered No, and combinations that
 * put several appendices on the same document. Those are the places a form
 * adapter goes wrong, and a scenario that merely adds another ordinary
 * household tests nothing the previous one did not.
 *
 * The definitions live here, in TypeScript, because that is where the
 * application model lives. A vitest test compiles each to a canonical field
 * plan and writes `saws2-e2e-scenarios.json`, which pytest then reads to
 * generate real PDFs and assert the safety invariants against the real form.
 * Committing that JSON is deliberate: it is a readable record of exactly what
 * crosses the runtime boundary, and it shows up in a diff when a mapping
 * changes.
 */

import { writePath } from '@/lib/saws2-question-planner';
import {
  EMPTY_APPLICATION_DATA,
  type HouseholdMember,
  type Saws2PlusApplicationData,
} from '@/types/application';
import type { Saws2PlusProgram } from '@/lib/report-assembler';

type Data = Saws2PlusApplicationData;

const w = (d: Data, path: string, value: unknown): Data => ({
  ...d,
  questionnaire: writePath(d.questionnaire, path, value),
});

/** Apply a list of questionnaire writes in order. */
const writes = (d: Data, pairs: Array<[string, unknown]>): Data =>
  pairs.reduce((acc, [path, value]) => w(acc, path, value), d);

function adult(id: string, firstName: string): HouseholdMember {
  return {
    id,
    firstName,
    middleName: '',
    lastName: 'Reyes',
    dateOfBirth: '1988-05-04',
    relationshipToApplicant: 'Spouse',
    adultDetails: { applyingFor: ['calfresh'], sex: 'male', citizenOrNational: true },
  };
}

function child(id: string, firstName: string): HouseholdMember {
  return {
    id,
    firstName,
    middleName: '',
    lastName: 'Delgado',
    dateOfBirth: '2018-03-02',
    relationshipToApplicant: 'Daughter',
    childDetails: {
      applyingFor: ['medi_cal'],
      sex: 'female',
      citizenOrNational: true,
      placeOfBirth: 'Fresno, CA',
      immunizationsUpToDate: true,
      parentStatus: { none: true },
    },
  };
}

function base(
  programs: Saws2PlusProgram[],
  members: HouseholdMember[] = [],
): Data {
  return {
    ...EMPTY_APPLICATION_DATA,
    selectedPrograms: programs,
    applicant: {
      ...EMPTY_APPLICATION_DATA.applicant,
      firstName: 'Maria',
      middleName: 'Elena',
      lastName: 'Delgado',
      dateOfBirth: '1990-01-01',
      phone: '5595550100',
      email: 'maria@example.test',
      preferredLanguage: 'English',
      homeAddress: {
        street: '12 Oak Street',
        apartment: 'B',
        city: 'Fresno',
        state: 'CA',
        zipCode: '93701',
      },
      mailingAddressSameAsHome: true,
      householdDetails: {
        applyingFor: programs,
        sex: 'female',
        citizenOrNational: true,
        maritalStatus: 'married',
      },
    },
    householdMembers: members,
  };
}

function earnedJob(index: number) {
  return {
    id: `earn-${index}`,
    memberId: 'applicant',
    employerName: `Employer ${index + 1}`,
    reportedAmount: 400 + index,
    reportedFrequency: 'weekly',
    expectedToContinue: true,
  };
}

function historyJob(memberId: string, index: number) {
  return {
    id: `job-${memberId}-${index}`,
    memberId,
    employerName: `History Employer ${index + 1}`,
    employerAddress: `${index + 1} Market Street, Fresno CA`,
    jobTitle: 'Cook',
    startDate: '03/2024',
    endDate: '11/2025',
    reasonForLeaving: 'Hours were cut',
    hoursWorked: 32,
    hoursWorkedFrequency: 'weekly',
    payAmount: 18.5,
    payRateFrequency: 'hourly',
    selfEmployed: false,
    countyHelpedGetJob: false,
  };
}

function vehicle(index: number) {
  return {
    id: `veh-${index}`,
    ownerMemberId: 'applicant',
    userMemberId: 'applicant',
    yearMakeModel: `201${index} Toyota Corolla`,
    vehicleLicenseNumber: `7ABC12${index}`,
    fairMarketValue: 4000 + index,
    fairMarketValueSource: 'kelly_blue_book',
    fairMarketValueSourceOther: '',
    amountOwedSourceOther: '',
    isLeased: false,
  };
}

export interface Scenario {
  id: string;
  /** What structural boundary this scenario exists to exercise. */
  purpose: string;
  county: string;
  data: Data;
}

export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'single_person',
    purpose: 'One adult, one program. The smallest document the flow produces.',
    county: 'Fresno',
    data: writes(base(['calfresh']), [
      ['income.earned.answer', false],
      ['income.unearned.answer', false],
      ['resources.vehicles.answer', false],
    ]),
  },
  {
    id: 'multi_person',
    purpose: 'Two adults and two children across all three programs.',
    county: 'Fresno',
    data: writes(
      base(
        ['calfresh', 'calworks', 'medi_cal'],
        [adult('m1', 'Luis'), child('m2', 'Sofia'), child('m3', 'Ana')],
      ),
      [
        ['income.earned.answer', true],
        ['income.earned.entries', [earnedJob(0)]],
      ],
    ),
  },
  {
    id: 'max_household_rows',
    purpose:
      'Exactly five adults and five children — both printed tables full, ' +
      'with nothing overflowing.',
    county: 'Fresno',
    data: base(
      ['calfresh'],
      [
        ...Array.from({ length: 4 }, (_, i) => adult(`a${i}`, `Adult${i}`)),
        ...Array.from({ length: 5 }, (_, i) => child(`c${i}`, `Child${i}`)),
      ],
    ),
  },
  {
    id: 'household_overflow',
    purpose:
      'Seven adults and six children — both printed tables overflow, and ' +
      'the extra people must be reported rather than dropped.',
    county: 'Fresno',
    data: base(
      ['calfresh'],
      [
        ...Array.from({ length: 6 }, (_, i) => adult(`a${i}`, `Adult${i}`)),
        ...Array.from({ length: 6 }, (_, i) => child(`c${i}`, `Child${i}`)),
      ],
    ),
  },
  {
    id: 'no_employment',
    purpose:
      'Q8 answered No. The gateway must tick No and no job row may be ' +
      'written anywhere.',
    county: 'Fresno',
    data: writes(base(['calfresh']), [
      ['income.earned.answer', false],
      ['income.selfEmployment.answer', false],
    ]),
  },
  {
    id: 'one_job',
    purpose: 'A single earned-income record filling the first printed row.',
    county: 'Fresno',
    data: writes(base(['calfresh']), [
      ['income.earned.answer', true],
      ['income.earned.entries', [earnedJob(0)]],
    ]),
  },
  {
    id: 'earned_income_at_capacity',
    purpose: 'Four earned records — exactly the four printed rows on Q8.',
    county: 'Fresno',
    data: writes(base(['calfresh']), [
      ['income.earned.answer', true],
      ['income.earned.entries', Array.from({ length: 4 }, (_, i) => earnedJob(i))],
    ]),
  },
  {
    id: 'earned_income_overflow',
    purpose: 'Six earned records against four printed rows.',
    county: 'Fresno',
    data: writes(base(['calfresh']), [
      ['income.earned.answer', true],
      ['income.earned.entries', Array.from({ length: 6 }, (_, i) => earnedJob(i))],
    ]),
  },
  {
    id: 'appendix_d_capacity',
    purpose:
      'Cash aid, two working adults, three jobs each — Appendix D filled to ' +
      'exactly its printed capacity across both pages.',
    county: 'Fresno',
    data: writes(base(['calworks'], [adult('m1', 'Luis')]), [
      ['appendices.employmentHistory.answer', true],
      [
        'appendices.employmentHistory.entries',
        [
          ...Array.from({ length: 3 }, (_, i) => historyJob('applicant', i)),
          ...Array.from({ length: 3 }, (_, i) => historyJob('m1', i)),
        ],
      ],
    ]),
  },
  {
    id: 'appendix_d_overflow',
    purpose:
      'Three working adults and a fourth job for one of them — Appendix D ' +
      'runs past both its person and its job capacity.',
    county: 'Fresno',
    data: writes(
      base(['calworks'], [adult('m1', 'Luis'), adult('m2', 'Nia')]),
      [
        ['appendices.employmentHistory.answer', true],
        [
          'appendices.employmentHistory.entries',
          [
            ...Array.from({ length: 4 }, (_, i) => historyJob('applicant', i)),
            historyJob('m1', 0),
            historyJob('m2', 0),
          ],
        ],
      ],
    ),
  },
  {
    id: 'employer_coverage',
    purpose: 'Appendix A active: an employer that offers health coverage.',
    county: 'Fresno',
    data: writes(base(['medi_cal'], [adult('m1', 'Luis')]), [
      ['health.employerCoverage.answer', true],
      [
        'health.employerCoverage.entries',
        [
          {
            id: 'ec1',
            memberId: 'applicant',
            employerName: 'Bright Star Cafe',
            employerPhone: '5595550111',
            offersCoverage: true,
            eligibleNowOrSoon: true,
            lowestCostPremium: 210,
            premiumFrequency: 'monthly',
            meetsMinimumValueStandard: true,
            planChange: 'no_changes_expected',
            planChangeDate: '',
          },
        ],
      ],
    ]),
  },
  {
    id: 'tribal_membership',
    purpose: 'Appendix B active, including item 3’s No-conditional follow-up.',
    county: 'Fresno',
    data: writes(base(['medi_cal'], [adult('m1', 'Luis')]), [
      ['health.americanIndianOrAlaskaNative', true],
      ['appendices.tribalName', 'Yurok'],
      ['appendices.tribalMembership.answer', true],
      [
        'appendices.tribalMembership.entries',
        [
          {
            id: 't1',
            memberId: 'applicant',
            memberOfFederallyRecognizedTribe: true,
            tribeName: 'Yurok',
            hasReceivedIndianHealthService: false,
            eligibleForIndianHealthService: true,
            hasExcludableTribalIncome: true,
            tribalIncomeAmount: 250,
            tribalIncomeFrequency: 'Yearly',
          },
        ],
      ],
    ]),
  },
  {
    id: 'health_authorized_representative',
    purpose:
      'Appendix C active: a representative appointed for health coverage, ' +
      'alongside one appointed only for CalFresh who must not appear on it.',
    county: 'Fresno',
    data: writes(base(['calfresh', 'medi_cal']), [
      ['circumstances.authorizedRepresentative.answer', true],
      [
        'circumstances.authorizedRepresentative.entries',
        [
          {
            id: 'rep-food',
            name: 'Dana Okafor',
            organization: 'Neighborhood Food Bank',
            phone: '5595550188',
            address: '900 Elm Street, Fresno CA 93701',
            forCalFresh: true,
            forHealthCoverage: false,
          },
          {
            id: 'rep-health',
            name: 'Priya Raman',
            organization: 'Valley Health Navigators',
            phone: '5595550199',
            address: '44 Cedar Avenue, Fresno CA 93702',
            forCalFresh: false,
            forHealthCoverage: true,
          },
        ],
      ],
    ]),
  },
  {
    id: 'appendix_e_overflow',
    purpose:
      'Four vehicles against Appendix E’s three printed columns, with Q26 ' +
      'open and cash aid making the appendix apply.',
    county: 'Fresno',
    data: writes(base(['calworks']), [
      ['resources.vehicles.answer', true],
      [
        'resources.vehicles.entries',
        Array.from({ length: 4 }, (_, i) => ({
          id: `q26-${i}`,
          memberId: 'applicant',
          year: `201${i}`,
          make: 'Toyota',
          model: 'Corolla',
          usedFor: 'Getting to work',
        })),
      ],
      ['appendices.vehicleDetails.answer', true],
      [
        'appendices.vehicleDetails.entries',
        Array.from({ length: 4 }, (_, i) => vehicle(i)),
      ],
    ]),
  },
  {
    id: 'q25_personal_property_overflow',
    purpose: 'Four personal-property items against Q25’s three printed rows.',
    county: 'Fresno',
    data: writes(base(['calworks']), [
      ['resources.personalProperty.answer', true],
      [
        'resources.personalProperty.entries',
        Array.from({ length: 4 }, (_, i) => ({
          id: `pp-${i}`,
          memberId: 'applicant',
          category: 'tools',
          description: `Tool set ${i + 1}`,
          estimatedValue: 300 + i,
        })),
      ],
    ]),
  },
  {
    id: 'all_conditionals_no',
    purpose:
      'Every gateway answered No. Each No box must be ticked and not one ' +
      'detail row may be written behind it.',
    county: 'Fresno',
    data: writes(base(['calfresh', 'medi_cal']), [
      ['income.earned.answer', false],
      ['income.unearned.answer', false],
      ['income.inKindSupport.answer', false],
      ['expenses.dependentCare.answer', false],
      ['expenses.childSupportPaid.answer', false],
      ['expenses.medical.answer', false],
      ['resources.accounts.answer', false],
      ['resources.vehicles.answer', false],
      ['resources.personalProperty.answer', false],
      ['health.currentCoverage.answer', false],
      ['health.employerCoverage.answer', false],
      ['health.americanIndianOrAlaskaNative', false],
      ['health.taxFiler', false],
      ['circumstances.authorizedRepresentative.answer', false],
    ]),
  },
  {
    id: 'multiple_appendices',
    purpose:
      'Appendices A, B, D and E on one document, so a mapping that leaks ' +
      'between them is visible.',
    county: 'Fresno',
    data: writes(
      base(['calworks', 'medi_cal'], [adult('m1', 'Luis'), child('m2', 'Sofia')]),
      [
        ['health.americanIndianOrAlaskaNative', true],
        ['appendices.tribalName', 'Yurok'],
        ['appendices.tribalMembership.answer', true],
        [
          'appendices.tribalMembership.entries',
          [
            {
              id: 't1',
              memberId: 'applicant',
              memberOfFederallyRecognizedTribe: true,
              tribeName: 'Yurok',
              hasReceivedIndianHealthService: true,
              hasExcludableTribalIncome: false,
              tribalIncomeFrequency: '',
            },
          ],
        ],
        ['health.employerCoverage.answer', true],
        [
          'health.employerCoverage.entries',
          [
            {
              id: 'ec1',
              memberId: 'm1',
              employerName: 'Delta Packing',
              employerPhone: '5595550122',
              offersCoverage: true,
              eligibleNowOrSoon: false,
              premiumFrequency: 'monthly',
              planChange: 'no_changes_expected',
              planChangeDate: '',
            },
          ],
        ],
        ['appendices.employmentHistory.answer', true],
        [
          'appendices.employmentHistory.entries',
          [historyJob('applicant', 0), historyJob('m1', 0)],
        ],
        ['resources.vehicles.answer', true],
        [
          'resources.vehicles.entries',
          [
            {
              id: 'q26-0',
              memberId: 'applicant',
              year: '2012',
              make: 'Toyota',
              model: 'Corolla',
              usedFor: 'Work',
            },
          ],
        ],
        ['appendices.vehicleDetails.answer', true],
        ['appendices.vehicleDetails.entries', [vehicle(0)]],
      ],
    ),
  },
] as const;
