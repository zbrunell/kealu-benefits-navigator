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

  lang_zh_CN: '简体中文',
} as const;

export default zhCN;