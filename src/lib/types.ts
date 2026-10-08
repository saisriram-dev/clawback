// Shared data model. The workspace is one JSON document on disk (see server/store.ts).

export type DocKind = 'invoice' | 'price_revision' | 'bank_realization' | 'refund_notice' | 'other';
export type Confidence = 'high' | 'medium' | 'low' | 'manual';
export type Method = 'gemma+rules' | 'gemma' | 'rules' | 'manual';
export type FieldType = 'text' | 'money' | 'number' | 'date' | 'hs' | 'incoterm' | 'list' | 'currency';

export const DOC_KIND_LABEL: Record<DocKind, string> = {
  invoice: 'Commercial invoice',
  price_revision: 'Price revision',
  bank_realization: 'Bank realisation (e-BRC / FIRA)',
  refund_notice: 'Refund confirmation',
  other: 'Other document',
};

export interface SourceRef {
  docId: string;
  line: number; // 1-based index into DocRecord.lines
  quote: string; // verbatim text on that line that holds the value
}

export interface Field {
  value: string | null; // normalised value (ISO date, decimal string, HS digits, etc.)
  raw?: string | null; // as written in the document
  type: FieldType;
  confidence: Confidence;
  method: Method;
  source: SourceRef | null;
  note?: string;
  alt?: { value: string; source: SourceRef | null; method: Method } | null; // disagreeing reading
  original?: { value: string | null; method: Method; confidence: Confidence; source: SourceRef | null } | null; // before a human correction
  correctedAt?: string;
}

export interface DocLine {
  page: number;
  text: string;
}

export type DocStatus = 'queued' | 'processing' | 'ready' | 'failed';

export interface DocRecord {
  id: string;
  filename: string;
  mime: string;
  size: number;
  sha256: string;
  storedAs: string; // file name under data/uploads
  uploadedAt: string; // ISO timestamp
  origin: 'upload' | 'paste' | 'demo';
  status: DocStatus;
  error?: string;
  kind: DocKind;
  kindConfidence: Confidence;
  kindMethod: Method;
  lines: DocLine[];
  meta: {
    pages?: number;
    emailFrom?: string;
    emailTo?: string;
    emailDate?: string;
    emailSubject?: string;
    ocr?: boolean;
    truncated?: boolean;
    format?: string;
  };
  fields: Record<string, Field>;
  itemCount: number;
  engine: {
    used: 'gemma' | 'rules' | 'manual' | 'none';
    model?: string;
    ms?: number;
    warnings: string[];
    promptVersion?: string;
    cached?: boolean;
    grounded?: number;
    total?: number;
  };
  buyerId: string | null;
  buyerMethod?: 'auto' | 'manual';
}

export type Stage = 'drafted' | 'sent' | 'countered' | 'settled';
export const STAGES: Stage[] = ['drafted', 'sent', 'countered', 'settled'];
export const STAGE_LABEL: Record<Stage, string> = {
  drafted: 'Drafted',
  sent: 'Sent',
  countered: 'Countered',
  settled: 'Settled',
};

export interface PortalResponse {
  at: string;
  option: 'A' | 'B' | 'C' | 'counter';
  amountUSD: number | null;
  name: string;
  note: string;
}

export interface Buyer {
  id: string;
  name: string;
  aliases: string[];
  domains: string[];
  country: string | null;
  address: string | null;
  contactName: string | null;
  contactEmail: string | null;
  revenueSharePct: number | null;
  relationshipSinceYear: number | null;
  openOrders: boolean | null;
  stage: Stage;
  stageUpdatedAt: string;
  agreedOption: 'A' | 'B' | 'C' | null;
  agreedUSD: number | null;
  recoveredUSD: number | null;
  portalToken: string;
  portalEnabled: boolean;
  refundConfirmedDate: string | null;
  refundConfirmedUSD: number | null;
  refundConfirmedInterestUSD: number | null;
  transitDays: number | null;
  notes: string;
  responses: PortalResponse[];
  createdAt: string;
}

