/**
 * Copyright 2025 Kealu Inc. All rights reserved.
 * Licensed under the Kealu Vector License v1.0 — PATENT PENDING
 */

import type { Messages } from '@/i18n';

const zhCN: Messages = {
  page_title: '福利导航器',
  page_subtitle:
    '为您的家庭查找医疗保险和福利项目 — 无需创建账户。',
  offline_banner:
    '工作流引擎离线 — 分析暂时不可用。请稍后再试。',

  chat_welcome:
    '您好。我是由 Kealu Vector 提供支持的 AI 助手，可以帮助您为家庭寻找医疗保险和福利项目。\n\n我会询问几个问题来了解您的情况 — 无需账户信息，您的信息始终保持私密。\n\n让我们从基础信息开始。您的邮政编码是多少？\n\n（您的邮政编码可以帮助我们确定您所在地区可用的健康计划、州项目、县服务、诊所和本地援助选项。）',
  chat_welcome_back: '欢迎回来！让我们从上次的位置继续。',
  chat_ready: '很好 — 我已有足够的信息开始。正在启动分析…',
  chat_all_set: '全部完成 — 可以开始运行',
  chat_run_prompt:
    '全部完成！点击下面的“运行分析”或输入任意内容开始福利分析。',
  chat_error_generic: '⚠ 出现问题。请重试。',
  chat_unable_to_start: '⚠ 无法启动分析',
  chat_please_retry: '请重试。',
  chat_hide_answers: '隐藏答案',
  chat_edit_answers: '编辑答案',
  chat_save: '保存',
  chat_cancel: '取消',
  chat_edit: '编辑',
  chat_skip: '跳过剩余问题',
  chat_starting: '正在启动…',
  chat_run_analysis: '运行分析',
  chat_placeholder: '输入您的回答…（Enter 发送，Shift+Enter 换行）',
  chat_input_aria: '您的消息',
  // Contact and address validation.
  field_error_email: '请输入电子邮件地址，例如 name@example.com。',
  field_error_phone: '请输入 10 位电话号码，例如 (512) 555-1234。',
  field_error_address_number: '请输入街道地址，并包含门牌号或楼号。',
  field_error_address_street: '请同时填写街道名称，而不只是号码。',
  field_error_zip: '请输入 5 位邮政编码，或 12345-6789 形式的 ZIP+4。',
  field_error_city: '请输入城市名称。',
  // Questionnaire answer validation.
  answer_error_no_question: '没有需要回答的问题。',
  answer_error_required: '请填写答案。',
  answer_error_amount: '请仅使用数字填写金额。',
  answer_error_date: '请填写有效日期。',
  answer_error_required_to_file: '提交申请需要此答案。',
  // Date-of-birth validation.
  dob_error_future: '出生日期不能是将来的日期。',
  dob_error_too_old: '请核对该出生日期：距今已超过 120 年。',
  dob_error_malformed: '请按年、月、日填写出生日期。',
  dob_error_too_young: '此人年龄过小，无法本人提出申请。',
  chat_log_aria: '对话',
  chat_send: '发送',
  chat_send_aria: '发送消息',

  phase_benefits_research: '福利研究',
  phase_insurance_research: '保险研究',
  phase_evidence_verification: '证据验证',
  phase_eligibility_validation: '资格验证',
  phase_action_plan: '行动计划',
  phase_status_idle: '等待中',
  phase_status_running: '运行中…',
  phase_status_rerunning: '重新检查中…',
  phase_status_complete: '完成',
  phase_status_error: '错误',
  phase_analyzing: '正在分析您的家庭情况…',
  phase_description:
    '正在运行一个 5 阶段 AI 工作流。通常需要 15–30 分钟。',
  phase_stopping: '正在停止…',
  phase_stop_edit: '停止并编辑',
  phase_finalizing: '正在完成…',
  phase_running_label: '运行中',
  phase_starting: '正在启动…',
  phase_progress_aria: '整体分析进度',
  phase_complete_aria: '完成',
  phase_error_aria: '错误',

  report_bottom_line: '总结',
  report_expand: '展开',
  report_collapse: '收起',
  report_starting: '正在启动…',
  report_run_again: '再次运行',
  report_download_official: '下载部分预填SAWS-1申请表',
  report_download_worksheet: '下载准备工作表',
  report_draft_disclaimer:
    '州、邮政编码、县和项目复选框已预填。请在提交前检查并填写所有个人信息（姓名、出生日期、社会安全号码、地址）。',

  error_try_again: '重试',
  error_edit_info: '编辑我的信息',
  error_stream_lost: '与分析流的连接已断开。请重试。',
  error_stream_connect_failed: '无法连接到分析流。请重试。',

  lang_select_aria: '选择语言',
  lang_en: 'English',
  lang_es: 'Español',
  // ── intake-flow.ts — 引导式信息收集问题 ────────────────────────────────────
  intake_zip_code_label: '邮政编码',
  intake_zip_code_rationale:
    '我们通过您的邮政编码查找您居住地可以申请的保险计划和福利项目。',
  intake_zip_code_prompt:
    '您好！我可以帮助您为家庭寻找医疗保险和福利项目。\n\n'
    + '我会问几个简短的问题。您的回答将保密，也无需注册账户。\n\n'
    + '请问您的邮政编码是多少？',
  intake_zip_code_placeholder: '90210',

  intake_annual_income_label: '家庭年收入',
  intake_annual_income_rationale:
    '我们用这项信息估算您的家庭可能符合哪些项目、优惠和税收抵免的资格。',
  intake_annual_income_prompt: '您家庭税前的全年总收入是多少？',

  intake_household_profile_label: '家庭成员',
  intake_household_profile_rationale: '家庭人数和年龄会影响资格和福利金额。',
  intake_household_profile_prompt:
    '在申请福利时，您的家庭应包括哪些人？\n\n'
    + '请包括您本人、您的配偶，以及您在报税时申报为受抚养人的任何人。'
    + '请写明每个人的年龄，并说明是否有怀孕、残疾或退伍军人身份。\n\n'
    + '例如：两名成人，32 岁和 30 岁；两名儿童，4 岁和 8 岁。',

  intake_current_coverage_label: '目前的医疗保险',
  intake_current_coverage_rationale:
    '这有助于我们了解您是需要新的保险，还是需要现有计划方面的帮助。',
  intake_current_coverage_prompt:
    '您目前有医疗保险吗？\n\n'
    + '请告诉我们保险的来源，例如雇主、Medicaid、Medicare 或 COBRA。您也可以回答“没有”。',

  intake_medications_label: '处方药',
  intake_medications_rationale:
    '这有助于我们寻找能够覆盖您家庭所用药物的保险计划。',
  intake_medications_prompt:
    '您家中是否有人经常服用处方药？\n\n请列出药物名称，或回答“没有”。',

  intake_providers_label: '医生和专科医生',
  intake_providers_rationale:
    '这有助于我们寻找包含您希望继续就诊的医生和诊所的保险计划。',
  intake_providers_prompt:
    '有没有您希望继续就诊的医生、专科医生、诊所或医院？\n\n请列出名称，或回答“没有”。',

  intake_premium_budget_label: '每月预算',
  intake_premium_budget_rationale:
    '这有助于我们优先考虑您家庭实际负担得起的保险计划。',
  intake_premium_budget_prompt:
    '您家庭每月最多能为医疗保险支付多少钱？\n\n请填写金额，或回答“越低越好”。',

  intake_health_needs_label: '医疗保健需求',
  intake_health_needs_rationale:
    '这有助于我们为您的家庭匹配符合预期医疗需求的保险。',
  intake_health_needs_prompt:
    '您家中是否有人有长期的健康需求，或近期已安排的医疗？\n\n'
    + '例如：慢性病、康复治疗、孕期护理、手术或经常就诊。您也可以回答“没有”。',

  intake_error_required: '请填写答案。',
  intake_error_zip: '请填写有效的 5 位邮政编码。例如：19020。',
  intake_error_income_not_a_number: '请只用数字填写家庭年收入。例如：42000。',
  intake_error_income_invalid: '请填写有效的家庭年收入。',

  // ── 官方表格的语言版本 ─────────────────────────────────────────────────────
  form_limitation_zh_hant_not_fillable:
    '加州确实以中文发布这份申请表，但只有繁体中文版本，'
    + '而该版本无法通过电子方式填写。因此，您的草稿使用的是官方英文表格，'
    + '其中已填入您的答案。官方中文版本会一并提供，方便您阅读所签署的内容。',


  // ── saws2-question-planner.ts — 问卷问题文本 ─────────────────────────────────────────────
  q_circumstances_prior_public_assistance_prompt: '您家中是否有人以前领取过 CalFresh、CalWORKs 或 Medi-Cal？',
  q_circumstances_california_resident_prompt: '所有申请人是否都居住在加州并打算继续留在加州？',
  q_circumstances_planned_absence_prompt: '是否有人计划离开加州超过一个月？',
  q_circumstances_food_together_prompt: '您家中所有人是否一起购买和准备食物？',
  q_circumstances_food_together_help: 'CalFresh 将共同购买和烹饪食物的人视为一个家庭。',
  q_circumstances_institutional_living_prompt: '是否有人住在收容所、集体宿舍或福利机构？',
  q_circumstances_same_contact_information_prompt: '您家中所有人的联系方式是否相同？',
  q_circumstances_same_contact_information_help: '如果有人的电话、地址或电子邮箱不同，表格中留有填写的位置。',
  q_circumstances_health_coverage_representative_prompt: '在本申请的医疗保险部分，您是否希望由他人代表您办理？',
  q_circumstances_health_coverage_representative_help: '这与 CalFresh 的代表不同 — 表格中分别询问这两者。',
  q_circumstances_disability_limits_activities_prompt: '是否有人因残疾而在日常活动上受到限制，例如洗澡、穿衣或做家务？',
  q_circumstances_needs_care_from_member_prompt: '家中是否有儿童或残疾人需要其他家庭成员照顾？',
  q_circumstances_pregnant_or_teen_parent_prompt: '家中是否有人怀孕，或是未成年父母？',
  q_circumstances_cal_learn_prompt: '是否有人从 Cal-Learn 领取过现金奖励、受到过处罚，或获得过托儿或交通方面的帮助？',
  q_circumstances_ever_in_foster_care_prompt: '家中是否有人曾经接受过寄养？',
  q_circumstances_ever_in_foster_care_help: '这是指过去的情况 — 目前与您同住的寄养儿童是另一个问题。',
  q_circumstances_ihss_prompt: '是否有人正在领取居家支援服务（IHSS）？',
  q_circumstances_other_food_program_prompt: '是否有人参加了其他food援助项目？',
  q_circumstances_caretaker_relative_prompt: '您是否在为并非您亲生子女的儿童提出申请？',
  q_income_varies_during_year_prompt: '是否有人的收入在一年当中会发生变化？',
  q_income_varies_during_year_help: '例如季节性工作、合同工作或按学年计的工作。',
  q_health_retroactive_medical_prompt: '您是否需要帮助支付过去三个月的医疗账单？',
  q_health_tax_filer_prompt: '您今年是否打算提交联邦所得税申报表？',
  q_health_renewal_authorization_prompt: '您是否允许县政府使用您的报税信息自动为您续保医疗保险？',
  q_health_american_indian_prompt: '申请人中是否有美洲印第安人或阿拉斯加原住民？',
  q_resources_diversion_payment_prompt: '您的家庭是否曾领取过 CalWORKs 的分流补助金？',
  q_integrity_duplicate_benefits_prompt: '是否有人在多个地方领取同样的福利？',
  q_integrity_trafficking_prompt: '是否有人买卖或交换过 CalFresh 福利？',
  q_integrity_drugs_prompt: '是否有人用 CalFresh 福利换取毒品？',
  q_integrity_firearms_prompt: '是否有人用 CalFresh 福利换取枪支、弹药或爆炸物？',
  q_integrity_welfare_fraud_prompt: '是否有人曾因福利欺诈被定罪？',
  q_integrity_sanction_prompt: '是否有人目前因未配合福利项目而受到处罚？',
  q_integrity_special_needs_payment_prompt: '您是否想申请针对住房或家庭用品损失或损坏的特殊需求补助？',
  q_integrity_special_needs_payment_help: '例如因火灾、地震或洪水而损失的物品。',
  q_integrity_third_party_liability_prompt: '申请医疗保险的人当中，是否有人涉及工伤赔偿、诉讼或事故和解？',
  q_services_chdp_information_prompt: '您是否想了解更多关于 21 岁以下儿童 CHDP 体检的信息？',
  q_services_chdp_information_help: '这些服务类问题的回答不会影响您的资格。',
  q_services_chdp_medical_prompt: '您是否需要 CHDP 医疗服务？',
  q_services_chdp_dental_prompt: '您是否需要 CHDP 牙科服务？',
  q_services_chdp_transport_prompt: '您是否需要帮助预约或前往 CHDP 服务地点？',
  q_services_immunization_prompt: '您是否想了解更多关于疫苗接种服务的信息？',
  q_services_family_planning_prompt: '是否有人需要免费或低费用的计划生育服务？',
  q_services_breastfeeding_prompt: '您目前是否在哺乳？',
  q_circumstances_authorized_representative_prompt: '您是否希望由他人代表您的家庭办理事务？',
  q_circumstances_authorized_representative_help: '授权代表可以在面谈时代表您发言，并协助您填写表格。',
  q_circumstances_military_service_prompt: '是否有人曾在美国军队服役，或是服役人员的配偶、父母或子女？',
  q_circumstances_students_prompt: '申请人中是否有人正在就读大学或职业学校？',
  q_circumstances_absent_parents_prompt: '家中是否有儿童的父母一方不与其同住？',
  q_circumstances_foster_care_prompt: '您家中是否住着正在接受寄养服务的寄养儿童？',
  q_income_earned_prompt: '是否有人有工作收入？',
  q_income_earned_help: '包括兼职和临时工作。自雇收入将单独询问。',
  q_income_self_employment_prompt: '是否有人自雇经营？',
  q_income_unearned_prompt: '是否有人有非工作来源的收入？',
  q_income_unearned_help: '例如失业金、残疾补助、社会安全金、SSI、子女抚养费或退休金。',
  q_income_in_kind_prompt: '是否有人免费获得或以劳动换取住房、水电、食物或衣物？',
  q_income_recent_job_change_prompt: '最近是否有人失业或工作时数发生变化？',
  q_expenses_household_prompt: '您的家庭是否支付房租、房贷或水电费？',
  q_expenses_household_help: '住房和水电支出可能会提高您的 CalFresh 福利金额。',
  q_expenses_dependent_care_prompt: '是否有人支付托儿费用，或照顾需要看护的成年人的费用？',
  q_expenses_child_support_paid_prompt: '是否有人支付子女抚养费？',
  q_expenses_spousal_support_paid_prompt: '是否有人依法必须支付配偶赡养费？',
  q_expenses_other_tax_deductible_prompt: '是否有人有其他可以在报税时扣除的支出？',
  q_health_current_coverage_prompt: '目前是否有人拥有医疗保险？',
  q_health_coverage_ending_prompt: '是否有人的医疗保险即将到期？',
  q_health_employer_coverage_prompt: '是否有人的工作提供医疗保险？',
  q_health_employer_coverage_help: '这会在您的申请中加入附录 A。',
  q_resources_accounts_prompt: '是否有人有现金、银行账户或其他储蓄？',
  q_resources_vehicles_prompt: '是否有人拥有或使用车辆？',
  q_resources_real_property_prompt: '是否有人拥有房屋、土地或其他房地产？',
  q_resources_transferred_prompt: '在过去 30 个月内，是否有人出售、交换或赠送过财产？',
  q_household_applicant_name_prompt: '我们需要申请人的名字和姓氏。',
  q_household_applicant_dob_prompt: '我们需要申请人的出生日期。',
  q_services_gave_birth_recently_prompt: '您在过去 12 个月内是否分娩过？',
  q_services_gave_birth_recently_help: '这可能使您的家庭符合 WIC 的资格。',
  q_services_pregnancy_assistance_prompt: '您是否想与专人谈谈孕期如何寻找医生和健康饮食？',
  q_circumstances_elderly_separate_meals_prompt: '与您同住的人当中，是否有 60 岁及以上、因残疾而无法单独购买食物和做饭的人？',
  q_circumstances_elderly_separate_meals_who_prompt: '这位是谁？',
  q_health_tax_filer_person_prompt: '谁打算提交联邦所得税申报表？',
  q_health_spouse_filing_jointly_prompt: '您的配偶是否会与您联合报税？',
  q_health_spouse_filing_jointly_help: '税务上的受抚养人不一定与您同住 — 您可以申报住在别处的人。',
  q_health_spouse_name_prompt: '您配偶的姓名是什么？',
  q_health_spouse_name_help: '税务上的受抚养人不一定与您同住 — 您可以申报住在别处的人。',
  q_health_tax_dependents_prompt: '此人是否会在报税时申报受抚养人？',
  q_health_tax_dependents_help: '税务上的受抚养人不一定与您同住 — 您可以申报住在别处的人。',
  q_health_tax_dependents_records_prompt: '谁会被申报为受抚养人？',
  q_integrity_fleeing_felon_who_prompt: '家中的哪位成员涉及此情况？',
  q_integrity_probation_who_prompt: '家中的哪位成员涉及此情况？',
  q_integrity_special_needs_explanation_prompt: '请说明损失或损坏了什么。',
  q_integrity_third_party_who_prompt: '谁涉及该索赔或和解？',
  q_integrity_fleeing_felon_prompt: '家中是否有人因重罪指控而躲藏或逃避法律？',
  q_integrity_probation_violation_prompt: '法院是否认定家中有人违反缓刑或假释规定？',
  q_preferences_in_person_interview_prompt: '对于 CalFresh，您是否更希望进行当面面谈？',
  q_preferences_interview_disability_arrangements_prompt: '您是否因残疾而需要面谈方面的其他安排？',
  q_expenses_special_needs_person_prompt: '谁有特殊需求？是什么需求？',
  q_expenses_special_needs_other_description_prompt: '其他特殊需求是什么？',
  q_circumstances_disability_details_records_prompt: '谁有残疾？',
  q_resources_personal_property_prompt: '是否有人拥有个人财产或经营性财产？',
  q_resources_personal_property_help: '例如工具、经营设备或存货、牲畜、车顶篷、无动力船只或拖车、运动器材或枪支，以及珠宝、艺术品或收藏品。',
  q_resources_personal_property_records_prompt: '请介绍每一件物品',
  q_resources_personal_property_records_help: '附录 E 需要填写每辆车的车主、价值和用途。',
  q_appendices_vehicle_details_records_prompt: '请介绍每一辆车',
  q_appendices_vehicle_details_records_help: '附录 E 需要填写每辆车的车主、价值和用途。',
  q_appendices_tribal_membership_records_prompt: '谁是美洲印第安人或阿拉斯加原住民？',
  q_expenses_medical_prompt: '60 岁及以上人士或残疾人士当中，是否有人有自付的医疗支出？',
  q_expenses_medical_records_prompt: '请添加每一项医疗支出',
  q_appendices_tribal_name_prompt: '部落的名称是什么？',
  q_appendices_tribal_name_help: '当有两名或以上成年人申请现金补助时，需要填写就业经历。',
  q_appendices_employment_history_prompt: '您能否介绍每位申请现金补助的成年人近期的就业情况？',
  q_appendices_employment_history_help: '当有两名或以上成年人申请现金补助时，需要填写就业经历。',
  q_appendices_employment_history_records_prompt: '请介绍过去两年中的每一份工作',
  q_appendices_employment_history_records_help: '附录 D 需要填写雇主、工作起止日期、薪酬，以及每份工作结束的原因。',


  // ── 问卷界面文本 ────────────────────────────────────────────────
  section_title_household: '申请人与家庭',
  section_title_circumstances: '家庭情况',
  section_title_income: '收入',
  section_title_expenses: '支出',
  section_title_health: '医疗保险与税务',
  section_title_resources: '资源与财产',
  section_title_integrity: '项目记录',
  section_title_appendices: '附加表格',
  requirement_label_required: '必须填写才能继续',
  requirement_label_important: '有助于确定您的福利',
  requirement_label_can_complete_later: '可以稍后填写',
  requirement_label_optional: '可选填',
  requirement_hint_required: '我们需要这项信息才能继续。',
  requirement_hint_important: '填写此项有助于县政府更快处理您的申请，并确定您符合哪些资格。',
  requirement_hint_can_complete_later: '您现在可以留空。县政府之后可能仍需要这项信息。',
  requirement_hint_optional: '表格将此项视为可选 — 不会影响资格认定。',
  questionnaire_all_answered: '我们需要的所有问题都已回答',

  lang_zh_CN: '简体中文',
  // ── questionnaire-step.tsx (localization pass) ────────────────────────────
  qstep_not_answered_yet: '尚未回答',
  qstep_not_answered_option: '未回答',
  qstep_who_is_this_for: '这是为谁填写的？',
  qstep_everyone_has_entry: '您家庭中的每个人在此处都已有一条记录。',
  qstep_add_entry: '添加条目',
  qstep_extra_pages: '您的回答新增的附加页',
  qstep_next_question: '下一个问题',
  qstep_skip_for_now: '暂时跳过',
  qstep_skip_explanation: '暂时跳过。此项在您的草稿中将保持空白——它并不等于回答“否”——并且可能需要在提交前填写完成。',
  qstep_skip_tooltip: '此栏位在您的草稿中将保持空白。您可能需要稍后填写。',
  qstep_progress_aria: '申请填写进度',

  // ── questionnaire-step.tsx: counted and numbered strings ──────────────────
  qstep_questions_left_one: '还剩 {count} 个问题',
  qstep_questions_left_other: '还剩 {count} 个问题',
  qstep_entry_number: '第 {number} 条',

} as const;

export default zhCN;