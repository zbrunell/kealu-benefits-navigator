import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  buildApplicationFieldPlan,
} from '@/lib/application-mapper';

import {
  EMPTY_APPLICATION_DATA,
  type Saws2PlusApplicationData,
} from '@/types/application';

function application(): Saws2PlusApplicationData {
  return {
    ...EMPTY_APPLICATION_DATA,

    selectedPrograms: [
      'medi_cal',
      'calfresh',
    ],

    annualHouseholdIncome: 42000,
    incomeType: 'employed',
    existingBenefits: 'none',

    applicant: {
      ...EMPTY_APPLICATION_DATA.applicant,

      firstName: 'Ada',
      middleName: 'M',
      lastName: 'Lovelace',
      dateOfBirth: '1990-12-10',

      phone: '555-111-2222',
      email: 'ada@example.test',
      preferredLanguage: 'Spanish',

      homeAddress: {
        street: '1 Main St',
        apartment: '2A',
        city: 'Los Angeles',
        state: 'CA',
        zipCode: '90001',
      },

      mailingAddressSameAsHome:
        true,

      mailingAddress: {
        street: '',
        apartment: '',
        city: '',
        state: 'CA',
        zipCode: '',
      },
    },

    householdMembers: [
      {
        id: 'member-1',
        firstName: 'Grace',
        middleName: '',
        lastName: 'Hopper',
        dateOfBirth: '2015-01-01',
        relationshipToApplicant:
          'child',
      },
    ],
  };
}

describe(
  'buildApplicationFieldPlan()',
  () => {
    it(
      'maps applicant, address, county, household, financial, and program data canonically',
      () => {
        const plan =
          buildApplicationFieldPlan(
            application(),
            {
              county:
                'Los Angeles',
            },
          );

        const values =
          Object.fromEntries(
            plan.map(
              ({
                key,
                value,
              }) => [
                key,
                value,
              ],
            ),
          );

        expect(
          values[
            'applicant.first_name'
          ],
        ).toBe('Ada');

        expect(
          values[
            'applicant.home_address.county'
          ],
        ).toBe(
          'Los Angeles',
        );

        expect(
          values[
            'applicant.mailing_address.street'
          ],
        ).toBe(
          '1 Main St',
        );

        expect(
          values[
            'household.members.0.first_name'
          ],
        ).toBe(
          'Grace',
        );

        expect(
          values[
            'household.annual_income'
          ],
        ).toBe(
          42000,
        );

        expect(
          values[
            'programs.medi_cal'
          ],
        ).toBe(
          true,
        );

        expect(
          values[
            'programs.calfresh'
          ],
        ).toBe(
          true,
        );
      },
    );

    it(
      'uses an explicitly different mailing address',
      () => {
        const data =
          application();

        data.applicant
          .mailingAddressSameAsHome =
          false;

        data.applicant
          .mailingAddress = {
          street:
            'PO Box 10',
          apartment: '',
          city: 'Pasadena',
          state: 'CA',
          zipCode: '91101',
        };

        const values =
          Object.fromEntries(
            buildApplicationFieldPlan(
              data,
              {
                county:
                  'Los Angeles',
              },
            ).map(
              ({
                key,
                value,
              }) => [
                key,
                value,
              ],
            ),
          );

        expect(
          values[
            'applicant.mailing_address.street'
          ],
        ).toBe(
          'PO Box 10',
        );

        expect(
          values[
            'applicant.mailing_address.city'
          ],
        ).toBe(
          'Pasadena',
        );
      },
    );

    it(
      'omits blank and null values but keeps false and zero',
      () => {
        const data =
          application();

        data.applicant.middleName =
          '';

        data.annualHouseholdIncome =
          0;

        data.applicant
          .mailingAddressSameAsHome =
          false;

        const plan =
          buildApplicationFieldPlan(
            data,
          );

        const values =
          Object.fromEntries(
            plan.map(
              ({
                key,
                value,
              }) => [
                key,
                value,
              ],
            ),
          );

        expect(
          values,
        ).not.toHaveProperty(
          'applicant.middle_name',
        );

        expect(
          values[
            'applicant.mailing_address_same_as_home'
          ],
        ).toBe(
          false,
        );

        expect(
          values[
            'household.annual_income'
          ],
        ).toBe(
          0,
        );
      },
    );

    it(
      'never emits SSN or signature semantic keys',
      () => {
        const keys =
          buildApplicationFieldPlan(
            application(),
          ).map(
            ({ key }) =>
              key.toLowerCase(),
          );

        expect(
          keys.some(
            (key) =>
              key.includes(
                'ssn',
              ),
          ),
        ).toBe(false);

        expect(
          keys.some(
            (key) =>
              key.includes(
                'social_security',
              ),
          ),
        ).toBe(false);

        expect(
          keys.some(
            (key) =>
              key.includes(
                'signature',
              ),
          ),
        ).toBe(false);
      },
    );
  },
);