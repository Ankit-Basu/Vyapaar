/**
 * Shared contracts between the FastAPI service and the Next.js dashboard.
 *
 * These zod schemas mirror `services/api/app/models.py` one for one. The API is
 * the source of truth; this file exists so the dashboard fails loudly at the
 * boundary when the two drift apart, rather than rendering `undefined`.
 *
 * Money is always an integer count of paise (100 paise = INR 1). Never a float.
 */

import { z } from "zod";

/** Format integer paise as an Indian-rupee string. */
export function formatPaise(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(paise / 100);
}

// ---------------------------------------------------------------- catalog

export const ProductSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  category: z.string(),
  price_paise: z.number().int().nonnegative(),
  currency: z.literal("INR"),
  stock: z.number().int().nonnegative(),
  attributes: z.record(z.string(), z.unknown()).default({}),
});
export type Product = z.infer<typeof ProductSchema>;

export const ScoredProductSchema = z.object({
  product: ProductSchema,
  score: z.number(),
  lexical_score: z.number(),
  semantic_score: z.number(),
  rationale: z.string(),
});
export type ScoredProduct = z.infer<typeof ScoredProductSchema>;

export const CatalogFeedPageSchema = z.object({
  schema_version: z.literal("agentmandi.catalog.v1"),
  merchant_id: z.string(),
  merchant_name: z.string(),
  currency: z.literal("INR"),
  generated_at: z.string(),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
  next_offset: z.number().int().nullable(),
  categories: z.array(z.string()),
  products: z.array(ProductSchema),
});
export type CatalogFeedPage = z.infer<typeof CatalogFeedPageSchema>;

// ---------------------------------------------------------------- mandate

export const MandateRecordSchema = z.object({
  mandate_id: z.string(),
  buyer_id: z.string(),
  merchant_id: z.string(),
  per_txn_cap_paise: z.number().int(),
  total_budget_paise: z.number().int(),
  spent_paise: z.number().int(),
  reserved_paise: z.number().int(),
  allowed_categories: z.array(z.string()),
  issued_at: z.string(),
  expires_at: z.string(),
  revoked_at: z.string().nullable().default(null),
  label: z.string().nullable().default(null),
});
export type MandateRecord = z.infer<typeof MandateRecordSchema>;

/** Budget an agent may still commit: total minus settled spend minus in-flight holds. */
export function availablePaise(m: MandateRecord): number {
  return Math.max(0, m.total_budget_paise - m.spent_paise - m.reserved_paise);
}

// ------------------------------------------------------- intent & decision

export const IntentStatusSchema = z.enum([
  "PENDING",
  "APPROVED",
  "GATED",
  "DENIED",
  "PAID",
  "FAILED",
  "EXPIRED",
]);
export type IntentStatus = z.infer<typeof IntentStatusSchema>;

export const DecisionActionSchema = z.enum(["auto_approve", "gate_for_human", "deny"]);
export type DecisionAction = z.infer<typeof DecisionActionSchema>;

export const CheckStatusSchema = z.enum(["pass", "fail", "gate", "skipped"]);
export type CheckStatus = z.infer<typeof CheckStatusSchema>;

export const PolicyCheckSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: CheckStatusSchema,
  reason: z.string(),
  observed: z.record(z.string(), z.unknown()).default({}),
});
export type PolicyCheck = z.infer<typeof PolicyCheckSchema>;

export const DecisionSchema = z.object({
  action: DecisionActionSchema,
  reasons: z.array(z.string()),
  checks: z.array(PolicyCheckSchema),
  evaluated_at: z.string(),
  policy_version: z.string().default("agentmandi.policy.v1"),
});
export type Decision = z.infer<typeof DecisionSchema>;

export const PurchaseIntentSchema = z.object({
  intent_id: z.string(),
  mandate_id: z.string(),
  buyer_id: z.string(),
  merchant_id: z.string(),
  product_id: z.string(),
  product_title: z.string(),
  category: z.string(),
  unit_price_paise: z.number().int(),
  qty: z.number().int(),
  amount_paise: z.number().int(),
  status: IntentStatusSchema,
  agent_rationale: z.string().nullable().default(null),
  created_at: z.string(),
  updated_at: z.string(),
  reserved_paise: z.number().int().default(0),
});
export type PurchaseIntent = z.infer<typeof PurchaseIntentSchema>;

