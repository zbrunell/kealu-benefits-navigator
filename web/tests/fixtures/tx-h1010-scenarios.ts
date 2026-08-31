//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Austin households, answered through the Texas intake configuration.
 *
 * Every answer below is applied with the *same* `write` function the browser
 * calls when someone taps Yes, and through :func:`answer`, which refuses a
 * question whose gate is still shut. So a scenario is not merely a plausible
 * application shape — it is one a person could have produced by working through
 * the screens, and a question that becomes unreachable makes these throw rather
 * than quietly producing data the UI can no longer create.
 *
 * That is the guarantee the Python suite depends on. `tx-h1010-scenarios.json`
 * is emitted from these and read by `tests/test_formmap_h1010_scenarios.py`,
 * which generates real H1010 documents from the plans and asserts where every
 * value lands. Before this file was built through the configuration, the two
 * suites agreed about a fixture; now they agree about the product.
 *
 * ── What is applied directly, and why ──────────────────────────────────────
 * Three things are set as objects rather than through a question: the
 * programmes (a multi-select on its own screen), the applicant's identity and
 * address (collected by the shared `ApplicantStep`, which predates the
 * configuration and validates its own fields), and the household roster (whose
 * editor writes members the same way). Each is written exactly as the component
 * writes it. Everything else goes through a question id.
 *
 * ── Chosen for the shapes, not the count ───────────────────────────────────
 * One adult with no roster rows at all; a family that fills every printed table
 * and needs a separate mailing address; a household bigger than the tables with
 * values long enough to test fitting; and every income gateway answered an
 * explicit No, so the No boxes tick and no row is written anywhere.
 */

import {
  isAsked,
  questionById,
  type AnswerValue,
} from '@/lib/form-intake/model';
import {
  TX_BILLS,
  TX_H1010_INTAKE,
  TX_JOBS,
  TX_OTHER_INCOME,
  TX_QUESTION_IDS as Q,
  TX_REPRESENTATIVE,
  type RecordList,
} from '@/lib/form-intake/tx-h1010';
import { buildInitialApplicationData } from '@/lib/application-data';
import type { BenefitProgramId } from '@/lib/state-applications';
import type {
  AdultApplicationDetails,
  ApplicantInformation,
  HouseholdMember,
  Saws2PlusApplicationData,
} from '@/types/application';

type Data = Saws2PlusApplicationData;

type Answers = ReadonlyArray<readonly [string, AnswerValue]>;

/** One answer, applied the way the browser applies it. */
function answer(data: Data, id: string, value: AnswerValue): Data {
  const question = questionById(TX_H1010_INTAKE, id);

  if (!question) throw new Error(`no such Texas question: ${id}`);

  if (!isAsked(TX_H1010_INTAKE, data, question)) {
    throw new Error(
      `${id} is not asked in this scenario — its gate is shut, so no ` +
        'applicant could have answered it here',
    );
  }

  return question.write(data, value);
}

function answerAll(data: Data, answers: Answers): Data {
  return answers.reduce(
    (current, [id, value]) => answer(current, id, value),
    data,
  );
}

/** One row of a repeating list, built through the list's own field writers. */
function row<TRecord>(
  list: RecordList<TRecord>,
  index: number,
  id: string,
  answers: Answers,
): TRecord {
  /*
   * A stable id, replacing the timestamp `blank` generates. Record ids never
   * reach the canonical plan, but the committed JSON has to be byte-identical
   * between runs or the fixture check becomes noise.
   */
  let record = { ...list.blank(index), id } as TRecord;

  for (const [fieldId, value] of answers) {
    const field = list.fields.find((entry) => entry.id === fieldId);

    if (!field) throw new Error(`${list.id} has no field ${fieldId}`);

    record = field.write(record, value);
  }

  return record;
}

