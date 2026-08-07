import type { Saws2PlusApplicationData } from "@/types/application";

export interface ApplicationFieldPlanEntry {
  field_name: string;
  value: string | boolean | number | null;
}

function mapApplicant(
  application: Saws2PlusApplicationData,
): ApplicationFieldPlanEntry[] {
  const applicant = application.applicant;

  return [
    {
      field_name: "first_name",
      value: applicant.firstName,
    },
    {
      field_name: "middle_name",
      value: applicant.middleName,
    },
    {
      field_name: "last_name",
      value: applicant.lastName,
    },
    {
      field_name: "date_of_birth",
      value: applicant.dateOfBirth,
    },
  ];
}

export function buildApplicationFieldPlan(
  application: Saws2PlusApplicationData,
): ApplicationFieldPlanEntry[] {
  return [
    ...mapApplicant(application),
  ];
}