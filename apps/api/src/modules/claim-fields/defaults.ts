import { ClaimPartyType, FieldGroup, FieldType } from '@prisma/client';

const MOAREF: ClaimPartyType = 'MOAREF';
const INS: ClaimPartyType = 'INSURER_LEVEL';
const BOTH: ClaimPartyType[] = ['MOAREF', 'INSURER_LEVEL'];

export interface FieldDefSeed {
  key: string;
  label: string;
  type: FieldType;
  group: FieldGroup;
  editableBy: ClaimPartyType[];
  options?: string[];
  required?: boolean;
  order: number;
}

/**
 * Default claim-field catalog, transcribed from the brokerage's operator forms. Each field is
 * tagged with its group and which party (authority) may fill it. Editable per insurer afterwards.
 */
export const DEFAULT_CLAIM_FIELDS: FieldDefSeed[] = [
  // ── Claim / insured / policy data ──
  { key: 'full_name', label: 'نام و نام خانوادگی', type: 'TEXT', group: 'CLAIM_DATA', editableBy: BOTH, order: 1 },
  { key: 'national_code', label: 'کد ملی', type: 'NATIONAL_CODE', group: 'CLAIM_DATA', editableBy: BOTH, required: true, order: 2 },
  { key: 'birth_date', label: 'تاریخ تولد', type: 'DATE', group: 'CLAIM_DATA', editableBy: BOTH, order: 3 },
  { key: 'company_name', label: 'نام شرکت محل فعالیت', type: 'TEXT', group: 'CLAIM_DATA', editableBy: BOTH, order: 4 },
  { key: 'death_date', label: 'تاریخ فوت', type: 'DATE', group: 'CLAIM_DATA', editableBy: BOTH, order: 5 },
  { key: 'cause_of_death', label: 'علت فوت', type: 'TEXT', group: 'CLAIM_DATA', editableBy: BOTH, order: 6 },
  { key: 'policy_number', label: 'شماره بیمه‌نامه', type: 'TEXT', group: 'CLAIM_DATA', editableBy: BOTH, order: 7 },
  { key: 'policy_start_date', label: 'تاریخ شروع بیمه‌نامه', type: 'DATE', group: 'CLAIM_DATA', editableBy: BOTH, order: 8 },
  { key: 'death_capital', label: 'سرمایه فوت', type: 'AMOUNT', group: 'CLAIM_DATA', editableBy: BOTH, order: 9 },
  { key: 'accident_capital', label: 'سرمایه حادثه', type: 'AMOUNT', group: 'CLAIM_DATA', editableBy: BOTH, order: 10 },
  { key: 'payable_amount', label: 'مبلغ قابل پرداخت', type: 'AMOUNT', group: 'CLAIM_DATA', editableBy: BOTH, order: 11 },

  // ── Beneficiary (ذینفع) ──
  { key: 'beneficiary_type', label: 'نوع ذینفع', type: 'SELECT', group: 'BENEFICIARY', editableBy: BOTH, options: ['همسر', 'فرزند', 'پدر', 'مادر', 'سایر'], order: 20 },
  { key: 'beneficiary_iban', label: 'شماره شبا ذینفع', type: 'IBAN', group: 'BENEFICIARY', editableBy: BOTH, order: 21 },

  // ── Workflow stages: brokerage ──
  { key: 'broker_to_insurer_date', label: 'تاریخ اعلام کارگزاری به بیمه‌گر', type: 'DATE', group: 'WORKFLOW_STAGE', editableBy: [MOAREF], order: 30 },
  { key: 'broker_to_insurer_status', label: 'وضعیت اعلام کارگزاری به بیمه‌گر', type: 'TEXT', group: 'WORKFLOW_STAGE', editableBy: [MOAREF], order: 31 },
  { key: 'death_notice_date', label: 'تاریخ اعلام فوت', type: 'DATE', group: 'WORKFLOW_STAGE', editableBy: [MOAREF], order: 32 },
  { key: 'death_notice_status', label: 'وضعیت اعلام فوت', type: 'TEXT', group: 'WORKFLOW_STAGE', editableBy: [MOAREF], order: 33 },
  { key: 'execution_stages', label: 'مراحل اجرایی', type: 'TEXT', group: 'WORKFLOW_STAGE', editableBy: BOTH, order: 34 },

  // ── Workflow stages: document handling ──
  { key: 'docs_request_date', label: 'تاریخ درخواست مدارک', type: 'DATE', group: 'WORKFLOW_STAGE', editableBy: BOTH, order: 40 },
  { key: 'docs_request_status', label: 'وضعیت درخواست مدارک', type: 'TEXT', group: 'WORKFLOW_STAGE', editableBy: BOTH, order: 41 },
  { key: 'docs_receive_date', label: 'تاریخ دریافت مدارک', type: 'DATE', group: 'WORKFLOW_STAGE', editableBy: BOTH, order: 42 },
  { key: 'docs_receive_status', label: 'وضعیت دریافت مدارک', type: 'TEXT', group: 'WORKFLOW_STAGE', editableBy: BOTH, order: 43 },
  { key: 'missing_docs_request_date', label: 'تاریخ درخواست کسری مدارک', type: 'DATE', group: 'WORKFLOW_STAGE', editableBy: BOTH, order: 44 },
  { key: 'missing_docs_request_status', label: 'وضعیت درخواست کسری مدارک', type: 'TEXT', group: 'WORKFLOW_STAGE', editableBy: BOTH, order: 45 },
  { key: 'case_complete_date', label: 'تاریخ تکمیل پرونده', type: 'DATE', group: 'WORKFLOW_STAGE', editableBy: BOTH, order: 46 },
  { key: 'case_complete_status', label: 'وضعیت تکمیل پرونده', type: 'TEXT', group: 'WORKFLOW_STAGE', editableBy: BOTH, order: 47 },

  // ── Workflow stages: insurer / HQ / council ──
  { key: 'send_to_hq_date', label: 'تاریخ ارسال به ستاد', type: 'DATE', group: 'WORKFLOW_STAGE', editableBy: [INS], order: 50 },
  { key: 'send_to_hq_status', label: 'وضعیت ارسال به ستاد', type: 'TEXT', group: 'WORKFLOW_STAGE', editableBy: [INS], order: 51 },
  { key: 'return_to_branch_date', label: 'تاریخ برگشت به شعبه', type: 'DATE', group: 'WORKFLOW_STAGE', editableBy: [INS], order: 52 },
  { key: 'return_to_branch_status', label: 'وضعیت برگشت به شعبه', type: 'TEXT', group: 'WORKFLOW_STAGE', editableBy: [INS], order: 53 },
  { key: 'council_approve_date', label: 'تاریخ تایید شورای فنی و سایر', type: 'DATE', group: 'WORKFLOW_STAGE', editableBy: [INS], order: 54 },
  { key: 'council_approve_status', label: 'وضعیت تایید شورای فنی و سایر', type: 'TEXT', group: 'WORKFLOW_STAGE', editableBy: [INS], order: 55 },
  { key: 'payment_order_date', label: 'تاریخ حواله پرداخت', type: 'DATE', group: 'WORKFLOW_STAGE', editableBy: [INS], order: 56 },
  { key: 'payment_order_status', label: 'وضعیت حواله پرداخت', type: 'TEXT', group: 'WORKFLOW_STAGE', editableBy: [INS], order: 57 },
  { key: 'payment_order', label: 'حواله پرداخت', type: 'TEXT', group: 'WORKFLOW_STAGE', editableBy: [INS], order: 58 },

  { key: 'case_notes', label: 'توضیحات پرونده', type: 'TEXT', group: 'WORKFLOW_STAGE', editableBy: BOTH, order: 60 },
];