export interface LineOverride {
  entryDate?: string | null;
  loadDate?: string | null;
  ratePct?: number | null; // manual rate, e.g. 50
  exempt?: boolean;
  baselinePrice?: number | null;
  revisedPrice?: number | null;
  discountMode?: 'on_invoice' | 'credit_note' | null;
  customsValue?: number | null;
  excluded?: boolean;
}

export interface Company {
  name: string;
  iec: string;
  gstin: string;
  address: string;
  signatoryName: string;
  signatoryTitle: string;
  email: string;
  phone: string;
  emailDomains: string[];
}

export interface EngineSettings {
  mode: 'auto' | 'gemma' | 'rules';
  provider: 'ollama' | 'openai' | 'google';
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutSec: number;
  numCtx: number;
}

export interface Settings {
  fxUsdInr: number;
  fxAsOf: string;
  transitDaysDefault: number;
  depositLagDays: number;
  interestBasis: 'corporate' | 'non_corporate';
  holdingRatePct: number;
  successFeePct: number;
  splitPct: number;
  nextOrders: number;
  paymentDays: number;
  engine: EngineSettings;
}

export interface AuditEvent {
  at: string;
  kind: string;
  text: string;
  docId?: string;
  buyerId?: string;
}

export interface Workspace {
  version: 1;
  company: Company;
  settings: Settings;
  buyers: Record<string, Buyer>;
  documents: Record<string, DocRecord>;
  lineOverrides: Record<string, LineOverride>;
  events: AuditEvent[];
}

export const DEFAULT_SETTINGS: Settings = {
  fxUsdInr: 96.4,
  fxAsOf: '2026-10-07',
  transitDaysDefault: 30,
  depositLagDays: 10,
  interestBasis: 'corporate',
  holdingRatePct: 6,
  successFeePct: 7,
  splitPct: 50,
  nextOrders: 2,
  paymentDays: 30,
  engine: {
    mode: 'auto',
    provider: 'ollama',
    baseUrl: 'http://127.0.0.1:11434',
    model: 'gemma4:e4b',
    apiKey: '',
    timeoutSec: 240,
    numCtx: 8192,
  },
};

export const DEFAULT_COMPANY: Company = {
  name: 'Your Export Company Pvt Ltd',
  iec: '',
  gstin: '',
  address: '',
  signatoryName: '',
  signatoryTitle: 'Director',
  email: '',
  phone: '',
  emailDomains: [],
};

// Field schema per document kind. Used by the rules engine, the Gemma prompt and the UI.
export interface FieldSpec {
  key: string;
  label: string;
  type: FieldType;
  hint: string;
}