// ---------------------------------------------------------------- payment

export const PaymentStatusSchema = z.enum([
  "CREATED",
  "AWAITING_PAYMENT",
  "PAID",
  "FAILED",
]);
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

export const PaymentRecordSchema = z.object({
  payment_id: z.string(),
  intent_id: z.string(),
  rzp_order_id: z.string().nullable().default(null),
  rzp_payment_link_id: z.string().nullable().default(null),
  rzp_payment_id: z.string().nullable().default(null),
  short_url: z.string().nullable().default(null),
  amount_paise: z.number().int(),
  status: PaymentStatusSchema,
  mode: z.enum(["live", "simulated"]),
  failure_reason: z.string().nullable().default(null),
  created_at: z.string(),
  updated_at: z.string(),
});
export type PaymentRecord = z.infer<typeof PaymentRecordSchema>;

// ------------------------------------------------------------------ audit

export const AuditEventSchema = z.object({
  seq: z.number().int(),
  event_id: z.string(),
  ts: z.string(),
  actor: z.string(),
  event_type: z.string(),
  intent_id: z.string().nullable().default(null),
  mandate_id: z.string().nullable().default(null),
  amount_paise: z.number().int().nullable().default(null),
  decision: z.string().nullable().default(null),
  summary: z.string(),
  reasons: z.array(z.string()).default([]),
  payload: z.record(z.string(), z.unknown()).default({}),
  prev_hash: z.string(),
  hash: z.string(),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

export const AuditChainVerificationSchema = z.object({
  valid: z.boolean(),
  length: z.number().int(),
  head_hash: z.string().nullable(),
  broken_at_seq: z.number().int().nullable().default(null),
  detail: z.string(),
});
export type AuditChainVerification = z.infer<typeof AuditChainVerificationSchema>;

// ------------------------------------------------------------------ agent

export const AgentStepSchema = z.object({
  step: z.number().int(),
  action: z.string(),
  thought: z.string(),
  detail: z.record(z.string(), z.unknown()).default({}),
});
export type AgentStep = z.infer<typeof AgentStepSchema>;

export const AgentRunResultSchema = z.object({
  goal: z.string(),
  mandate_id: z.string(),
  planner: z.string(),
  outcome: z.enum([
    "paid",
    "awaiting_payment",
    "awaiting_human",
    "denied",
    "abandoned",
    "error",
  ]),
  message: z.string(),
  steps: z.array(AgentStepSchema),
  intent_id: z.string().nullable().default(null),
  checkout_url: z.string().nullable().default(null),
  attempts: z.number().int().default(0),
});
export type AgentRunResult = z.infer<typeof AgentRunResultSchema>;

// -------------------------------------------------------------- responses

export const PurchaseIntentResponseSchema = z.object({
  intent: PurchaseIntentSchema,
  decision: DecisionSchema,
  mandate: MandateRecordSchema,
  next_action: z.string(),
});
export type PurchaseIntentResponse = z.infer<typeof PurchaseIntentResponseSchema>;

export const HealthSchema = z.object({
  status: z.string(),
  version: z.string(),
  environment: z.string(),
  catalog_products: z.number().int(),
  payments_mode: z.enum(["live", "simulated"]),
  razorpay_test_keys_configured: z.boolean(),
  llm_provider: z.string(),
  llm_model: z.string(),
  embeddings_backend: z.string(),
  hitl_threshold_paise: z.number().int(),
  audit_events: z.number().int(),
  audit_chain_valid: z.boolean(),
  warnings: z.array(z.string()).default([]),
});
export type Health = z.infer<typeof HealthSchema>;

export const ScenarioSchema = z.object({
  id: z.string(),
  title: z.string(),
  proves: z.string(),
  narrative: z.string(),
  expected_outcome: z.string(),
  watch_for: z.array(z.string()).default([]),
  runnable: z.boolean().default(true),
});
export type Scenario = z.infer<typeof ScenarioSchema>;
