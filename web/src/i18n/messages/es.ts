/**
 * Copyright 2025 Kealu Inc. All rights reserved.
 * Licensed under the Kealu Vector License v1.0 — PATENT PENDING
 */
import type en from './en';

type Messages = {
  [K in keyof typeof en]: string;
};

const es: Messages = {
  // ── page.tsx ──────────────────────────────────────────────────────────────
  page_title: 'Navegador de Beneficios',
  page_subtitle:
    'Encuentre cobertura médica y programas de beneficios para su hogar — sin necesidad de cuenta.',
  offline_banner:
    'Motor de flujo de trabajo fuera de línea — el análisis no está disponible temporalmente. Vuelva pronto.',

  // ── chat-interface.tsx ───────────────────────────────────────────────────
  chat_welcome:
    'Hola. Soy un agente de IA impulsado por Kealu Vector para ayudarle a encontrar seguro médico y programas de beneficios para su hogar.\n\nLe haré algunas preguntas para entender su situación — no se necesita información de cuenta y su información siempre permanece privada.\n\nComencemos con lo básico. ¿Cuál es su código postal?\n\n(Su código postal nos indica qué planes de salud, programas estatales, servicios del condado, clínicas y opciones de asistencia local están disponibles donde vive.)',
  chat_welcome_back: '¡Bienvenido de nuevo! Continuando desde donde quedamos.',
  chat_ready:
    'Bien — tengo suficiente información para comenzar. Iniciando el análisis ahora…',
  chat_all_set: 'Todo listo — preparado para ejecutar',
  chat_run_prompt:
    "¡Todo listo! Haga clic en 'Ejecutar análisis' a continuación o escriba algo para iniciar el análisis de beneficios.",
  chat_error_generic: '⚠ Algo salió mal. Por favor intente de nuevo.',
  chat_unable_to_start: '⚠ No se puede iniciar el análisis',
  chat_please_retry: 'por favor intente de nuevo.',
  chat_hide_answers: 'Ocultar respuestas',
  chat_edit_answers: 'Editar respuestas',
  chat_save: 'Guardar',
  chat_cancel: 'Cancelar',
  chat_edit: 'Editar',
  chat_skip: 'Omitir preguntas restantes',
  chat_starting: 'Iniciando…',
  chat_run_analysis: 'Ejecutar análisis',
  chat_placeholder: 'Escriba su respuesta… (Intro para enviar, Shift+Intro para nueva línea)',
  chat_input_aria: 'Su mensaje',
  // Contact and address validation.
  field_error_email: 'Ingrese un correo electrónico como nombre@ejemplo.com.',
  field_error_phone: 'Ingrese un número de teléfono de 10 dígitos, por ejemplo (512) 555-1234.',
  field_error_address_number: 'Ingrese la dirección incluyendo el número de la casa o del edificio.',
  field_error_address_street: 'Ingrese también el nombre de la calle, no solo el número.',
  field_error_zip: 'Ingrese un código postal de 5 dígitos, o ZIP+4 como 12345-6789.',
  field_error_city: 'Ingrese el nombre de la ciudad.',
  // Questionnaire answer validation.
  answer_error_no_question: 'No hay ninguna pregunta que responder.',
  answer_error_required: 'Ingrese una respuesta.',
  answer_error_amount: 'Ingrese una cantidad usando solo números.',
  answer_error_date: 'Ingrese una fecha válida.',
  answer_error_required_to_file: 'Esta respuesta es necesaria para presentar la solicitud.',
  // Date-of-birth validation.
  dob_error_future: 'La fecha de nacimiento no puede ser en el futuro.',
  dob_error_too_old: 'Revise esta fecha de nacimiento: es de hace más de 120 años.',
  dob_error_malformed: 'Ingrese la fecha de nacimiento con año, mes y día.',
  dob_error_too_young: 'Esta persona es demasiado joven para solicitar por su propia cuenta.',
  chat_log_aria: 'Conversación',
  chat_send: 'Enviar',
  chat_send_aria: 'Enviar mensaje',

  // ── phase-tracker.tsx ────────────────────────────────────────────────────
  phase_benefits_research: 'Investigación de beneficios',
  phase_insurance_research: 'Investigación de seguros',
  phase_evidence_verification: 'Verificación de evidencia',
  phase_eligibility_validation: 'Validación de elegibilidad',
  phase_action_plan: 'Plan de acción',
  phase_status_idle: 'Esperando',
  phase_status_running: 'Ejecutando…',
  phase_status_rerunning: 'Re-verificando…',
  phase_status_complete: 'Completo',
  phase_status_error: 'Error',
  phase_analyzing: 'Analizando su hogar…',
  phase_description:
    'Se está ejecutando un flujo de trabajo de IA de 5 fases. Esto generalmente toma de 15 a 30 minutos.',
  phase_stopping: 'Deteniendo…',
  phase_stop_edit: 'Detener y editar',
  phase_finalizing: 'Finalizando…',
  phase_running_label: 'Ejecutando',
  phase_starting: 'Iniciando…',
  phase_progress_aria: 'Progreso general del análisis',
  phase_complete_aria: 'Completo',
  phase_error_aria: 'Error',

  // ── report-view.tsx ──────────────────────────────────────────────────────
  report_bottom_line: 'Conclusión',
  report_expand: 'expandir',
  report_collapse: 'contraer',
  report_starting: 'Iniciando…',
  report_run_again: 'Ejecutar de nuevo',
  report_download_official: 'Descargar solicitud SAWS-1 parcialmente pre-llenada',
  report_download_worksheet: 'Descargar hoja de trabajo de preparación',
  report_draft_disclaimer:
    'El estado, código postal, condado y las casillas del programa están pre-llenados. Revise y complete toda la información personal (nombre, fecha de nacimiento, SSN, dirección) antes de enviar.',

  // ── error-banner.tsx ─────────────────────────────────────────────────────
  error_try_again: 'Intentar de nuevo',
  error_edit_info: 'Editar mi información',
  error_stream_lost: 'Se perdió la conexión con el flujo de análisis. Por favor intente de nuevo.',
  error_stream_connect_failed: 'No se pudo conectar al flujo de análisis. Por favor intente de nuevo.',

  // ── language-switcher.tsx ────────────────────────────────────────────────
  lang_select_aria: 'Seleccionar idioma',
  // Language names are always shown in the language itself
  lang_en: 'English',
  lang_es: 'Español',
  // ── intake-flow.ts — preguntas guiadas de admisión ───────────────────────
  intake_zip_code_label: 'Código postal',
  intake_zip_code_rationale:
    'Usamos su código postal para encontrar planes y programas de beneficios disponibles donde usted vive.',
  intake_zip_code_prompt:
    '¡Hola! Puedo ayudarle a encontrar seguro médico y programas de beneficios para su hogar.\n\n'
    + 'Le haré unas preguntas breves. Sus respuestas son privadas y no necesita crear una cuenta.\n\n'
    + '¿Cuál es su código postal?',
  intake_zip_code_placeholder: '90210',

  intake_annual_income_label: 'Ingreso anual del hogar',
  intake_annual_income_rationale:
    'Usamos esto para calcular a qué programas, descuentos y créditos tributarios podría calificar su hogar.',
  intake_annual_income_prompt:
    '¿Cuál es el ingreso total anual de su hogar antes de impuestos?',

  intake_household_profile_label: 'Miembros del hogar',
  intake_household_profile_rationale:
    'El tamaño del hogar y las edades afectan la elegibilidad y el monto de los beneficios.',
  intake_household_profile_prompt:
    '¿Quiénes deben incluirse en su hogar para efectos de beneficios?\n\n'
    + 'Inclúyase usted, su cónyuge y toda persona que declare como dependiente para los impuestos. '
    + 'Indique la edad de cada persona y mencione si hay embarazo, discapacidad o condición de veterano.\n\n'
    + 'Ejemplo: Dos adultos, de 32 y 30 años, y dos niños, de 4 y 8 años.',

  intake_current_coverage_label: 'Seguro médico actual',
  intake_current_coverage_rationale:
    'Esto nos ayuda a saber si necesita cobertura nueva o ayuda con su plan actual.',
  intake_current_coverage_prompt:
    '¿Tiene seguro médico actualmente?\n\n'
    + 'Díganos de dónde proviene, por ejemplo de un empleador, Medicaid, Medicare o COBRA. '
    + 'También puede responder “No”.',

  intake_medications_label: 'Medicamentos recetados',
  intake_medications_rationale:
    'Esto nos ayuda a buscar planes que cubran los medicamentos que usa su hogar.',
  intake_medications_prompt:
    '¿Alguien en su hogar toma medicamentos recetados con regularidad?\n\n'
    + 'Escriba los nombres de los medicamentos o responda “Ninguno”.',

  intake_providers_label: 'Médicos y especialistas',
  intake_providers_rationale:
    'Esto nos ayuda a buscar planes que incluyan a los médicos y las clínicas que usted quiere conservar.',
  intake_providers_prompt:
    '¿Hay médicos, especialistas, clínicas u hospitales que quiera seguir usando?\n\n'
    + 'Escriba sus nombres o responda “Ninguno”.',

  intake_premium_budget_label: 'Presupuesto mensual',
  intake_premium_budget_rationale:
    'Esto nos ayuda a concentrarnos en planes que su hogar realmente pueda pagar.',
  intake_premium_budget_prompt:
    '¿Cuánto es lo máximo que su hogar puede pagar al mes por el seguro médico?\n\n'
    + 'Escriba una cantidad o responda “Lo menos posible”.',

  intake_health_needs_label: 'Necesidades de atención médica',
  intake_health_needs_rationale:
    'Esto nos ayuda a encontrar cobertura que se ajuste a la atención que su hogar espera necesitar.',
  intake_health_needs_prompt:
    '¿Alguien en su hogar tiene necesidades de salud continuas o atención programada próximamente?\n\n'
    + 'Por ejemplo: enfermedades crónicas, terapia, atención del embarazo, cirugía o consultas médicas frecuentes. '
    + 'También puede responder “No”.',

  intake_error_required: 'Por favor escriba una respuesta.',
  intake_error_zip: 'Escriba un código postal válido de 5 dígitos. Por ejemplo: 19020.',
  intake_error_income_not_a_number:
    'Escriba el ingreso anual de su hogar usando solo números. Por ejemplo: 42000.',
  intake_error_income_invalid: 'Escriba un ingreso anual del hogar válido.',

  // ── Disponibilidad del formulario oficial ────────────────────────────────
  form_limitation_zh_hant_not_fillable:
    'California publica esta solicitud en chino, pero solo en chino tradicional, '
    + 'y esa edición no se puede llenar electrónicamente. Por eso su borrador es el '
    + 'formulario oficial en inglés, completado con sus respuestas. La copia oficial en '
    + 'chino se incluye junto con él para que pueda leer lo que va a firmar.',

  lang_zh_CN: '简体中文',
} as const;

export default es;