export const DOC_FIELDS: Record<Exclude<DocKind, 'other'>, { fields: FieldSpec[]; items: FieldSpec[] }> = {
  invoice: {
    fields: [
      { key: 'buyer_name', label: 'Buyer', type: 'text', hint: 'company name of the buyer / consignee / bill-to party (not the exporter)' },
      { key: 'invoice_number', label: 'Invoice no.', type: 'text', hint: 'commercial invoice number' },
      { key: 'invoice_date', label: 'Invoice date', type: 'date', hint: 'date of the invoice' },
      { key: 'currency', label: 'Currency', type: 'currency', hint: 'invoice currency code, e.g. USD' },
      { key: 'incoterm', label: 'Incoterm', type: 'incoterm', hint: 'delivery term such as FOB, CIF, CFR, DAP, DDP' },
      { key: 'ship_date', label: 'Shipped on', type: 'date', hint: 'bill of lading / on-board / shipment / shipping bill date' },
      { key: 'shipping_bill_no', label: 'Shipping bill no.', type: 'text', hint: 'Indian shipping bill number' },
      { key: 'po_number', label: 'Buyer PO', type: 'text', hint: "buyer's purchase order number" },
      { key: 'freight', label: 'Freight', type: 'money', hint: 'ocean/air freight amount shown on the invoice' },
      { key: 'insurance', label: 'Insurance', type: 'money', hint: 'insurance amount shown on the invoice' },
      { key: 'total', label: 'Invoice total', type: 'money', hint: 'grand total of the invoice' },
    ],
    items: [
      { key: 'description', label: 'Description', type: 'text', hint: 'goods description' },
      { key: 'hs_code', label: 'HS code', type: 'hs', hint: 'HS / HSN / HTS code' },
      { key: 'qty', label: 'Qty', type: 'number', hint: 'quantity' },
      { key: 'unit', label: 'Unit', type: 'text', hint: 'unit of quantity, e.g. PCS, KG, SETS' },
      { key: 'list_price', label: 'List price', type: 'money', hint: 'original/list unit price only if the line shows both a list price and a discounted net price' },
      { key: 'unit_price', label: 'Unit price', type: 'money', hint: 'unit price actually charged (net)' },
      { key: 'amount', label: 'Amount', type: 'money', hint: 'line amount' },
    ],
  },
  price_revision: {
    fields: [
      { key: 'buyer_name', label: 'Buyer', type: 'text', hint: 'company name of the US buyer in this correspondence' },
      { key: 'email_date', label: 'Date', type: 'date', hint: 'date the revision was sent or agreed' },
      { key: 'email_from', label: 'From', type: 'text', hint: 'sender' },
      { key: 'subject', label: 'Subject', type: 'text', hint: 'email subject' },
      { key: 'currency', label: 'Currency', type: 'currency', hint: 'currency of the prices' },
      { key: 'applies_to', label: 'Applies to', type: 'list', hint: 'invoice or PO numbers the revised price applies to, comma separated' },
      { key: 'effective_from', label: 'Effective from', type: 'date', hint: 'date from which the revised price applies' },
      { key: 'tariff_reason', label: 'Reason given', type: 'text', hint: 'the sentence that gives the reason for the price change (e.g. tariff/duty)' },
    ],
    items: [
      { key: 'product', label: 'Product', type: 'text', hint: 'product or SKU the revision covers' },
      { key: 'hs_code', label: 'HS code', type: 'hs', hint: 'HS code if stated' },
      { key: 'baseline_price', label: 'Previous price', type: 'money', hint: 'unit price before the revision' },
      { key: 'revised_price', label: 'Revised price', type: 'money', hint: 'unit price after the revision' },
    ],
  },
  bank_realization: {
    fields: [
      { key: 'bank_name', label: 'Bank', type: 'text', hint: 'bank issuing the advice / certificate' },
      { key: 'document_ref', label: 'Certificate / advice no.', type: 'text', hint: 'e-BRC, FIRA or FIRC number of the document' },
      { key: 'remitter_name', label: 'Remitter (buyer)', type: 'text', hint: 'overseas remitter / ordering customer / buyer name' },
    ],
    items: [
      { key: 'reference_no', label: 'Reference', type: 'text', hint: 'IRM / remittance / transaction reference' },
      { key: 'realization_date', label: 'Realised on', type: 'date', hint: 'date of realisation / value date / credit date' },
      { key: 'invoice_ref', label: 'Invoice', type: 'text', hint: 'export invoice number the money was realised against' },
      { key: 'currency', label: 'Currency', type: 'currency', hint: 'foreign currency' },
      { key: 'fcy_amount', label: 'Amount (FCY)', type: 'money', hint: 'realised amount in foreign currency' },
      { key: 'inr_amount', label: 'Amount (INR)', type: 'money', hint: 'realised amount in rupees' },
    ],
  },
  refund_notice: {
    fields: [
      { key: 'buyer_name', label: 'Buyer', type: 'text', hint: 'importer of record that received the refund' },
      { key: 'refund_date', label: 'Refund date', type: 'date', hint: 'date the CBP refund was paid' },
      { key: 'refund_amount', label: 'Refund amount', type: 'money', hint: 'refund principal' },
      { key: 'interest_amount', label: 'Interest', type: 'money', hint: 'interest paid with the refund' },
      { key: 'cape_reference', label: 'CAPE reference', type: 'text', hint: 'CAPE declaration or refund reference number' },
    ],
    items: [],
  },
};