/** Add rows to a list, refusing if the gate that unlocks it is shut. */
function fill<TRecord>(
  data: Data,
  list: RecordList<TRecord>,
  rows: readonly TRecord[],
): Data {
  if (list.gate) {
    const gate = questionById(TX_H1010_INTAKE, list.gate.questionId);

    if (gate?.read(data) !== list.gate.equals) {
      throw new Error(
        `${list.id} cannot be filled: ${list.gate.questionId} is not ` +
          `${list.gate.equals}`,
      );
    }
  }

  return list.write(data, rows);
}

/** The applicant's own details, as `ApplicantStep` writes them. */
function withApplicant(
  data: Data,
  applicant: Partial<ApplicantInformation>,
): Data {
  return { ...data, applicant: { ...data.applicant, ...applicant } };
}

const AUSTIN_HOUSEHOLD_DETAILS: AdultApplicationDetails = {
  applyingFor: [],
  sex: 'female',
  citizenOrNational: true,
  maritalStatus: 'single',
  disabled: false,
};

const AUSTIN_APPLICANT: Partial<ApplicantInformation> = {
  firstName: 'Marisol',
  middleName: 'Elena',
  lastName: 'Ramirez',
  otherNames: '',
  dateOfBirth: '1991-03-14',
  phone: '5125551234',
  alternatePhone: '',
  email: 'marisol.ramirez@example.test',
  preferredLanguage: 'Spanish',
  homeAddress: {
    street: '2100 Nueces Street',
    apartment: 'Apt 4B',
    city: 'Austin',
    state: 'TX',
    zipCode: '78705',
  },
  householdDetails: { ...AUSTIN_HOUSEHOLD_DETAILS },
};

function adult(id: string, firstName: string): HouseholdMember {
  return {
    id,
    firstName,
    middleName: '',
    lastName: 'Ramirez',
    dateOfBirth: '1989-07-19',
    relationshipToApplicant: 'spouse',
    adultDetails: {
      applyingFor: [],
      sex: 'male',
      citizenOrNational: true,
    },
    childDetails: { applyingFor: [], placeOfBirth: '', parentStatus: {} },
  };
}

function child(
  id: string,
  firstName: string,
  overrides: Partial<HouseholdMember> = {},
): HouseholdMember {
  return {
    id,
    firstName,
    middleName: '',
    lastName: 'Ramirez',
    dateOfBirth: '2016-09-08',
    relationshipToApplicant: 'child',
    adultDetails: { applyingFor: [] },
    childDetails: {
      applyingFor: [],
      sex: 'female',
      citizenOrNational: true,
      placeOfBirth: '',
      parentStatus: {},
    },
    ...overrides,
  };
}

/** The answers every Austin scenario gives, in the order the screens ask them. */
const COMMON_ANSWERS: Answers = [
  [Q.mailSame, true],
  [Q.homeless, false],
  [Q.institutional, false],
  [Q.foodTogether, true],
  [Q.pregnant, false],
];

function base(programs: readonly BenefitProgramId[]): Data {
  const data: Data = {
    ...buildInitialApplicationData(null),
    selectedPrograms: [...programs],
  };

  return answerAll(withApplicant(data, AUSTIN_APPLICANT), COMMON_ANSWERS);
}

export interface TexasScenario {
  id: string;
  /** What this scenario exists to exercise on the Texas form. */
  purpose: string;
  county: string;
  data: Data;
}

// ---------------------------------------------------------------------------
// One adult
// ---------------------------------------------------------------------------

