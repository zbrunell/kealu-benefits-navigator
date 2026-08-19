/**
 * Copyright 2025 Kealu Inc. All rights reserved.
 * Licensed under the Kealu Vector License v1.0 — PATENT PENDING
 */

/**
 * English message catalog — source of truth for the Messages type shape.
 * Every key in this file must have a corresponding key in es.ts.
 */
const en = {
  // ── page.tsx ──────────────────────────────────────────────────────────────
  page_title: 'Benefits Navigator',
  page_subtitle:
    'Find health coverage and benefit programs for your household — no account required.',
  offline_banner:
    'Workflow engine offline — analysis is temporarily unavailable. Check back soon.',

  // ── chat-interface.tsx ───────────────────────────────────────────────────
  chat_welcome:
    "Hello! I am an AI Agent powered by Kealu Vector to help you find health insurance and benefit programs for your household.\n\nI'll ask a few questions to understand your situation — no account info needed, and your information always stays private.\n\nLet's start with some basics. What is your ZIP code?\n\n(Your ZIP code tells us which health plans, state programs, county services, clinics, and local assistance options are available where you live.)",
  chat_welcome_back: 'Welcome back! Picking up where we left off.',
  chat_ready: 'Great — I have enough information to get started. Launching the analysis now…',
  chat_all_set: 'All set — ready to run',
  chat_run_prompt:
    "You're all set! Click 'Run Analysis' below or type anything to kick off the benefits analysis.",
  chat_error_generic: '⚠ Something went wrong. Please try again.',
  chat_unable_to_start: '⚠ Unable to start analysis',
  chat_please_retry: 'please try again.',
  chat_hide_answers: 'Hide answers',
  chat_edit_answers: 'Edit answers',
  chat_save: 'Save',
  chat_cancel: 'Cancel',
  chat_edit: 'Edit',
  chat_skip: 'Skip remaining questions',
  chat_starting: 'Starting…',
  chat_run_analysis: 'Run Analysis',
  chat_placeholder: 'Type your answer… (Enter to send, Shift+Enter for newline)',
  chat_input_aria: 'Your message',
  // Contact and address validation.
  field_error_email: 'Enter an email address such as name@example.com.',
  field_error_phone: 'Enter a 10-digit phone number, such as (512) 555-1234.',
  field_error_address_number: 'Enter a street address including the house or building number.',
  field_error_address_street: 'Enter the street name as well as the number.',
  field_error_zip: 'Enter a 5-digit ZIP code, or ZIP+4 as 12345-6789.',
  field_error_city: 'Enter a city name.',
  // Questionnaire answer validation.
  answer_error_no_question: 'There is no question to answer.',
  answer_error_required: 'Please enter an answer.',
  answer_error_amount: 'Enter an amount using numbers only.',
  answer_error_date: 'Enter a valid date.',
  answer_error_required_to_file: 'This answer is needed to file the application.',
  // Date-of-birth validation.
  dob_error_future: 'A date of birth cannot be in the future.',
  dob_error_too_old: 'Please check this date of birth — it is more than 120 years ago.',
  dob_error_malformed: 'Enter a date of birth as year, month and day.',
  dob_error_too_young: 'This person is too young to apply on their own behalf.',
  chat_log_aria: 'Conversation',
  chat_send: 'Send',
  chat_send_aria: 'Send message',

  // ── phase-tracker.tsx ────────────────────────────────────────────────────
  phase_benefits_research: 'Benefits Research',
  phase_insurance_research: 'Insurance Research',
  phase_evidence_verification: 'Evidence Verification',
  phase_eligibility_validation: 'Eligibility Validation',
  phase_action_plan: 'Action Plan',
  phase_status_idle: 'Waiting',
  phase_status_running: 'Running…',
  phase_status_rerunning: 'Re-checking…',
  phase_status_complete: 'Complete',
  phase_status_error: 'Error',
  phase_analyzing: 'Analyzing your household…',
  phase_description: 'A 5-phase AI workflow is running. This typically takes 15–30 minutes.',
  phase_stopping: 'Stopping…',
  phase_stop_edit: 'Stop & edit',
  phase_finalizing: 'Finalizing…',
  phase_running_label: 'Running',
  phase_starting: 'Starting…',
  phase_progress_aria: 'Overall analysis progress',
  phase_complete_aria: 'Complete',
  phase_error_aria: 'Error',

  // ── report-view.tsx ──────────────────────────────────────────────────────
  report_bottom_line: 'Bottom Line',
  report_expand: 'expand',
  report_collapse: 'collapse',
  report_starting: 'Starting…',
  report_run_again: 'Run Again',
  report_download_official: 'Download partially pre-filled SAWS-1 application',
  report_download_worksheet: 'Download preparation worksheet',
  report_draft_disclaimer:
    'State, ZIP, county, and program checkboxes are pre-filled. Review and complete all personal information (name, DOB, SSN, address) before submitting.',

  // ── error-banner.tsx ─────────────────────────────────────────────────────
  error_try_again: 'Try Again',
  error_edit_info: 'Edit my information',
  error_stream_lost: 'Connection to the analysis stream was lost. Please try again.',
  error_stream_connect_failed: 'Unable to connect to the analysis stream. Please try again.',

  // ── language-switcher.tsx ────────────────────────────────────────────────
  lang_select_aria: 'Select language',
  lang_en: 'English',
  lang_es: 'Español',
  // ── intake-flow.ts — guided intake questions ─────────────────────────────
  intake_zip_code_label: 'ZIP Code',
  intake_zip_code_rationale:
    'We use your ZIP code to find plans and benefit programs available where you live.',
  intake_zip_code_prompt:
    'Hi! I can help you find health insurance and benefit programs for your household.\n\n'
    + 'I’ll ask a few short questions. Your answers stay private, and you do not need an account.\n\n'
    + 'What is your ZIP code?',
  intake_zip_code_placeholder: '90210',

  intake_annual_income_label: 'Annual Household Income',
  intake_annual_income_rationale:
    'We use this to estimate which programs, discounts, and tax credits your household may qualify for.',
  intake_annual_income_prompt:
    'What is your household’s total yearly income before taxes?',

  intake_household_profile_label: 'Household Members',
  intake_household_profile_rationale:
    'Household size and ages affect eligibility and benefit amounts.',
  intake_household_profile_prompt:
    'Who should be included in your benefits household?\n\n'
    + 'Include yourself, your spouse, and anyone you claim as a tax dependent. '
    + 'Add each person’s age and mention pregnancy, disability, or veteran status.\n\n'
    + 'Example: Two adults, ages 32 and 30, and two children, ages 4 and 8.',

  intake_current_coverage_label: 'Current Health Insurance',
  intake_current_coverage_rationale:
    'This helps us understand whether you need new coverage or help with your current plan.',
  intake_current_coverage_prompt:
    'Do you currently have health insurance?\n\n'
    + 'Tell us where it comes from, such as an employer, Medicaid, Medicare, or COBRA. '
    + 'You can also answer “No.”',

  intake_medications_label: 'Prescription Medications',
  intake_medications_rationale:
    'This helps us look for plans that cover the medicines your household uses.',
  intake_medications_prompt:
    'Does anyone in your household take prescription medication regularly?\n\n'
    + 'List the medication names, or answer “None.”',

  intake_providers_label: 'Doctors and Specialists',
  intake_providers_rationale:
    'This helps us look for plans that include the doctors and clinics you want to keep.',
  intake_providers_prompt:
    'Are there any doctors, specialists, clinics, or hospitals you want to keep using?\n\n'
    + 'List their names, or answer “None.”',

  intake_premium_budget_label: 'Monthly Budget',
  intake_premium_budget_rationale:
    'This helps us focus on plans your household can realistically afford.',
  intake_premium_budget_prompt:
    'What is the most your household can afford to pay each month for health insurance?\n\n'
    + 'Enter an amount, or answer “As low as possible.”',

  intake_health_needs_label: 'Health Care Needs',
  intake_health_needs_rationale:
    'This helps us match your household with coverage that fits the care you expect to need.',
  intake_health_needs_prompt:
    'Does anyone in your household have ongoing health needs or care planned soon?\n\n'
    + 'For example: chronic conditions, therapy, pregnancy care, surgery, or frequent doctor visits. '
    + 'You can also answer “No.”',

  intake_error_required: 'Please enter an answer.',
  intake_error_zip: 'Enter a valid 5-digit ZIP code. For example: 19020.',
  intake_error_income_not_a_number:
    'Enter your yearly household income using numbers only. For example: 42000.',
  intake_error_income_invalid: 'Enter a valid yearly household income.',

  // ── Official form availability ───────────────────────────────────────────
  form_limitation_zh_hant_not_fillable:
    'California publishes this application in Chinese, but only in Traditional Chinese, '
    + 'and that edition cannot be filled in electronically. Your draft is therefore the '
    + 'official English form, completed with your answers. The official Chinese copy is '
    + 'included alongside it so you can read what you are signing.',

  lang_zh_CN: '简体中文',
} as const;

export default en;
