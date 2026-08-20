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


  // ── saws2-question-planner.ts — texto del cuestionario ─────────────────────────────────────────────
  q_circumstances_prior_public_assistance_prompt: '¿Alguien en su hogar ha recibido antes CalFresh, CalWORKs o Medi-Cal?',
  q_circumstances_california_resident_prompt: '¿Todas las personas que solicitan viven en California y piensan quedarse?',
  q_circumstances_planned_absence_prompt: '¿Alguien piensa ausentarse de California por más de un mes?',
  q_circumstances_food_together_prompt: '¿Todas las personas de su hogar compran y preparan los alimentos juntas?',
  q_circumstances_food_together_help: 'CalFresh considera un solo hogar a las personas que comparten la compra y la preparación de alimentos.',
  q_circumstances_institutional_living_prompt: '¿Alguien vive en un refugio, una casa hogar o una institución?',
  q_circumstances_same_contact_information_prompt: '¿Todas las personas de su hogar tienen la misma información de contacto?',
  q_circumstances_same_contact_information_help: 'Si alguien tiene otro teléfono, dirección o correo electrónico, el formulario tiene espacio para anotarlos.',
  q_circumstances_health_coverage_representative_prompt: '¿Desea que alguien actúe en su nombre en la parte de cobertura médica de esta solicitud?',
  q_circumstances_health_coverage_representative_help: 'Esto es distinto de un representante para CalFresh: el formulario pregunta por ellos por separado.',
  q_circumstances_disability_limits_activities_prompt: '¿Alguien tiene una discapacidad que limite actividades diarias como bañarse, vestirse o hacer las tareas del hogar?',
  q_circumstances_needs_care_from_member_prompt: '¿Hay un niño o una persona con discapacidad que necesite cuidados de otro miembro del hogar?',
  q_circumstances_pregnant_or_teen_parent_prompt: '¿Hay alguien en el hogar embarazada o que sea madre o padre adolescente?',
  q_circumstances_cal_learn_prompt: '¿Alguien ha recibido de Cal-Learn una bonificación en efectivo, una sanción o ayuda con el cuidado de niños o el transporte?',
  q_circumstances_ever_in_foster_care_prompt: '¿Alguien del hogar estuvo alguna vez en crianza temporal?',
  q_circumstances_ever_in_foster_care_help: 'Esto se refiere al pasado: un menor en crianza temporal que viva con usted ahora es una pregunta aparte.',
  q_circumstances_ihss_prompt: '¿Alguien recibe Servicios de Apoyo en el Hogar (IHSS)?',
  q_circumstances_other_food_program_prompt: '¿Alguien participa en otro programa de alimentos?',
  q_circumstances_caretaker_relative_prompt: '¿Está solicitando para un menor que no es su hijo o hija?',
  q_income_varies_during_year_prompt: '¿Los ingresos de alguien cambian durante el año?',
  q_income_varies_during_year_help: 'Por ejemplo, trabajo de temporada, trabajo por contrato o empleo durante el año escolar.',
  q_health_retroactive_medical_prompt: '¿Necesita ayuda para pagar facturas médicas de los últimos tres meses?',
  q_health_tax_filer_prompt: '¿Piensa presentar una declaración de impuestos federales este año?',
  q_health_renewal_authorization_prompt: '¿Autoriza al condado a usar su información tributaria para renovar automáticamente su cobertura médica?',
  q_health_american_indian_prompt: '¿Alguna de las personas que solicitan es indígena estadounidense o nativa de Alaska?',
  q_resources_diversion_payment_prompt: '¿Su hogar ha recibido alguna vez un pago de desvío (diversion) de CalWORKs?',
  q_integrity_duplicate_benefits_prompt: '¿Alguien está recibiendo los mismos beneficios en más de un lugar?',
  q_integrity_trafficking_prompt: '¿Alguien ha comprado, vendido o intercambiado beneficios de CalFresh?',
  q_integrity_drugs_prompt: '¿Alguien ha intercambiado beneficios de CalFresh por drogas?',
  q_integrity_firearms_prompt: '¿Alguien ha intercambiado beneficios de CalFresh por armas de fuego, municiones o explosivos?',
  q_integrity_welfare_fraud_prompt: '¿Alguien ha sido condenado por fraude de asistencia pública?',
  q_integrity_sanction_prompt: '¿Alguien tiene actualmente una sanción por no cooperar con un programa de beneficios?',
  q_integrity_special_needs_payment_prompt: '¿Desea solicitar un pago por necesidad especial por vivienda o artículos del hogar perdidos o dañados?',
  q_integrity_special_needs_payment_help: 'Por ejemplo, artículos perdidos en un incendio, un terremoto o una inundación.',
  q_integrity_third_party_liability_prompt: '¿Alguna persona que solicita cobertura médica está involucrada en un reclamo de compensación laboral, una demanda o un acuerdo por accidente?',
  q_services_chdp_information_prompt: '¿Desea más información sobre los chequeos de CHDP para menores de 21 años?',
  q_services_chdp_information_help: 'Las respuestas a estas preguntas de servicios nunca afectan la elegibilidad.',
  q_services_chdp_medical_prompt: '¿Desea recibir servicios médicos de CHDP?',
  q_services_chdp_dental_prompt: '¿Desea recibir servicios dentales de CHDP?',
  q_services_chdp_transport_prompt: '¿Necesita ayuda para hacer citas o para llegar a los servicios de CHDP?',
  q_services_immunization_prompt: '¿Desea más información sobre los servicios de vacunación?',
  q_services_family_planning_prompt: '¿Alguien desea servicios de planificación familiar gratuitos o de bajo costo?',
  q_services_breastfeeding_prompt: '¿Está amamantando a un bebé?',
  q_circumstances_authorized_representative_prompt: '¿Desea que otra persona pueda actuar en nombre de su hogar?',
  q_circumstances_authorized_representative_help: 'Un representante autorizado puede hablar por usted en la entrevista y ayudarle con los formularios.',
  q_circumstances_military_service_prompt: '¿Alguien ha servido en las fuerzas armadas de EE. UU., o es cónyuge, madre, padre o hijo de alguien que sirvió?',
  q_circumstances_students_prompt: '¿Alguna persona que solicita asiste a una universidad o escuela vocacional?',
  q_circumstances_absent_parents_prompt: '¿Algún menor del hogar tiene una madre o un padre que viva fuera de la casa?',
  q_circumstances_foster_care_prompt: '¿Vive en su casa un menor en crianza temporal que recibe servicios de cuidado tutelar?',
  q_income_earned_prompt: '¿Alguien recibe ingresos de un empleo?',
  q_income_earned_help: 'Incluya el trabajo de medio tiempo y el temporal. El trabajo por cuenta propia se pregunta aparte.',
  q_income_self_employment_prompt: '¿Alguien trabaja por cuenta propia?',
  q_income_unearned_prompt: '¿Alguien recibe ingresos que no provienen del trabajo?',
  q_income_unearned_help: 'Por ejemplo, desempleo, discapacidad, Seguro Social, SSI, manutención de menores o jubilación.',
  q_income_in_kind_prompt: '¿Alguien recibe vivienda, servicios públicos, alimentos o ropa gratis o a cambio de trabajo?',
  q_income_recent_job_change_prompt: '¿Alguien ha perdido un empleo o ha tenido cambios en sus horas de trabajo recientemente?',
  q_expenses_household_prompt: '¿Su hogar paga renta, hipoteca o servicios públicos?',
  q_expenses_household_help: 'Los gastos de vivienda y servicios públicos pueden aumentar su beneficio de CalFresh.',
  q_expenses_dependent_care_prompt: '¿Alguien paga por el cuidado de niños o por el cuidado de un adulto dependiente?',
  q_expenses_child_support_paid_prompt: '¿Alguien paga manutención de menores?',
  q_expenses_spousal_support_paid_prompt: '¿Alguien está legalmente obligado a pagar pensión alimenticia o manutención conyugal?',
  q_expenses_other_tax_deductible_prompt: '¿Alguien tiene otros gastos que deduce en sus impuestos?',
  q_health_current_coverage_prompt: '¿Alguien tiene seguro médico actualmente?',
  q_health_coverage_ending_prompt: '¿La cobertura médica de alguien está por terminar?',
  q_health_employer_coverage_prompt: '¿Alguien tiene un empleo que ofrece cobertura médica?',
  q_health_employer_coverage_help: 'Esto agrega el Apéndice A a su solicitud.',
  q_resources_accounts_prompt: '¿Alguien tiene efectivo, una cuenta bancaria u otros ahorros?',
  q_resources_vehicles_prompt: '¿Alguien es dueño de un vehículo o usa uno?',
  q_resources_real_property_prompt: '¿Alguien es dueño de una casa, un terreno u otra propiedad?',
  q_resources_transferred_prompt: '¿Alguien ha vendido, intercambiado o regalado bienes en los últimos 30 meses?',
  q_household_applicant_name_prompt: 'Necesitamos el nombre y el apellido del solicitante.',
  q_household_applicant_dob_prompt: 'Necesitamos la fecha de nacimiento del solicitante.',
  q_services_gave_birth_recently_prompt: '¿Ha dado a luz en los últimos 12 meses?',
  q_services_gave_birth_recently_help: 'Esto podría calificar a su hogar para WIC.',
  q_services_pregnancy_assistance_prompt: '¿Desea hablar con alguien sobre cómo encontrar un médico y alimentos saludables durante el embarazo?',
  q_circumstances_elderly_separate_meals_prompt: '¿Vive con usted alguien de 60 años o más que no pueda comprar alimentos ni preparar comidas por separado a causa de una discapacidad?',
  q_circumstances_elderly_separate_meals_who_prompt: '¿Quién es esa persona?',
  q_health_tax_filer_person_prompt: '¿Quién piensa presentar una declaración de impuestos federales?',
  q_health_spouse_filing_jointly_prompt: '¿Su cónyuge presentará la declaración conjuntamente con usted?',
  q_health_spouse_filing_jointly_help: 'Un dependiente para efectos tributarios no tiene que vivir con usted: puede declarar a alguien que viva en otro lugar.',
  q_health_spouse_name_prompt: '¿Cuál es el nombre de su cónyuge?',
  q_health_spouse_name_help: 'Un dependiente para efectos tributarios no tiene que vivir con usted: puede declarar a alguien que viva en otro lugar.',
  q_health_tax_dependents_prompt: '¿Esta persona declarará dependientes en su declaración de impuestos?',
  q_health_tax_dependents_help: 'Un dependiente para efectos tributarios no tiene que vivir con usted: puede declarar a alguien que viva en otro lugar.',
  q_health_tax_dependents_records_prompt: '¿A quién declarará como dependiente?',
  q_integrity_fleeing_felon_who_prompt: '¿A quién del hogar le afecta esto?',
  q_integrity_probation_who_prompt: '¿A quién del hogar le afecta esto?',
  q_integrity_special_needs_explanation_prompt: 'Explique qué se perdió o se dañó.',
  q_integrity_third_party_who_prompt: '¿Quién está involucrado en el reclamo o el acuerdo?',
  q_integrity_fleeing_felon_prompt: '¿Alguien del hogar se esconde o huye de la justicia por un cargo de delito grave?',
  q_integrity_probation_violation_prompt: '¿Un tribunal ha determinado que alguien del hogar está violando su libertad condicional o su libertad bajo palabra?',
  q_preferences_in_person_interview_prompt: '¿Prefiere una entrevista en persona para CalFresh?',
  q_preferences_interview_disability_arrangements_prompt: '¿Necesita otros arreglos para la entrevista debido a una discapacidad?',
  q_expenses_special_needs_person_prompt: '¿Quién tiene la necesidad especial y cuál es?',
  q_expenses_special_needs_other_description_prompt: '¿Cuál es la otra necesidad especial?',
  q_circumstances_disability_details_records_prompt: '¿Quién tiene la discapacidad?',
  q_resources_personal_property_prompt: '¿Alguien posee bienes personales o de negocio?',
  q_resources_personal_property_help: 'Por ejemplo, herramientas, equipo o inventario de negocio, ganado, un camper, una embarcación sin motor o un remolque, equipo deportivo o armas, o joyas, obras de arte o colecciones.',
  q_resources_personal_property_records_prompt: 'Cuéntenos sobre cada artículo',
  q_resources_personal_property_records_help: 'El Apéndice E pide el dueño, el valor y el uso de cada vehículo.',
  q_appendices_vehicle_details_records_prompt: 'Cuéntenos sobre cada vehículo',
  q_appendices_vehicle_details_records_help: 'El Apéndice E pide el dueño, el valor y el uso de cada vehículo.',
  q_appendices_tribal_membership_records_prompt: '¿Quién es indígena estadounidense o nativo de Alaska?',
  q_expenses_medical_prompt: '¿Alguien de 60 años o más, o con una discapacidad, tiene gastos médicos que paga de su bolsillo?',
  q_expenses_medical_records_prompt: 'Agregue cada gasto médico',
  q_appendices_tribal_name_prompt: '¿Cuál es el nombre de la tribu?',
  q_appendices_tribal_name_help: 'La asistencia monetaria pide el historial de empleo cuando solicitan dos o más adultos.',
  q_appendices_employment_history_prompt: '¿Puede contarnos sobre el empleo reciente de cada adulto que solicita asistencia monetaria?',
  q_appendices_employment_history_help: 'La asistencia monetaria pide el historial de empleo cuando solicitan dos o más adultos.',
  q_appendices_employment_history_records_prompt: 'Cuéntenos sobre cada empleo de los últimos dos años',
  q_appendices_employment_history_records_help: 'El Apéndice D pide el empleador, las fechas trabajadas, el pago y el motivo por el que terminó cada empleo.',


  // ── Elementos del cuestionario ────────────────────────────────────────────────
  section_title_household: 'Solicitante y hogar',
  section_title_circumstances: 'Circunstancias del hogar',
  section_title_income: 'Ingresos',
  section_title_expenses: 'Gastos',
  section_title_health: 'Cobertura médica e impuestos',
  section_title_resources: 'Recursos y bienes',
  section_title_integrity: 'Historial de programas',
  section_title_appendices: 'Formularios adicionales',
  requirement_label_required: 'Obligatorio para continuar',
  requirement_label_important: 'Ayuda a determinar sus beneficios',
  requirement_label_can_complete_later: 'Puede completarlo después',
  requirement_label_optional: 'Opcional',
  requirement_hint_required: 'Necesitamos esto antes de continuar.',
  requirement_hint_important: 'Responder ayuda al Condado a procesar su solicitud más rápido y a determinar a qué tiene derecho.',
  requirement_hint_can_complete_later: 'Puede dejarlo en blanco por ahora. Es posible que el Condado lo necesite más adelante.',
  requirement_hint_optional: 'El formulario lo considera opcional: no afecta la elegibilidad.',
  questionnaire_all_answered: 'Ya está contestado todo lo que necesitamos',

  lang_zh_CN: '简体中文',
  // ── questionnaire-step.tsx (localization pass) ────────────────────────────
  qstep_not_answered_yet: 'Sin responder',
  qstep_not_answered_option: 'Sin responder',
  qstep_who_is_this_for: '¿Para quién es esto?',
  qstep_everyone_has_entry: 'Todas las personas de su hogar ya tienen una entrada aquí.',
  qstep_add_entry: 'Agregar entrada',
  qstep_extra_pages: 'Páginas adicionales que agregaron sus respuestas',
  qstep_next_question: 'Siguiente pregunta',
  qstep_skip_for_now: 'Omitir por ahora',
  qstep_skip_explanation: 'Omitir por ahora. Esto quedará en blanco en su borrador — no se responde “No” — y puede que deba completarse antes de enviar la solicitud.',
  qstep_skip_tooltip: 'Este campo quedará en blanco en su borrador. Puede que deba completarlo más adelante.',
  qstep_progress_aria: 'Progreso de la solicitud',

  // ── questionnaire-step.tsx: counted and numbered strings ──────────────────
  qstep_questions_left_one: 'Queda {count} pregunta',
  qstep_questions_left_other: 'Quedan {count} preguntas',
  qstep_entry_number: 'Entrada {number}',

  // ── completion guide ──────────────────────────────────────────────────────
  guide_title_applicant: 'Cómo terminar y enviar su solicitud SAWS 2 PLUS',
  guide_title_associate: 'SAWS 2 PLUS — lo que aún necesita este borrador',
  guide_note_applicant: 'Su borrador SAWS 2 PLUS se completó con sus respuestas. Esta guía indica todo lo que falta hacer antes de enviarlo.',
  guide_note_associate: 'Para la persona que ayuda con esta solicitud. Cada espacio en blanco indica su página del PDF, la etiqueta impresa al pie de esa página y la pregunta impresa, para que no haya que buscar nada.',
  guide_label_applicant: 'Solicitante',
  guide_label_county: 'Condado',
  guide_label_draft_reference: 'Referencia del borrador',
  guide_label_generated: 'Generado',
  guide_label_goes_with: 'Corresponde a',
  guide_label_answers_filled: 'Respuestas completadas',
  guide_footer: 'Esta guía describe un borrador generado. Si cambia sus respuestas y genera un borrador nuevo, imprima también la guía nueva — la referencia del borrador que aparece arriba es cómo se distinguen. Kealu nunca escribe un número de Seguro Social ni una firma en un formulario.',
  guide_location_pdf_page: 'Página {page} del PDF',
  guide_form_language_notice_en_form: 'El formulario en sí está impreso en inglés. Esta guía está en su idioma y todas las referencias a continuación remiten al formulario en inglés que usted tiene.',

} as const;

export default es;