function singleAdult(): Data {
  let data = answerAll(base(['tx_snap']), [
    [Q.students, false],
    [Q.annualIncome, 20000],
    [Q.incomeType, 'W-2 employee'],
    [Q.hasJob, true],
    [Q.selfEmployed, false],
    [Q.otherIncome, false],
    [Q.incomeVaries, false],
    [Q.hasBills, true],
    [Q.dependentCare, false],
    [Q.childSupport, false],
    [Q.medical, false],
    [Q.accounts, true],
    [Q.vehicles, false],
    [Q.realProperty, false],
    [Q.personalProperty, false],
    // The SNAP expedited screen, which applies because food benefits were
    // asked for. A household in urgent need, so several of these are Yes.
    [Q.expeditedIncome, false],
    [Q.expeditedHousing, true],
    [Q.expeditedFarm, false],
    [Q.expeditedFood, true],
    [Q.expeditedEviction, false],
    [Q.expeditedUtilities, true],
    [Q.expeditedClothing, false],
    [Q.expeditedTransport, false],
    [Q.military, false],
    [Q.disability, false],
    [Q.fosterCare, false],
    [Q.priorAssistance, false],
    [Q.existingBenefits, 'None'],
    [Q.hasHelper, false],
  ]);

  data = fill(data, TX_JOBS, [
    row(TX_JOBS, 0, 'job-0', [
      ['memberId', 'applicant'],
      ['employerName', 'Torchy’s Tacos'],
      ['employerAddress', '100 Congress Avenue, Austin TX'],
      ['grossReceivedThisMonth', 1600],
      ['payFrequency', 'every_two_weeks'],
      ['hoursPerWeek', 32],
    ]),
  ]);

  return fill(data, TX_BILLS, [
    row(TX_BILLS, 0, 'bill-0', [
      ['kind', 'rent_or_mortgage'],
      ['amountMonthly', 1150],
    ]),
    row(TX_BILLS, 1, 'bill-1', [
      ['kind', 'electricity'],
      ['amountMonthly', 95],
    ]),
  ]);
}

// ---------------------------------------------------------------------------
// A family of four
// ---------------------------------------------------------------------------

function familyOfFour(): Data {
  let data = base(['tx_snap', 'tx_medicaid', 'tx_chip', 'tx_tanf']);

  data = withApplicant(data, {
    householdDetails: { ...AUSTIN_HOUSEHOLD_DETAILS, maritalStatus: 'married' },
  });

  data = {
    ...data,
    householdMembers: [
      adult('m1', 'Diego'),
      child('m2', 'Sofia'),
      child('m3', 'Mateo', {
        dateOfBirth: '2020-11-30',
        childDetails: {
          applyingFor: [],
          sex: 'male',
          citizenOrNational: true,
          placeOfBirth: '',
          parentStatus: {},
        },
      }),
    ],
  };

  // Mail goes to a PO box, which opens the mailing-address block.
  data = answerAll(data, [
    [Q.mailSame, false],
    ['tx.mail.street', 'PO Box 4477'],
    ['tx.mail.city', 'Austin'],
    ['tx.mail.state', 'TX'],
    ['tx.mail.zip', '78765'],
    [Q.students, true],
    [Q.annualIncome, 41000],
    [Q.incomeType, 'Two jobs'],
    [Q.hasJob, true],
    [Q.selfEmployed, false],
    [Q.otherIncome, true],
    [Q.incomeVaries, true],
    [Q.hasBills, true],
    [Q.dependentCare, true],
    [Q.childSupport, false],
    [Q.medical, false],
    [Q.accounts, true],
    [Q.vehicles, true],
    [Q.realProperty, false],
    [Q.personalProperty, false],
    [Q.expeditedIncome, false],
    [Q.expeditedHousing, true],
    [Q.expeditedFarm, false],
    [Q.expeditedFood, true],
    [Q.expeditedEviction, false],
    [Q.expeditedUtilities, true],
    [Q.expeditedClothing, false],
    [Q.expeditedTransport, false],
    [Q.military, true],
    [Q.disability, false],
    [Q.fosterCare, false],
    [Q.priorAssistance, true],
    [Q.existingBenefits, 'WIC for the youngest child'],
    [Q.hasHelper, true],
  ]);

  data = fill(data, TX_JOBS, [
    row(TX_JOBS, 0, 'job-0', [
      ['memberId', 'applicant'],
      ['employerName', 'Austin Independent School District'],
      ['employerAddress', '100 Congress Avenue, Austin TX'],
      ['grossReceivedThisMonth', 1600],
      ['payFrequency', 'every_two_weeks'],
      ['hoursPerWeek', 32],
    ]),
    row(TX_JOBS, 1, 'job-1', [
      ['memberId', 'm1'],
      ['employerName', 'H-E-B'],
      ['employerAddress', '101 Congress Avenue, Austin TX'],
      ['grossReceivedThisMonth', 1650],
      ['payFrequency', 'every_two_weeks'],
      ['hoursPerWeek', 32],
    ]),
  ]);

  data = fill(data, TX_OTHER_INCOME, [
    row(TX_OTHER_INCOME, 0, 'unearned-0', [
      ['memberId', 'applicant'],
      ['source', 'Child support'],
      ['reportedAmount', 250],
      ['reportedFrequency', 'monthly'],
    ]),
    row(TX_OTHER_INCOME, 1, 'unearned-1', [
      ['memberId', 'm1'],
      ['source', 'Unemployment'],
      ['reportedAmount', 275],
      ['reportedFrequency', 'monthly'],
    ]),
  ]);

  data = fill(data, TX_BILLS, [
    row(TX_BILLS, 0, 'bill-0', [
      ['kind', 'rent_or_mortgage'],
      ['amountMonthly', 1600],
    ]),
    row(TX_BILLS, 1, 'bill-1', [
      ['kind', 'electricity'],
      ['amountMonthly', 180],
    ]),
    row(TX_BILLS, 2, 'bill-2', [['kind', 'water'], ['amountMonthly', 65]]),
    row(TX_BILLS, 3, 'bill-3', [
      ['kind', 'other'],
      ['amountMonthly', 40],
      ['description', 'Trash and recycling'],
    ]),
  ]);

  return fill(data, TX_REPRESENTATIVE, [
    row(TX_REPRESENTATIVE, 0, 'rep-0', [
      ['name', 'Ana Villarreal'],
      ['organization', 'Central Texas Food Bank'],
      ['phone', '5125556677'],
      ['street', '6500 Metropolis Drive'],
      ['city', 'Austin'],
      ['state', 'TX'],
      ['zipCode', '78744'],
    ]),
  ]);
}

// ---------------------------------------------------------------------------
// More people than the printed tables hold
// ---------------------------------------------------------------------------

function householdOverflow(): Data {
  let data = base(['tx_snap', 'tx_medicaid']);

  data = withApplicant(data, {
    lastName: 'Ramirez de la Cruz Villanueva',
    homeAddress: {
      street: '18200 Farm-to-Market Road 1826, Building C, Southwest Parkway',
      apartment: 'Unit 1420',
      city: 'Austin',
      state: 'TX',
      zipCode: '78737-2251',
    },
  });

  data = {
    ...data,
    householdMembers: [
      ...Array.from({ length: 4 }, (_, index) =>
        adult(`a${index}`, `Adulto${index}`),
      ),
      ...Array.from({ length: 4 }, (_, index) =>
        child(`c${index}`, `Ninez${index}`),
      ),
    ],
  };

  data = answerAll(data, [
    [Q.hasJob, true],
    [Q.otherIncome, false],
    [Q.hasBills, true],
  ]);

  data = fill(data, TX_JOBS, [
    row(TX_JOBS, 0, 'job-0', [
      ['memberId', 'applicant'],
      [
        'employerName',
        'Central Texas Regional Mobility Authority Maintenance Division',
      ],
      ['employerAddress', '100 Congress Avenue, Austin TX'],
      ['grossReceivedThisMonth', 1600],
      ['payFrequency', 'every_two_weeks'],
      ['hoursPerWeek', 32],
    ]),
    row(TX_JOBS, 1, 'job-1', [
      ['memberId', 'a0'],
      ['employerName', 'H-E-B'],
      ['employerAddress', '101 Congress Avenue, Austin TX'],
      ['grossReceivedThisMonth', 1650],
      ['payFrequency', 'every_two_weeks'],
      ['hoursPerWeek', 32],
    ]),
    row(TX_JOBS, 2, 'job-2', [
      ['memberId', 'a1'],
      ['employerName', 'Whole Foods Market'],
      ['employerAddress', '102 Congress Avenue, Austin TX'],
      ['grossReceivedThisMonth', 1700],
      ['payFrequency', 'every_two_weeks'],
      ['hoursPerWeek', 32],
    ]),
    row(TX_JOBS, 3, 'job-3', [
      ['memberId', 'a2'],
      ['employerName', 'Dell Technologies'],
      ['employerAddress', '103 Congress Avenue, Austin TX'],
      ['grossReceivedThisMonth', 1750],
      ['payFrequency', 'every_two_weeks'],
      ['hoursPerWeek', 32],
    ]),
  ]);

  return fill(data, TX_BILLS, [
    row(TX_BILLS, 0, 'bill-0', [
      ['kind', 'rent_or_mortgage'],
      ['amountMonthly', 2400],
    ]),
    row(TX_BILLS, 1, 'bill-1', [
      ['kind', 'electricity'],
      ['amountMonthly', 310],
    ]),
    row(TX_BILLS, 2, 'bill-2', [['kind', 'water'], ['amountMonthly', 120]]),
    row(TX_BILLS, 3, 'bill-3', [['kind', 'gas'], ['amountMonthly', 55]]),
    row(TX_BILLS, 4, 'bill-4', [['kind', 'telephone'], ['amountMonthly', 90]]),
    row(TX_BILLS, 5, 'bill-5', [
      ['kind', 'other'],
      ['amountMonthly', 35],
      ['description', 'Renter’s insurance premium paid monthly'],
    ]),
  ]);
}

// ---------------------------------------------------------------------------
// Every gateway answered No
// ---------------------------------------------------------------------------

function noIncome(): Data {
  return answerAll(base(['tx_snap', 'tx_medicaid']), [
    [Q.hasJob, false],
    [Q.selfEmployed, false],
    [Q.otherIncome, false],
    [Q.incomeVaries, false],
    [Q.hasBills, false],
    [Q.dependentCare, false],
    [Q.childSupport, false],
    [Q.medical, false],
    [Q.accounts, false],
    [Q.vehicles, false],
    [Q.realProperty, false],
    [Q.personalProperty, false],
    [Q.expeditedIncome, false],
    [Q.expeditedHousing, true],
    [Q.expeditedFarm, false],
    [Q.hasHelper, false],
  ]);
}

export const TEXAS_SCENARIOS: readonly TexasScenario[] = [
  {
    id: 'austin_single_adult',
    purpose:
      'One adult, food benefits only. No household table rows at all, and ' +
      'the mailing block must stay blank because mail comes to the home.',
    county: 'Travis',
    data: singleAdult(),
  },
  {
    id: 'austin_family_of_four',
    purpose:
      'Two adults and two children across all four Texas programs, with a ' +
      'PO-box mailing address, two jobs, child support, four bills and an ' +
      'authorized representative — every printed table populated.',
    county: 'Travis',
    data: familyOfFour(),
  },
  {
    id: 'austin_household_overflow',
    purpose:
      'Nine people and four jobs against six and three printed rows, with a ' +
      'street address and an employer name long enough to test fitting. The ' +
      'people the table cannot hold must be reported, never dropped.',
    county: 'Travis',
    data: householdOverflow(),
  },
  {
    id: 'austin_no_income',
    purpose:
      'Every income and resource gateway answered an explicit No. The No ' +
      'boxes must tick and no job, bill or other-income row may be written.',
    county: 'Travis',
    data: noIncome(),
  },
];
