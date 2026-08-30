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
  schema_version: z.literal("vyapaar.catalog.v1"),
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
  policy_version: z.string().default("vyapaar.policy.v1"),
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

// ------------------------------------------------------------------ growth
//
// The merchant's side of the counter. A discount is a money action too, so it
// carries the same shape as a purchase: an ordered gauntlet of checks, each
// with a reason, and a ledger that holds before it gives.

export const OfferKindSchema = z.enum(["bundle", "volume", "upgrade"]);
export type OfferKind = z.infer<typeof OfferKindSchema>;

export const OfferStatusSchema = z.enum([
  "PUBLISHED",
  "GATED",
  "SUPPRESSED",
  "ACCEPTED",
  "DECLINED",
  "EXPIRED",
]);
export type OfferStatus = z.infer<typeof OfferStatusSchema>;

export const OfferActionSchema = z.enum(["auto_publish", "gate_for_human", "suppress"]);
export type OfferAction = z.infer<typeof OfferActionSchema>;

export const OfferLineSchema = z.object({
  product_id: z.string(),
  title: z.string(),
  category: z.string(),
  qty: z.number().int(),
  unit_price_paise: z.number().int(),
  line_total_paise: z.number().int(),
  is_anchor: z.boolean().default(false),
});
export type OfferLine = z.infer<typeof OfferLineSchema>;

export const OfferQuoteSchema = z.object({
  schema_version: z.string().default("vyapaar.offer.v1"),
  offer_id: z.string(),
  campaign_id: z.string(),
  kind: OfferKindSchema,
  anchor_product_id: z.string(),
  lines: z.array(OfferLineSchema),
  list_total_paise: z.number().int(),
  offer_total_paise: z.number().int(),
  discount_paise: z.number().int(),
  discount_bps: z.number().int(),
  headline: z.string(),
  rationale: z.string(),
  disclosure: z.string(),
  expires_at: z.string(),
  status: OfferStatusSchema.default("PUBLISHED"),
});
export type OfferQuote = z.infer<typeof OfferQuoteSchema>;

export const OfferCheckSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: CheckStatusSchema,
  reason: z.string(),
  observed: z.record(z.string(), z.unknown()).default({}),
});
export type OfferCheck = z.infer<typeof OfferCheckSchema>;

export const OfferDecisionSchema = z.object({
  action: OfferActionSchema,
  reasons: z.array(z.string()),
  checks: z.array(OfferCheckSchema),
  evaluated_at: z.string(),
  policy_version: z.string().default("vyapaar.growth.v1"),
});
export type OfferDecision = z.infer<typeof OfferDecisionSchema>;

export const EvaluatedOfferSchema = z.object({
  offer: OfferQuoteSchema,
  decision: OfferDecisionSchema,
  /** Merchant-private: present on merchant views, null on anything agent-facing. */
  margin_paise: z.number().int().nullable().default(null),
  margin_bps: z.number().int().nullable().default(null),
});
export type EvaluatedOffer = z.infer<typeof EvaluatedOfferSchema>;

export const CampaignSchema = z.object({
  campaign_id: z.string(),
  name: z.string(),
  merchant_id: z.string(),
  status: z.enum(["ACTIVE", "PAUSED", "ENDED"]).default("ACTIVE"),
  discount_budget_paise: z.number().int(),
  discount_spent_paise: z.number().int().default(0),
  discount_reserved_paise: z.number().int().default(0),
  max_discount_bps: z.number().int(),
  floor_margin_bps: z.number().int(),
  deep_discount_gate_paise: z.number().int(),
  allowed_categories: z.array(z.string()).default([]),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Campaign = z.infer<typeof CampaignSchema>;

export const OfferListResponseSchema = z.object({
  schema_version: z.string().default("vyapaar.offers.v1"),
  merchant_id: z.string(),
  anchor_product_id: z.string(),
  generated_at: z.string(),
  mandate_aware: z.boolean(),
  offers: z.array(OfferQuoteSchema),
  withheld: z.array(z.record(z.string(), z.unknown())).default([]),
});
export type OfferListResponse = z.infer<typeof OfferListResponseSchema>;

export const RevenueMetricsSchema = z.object({
  settled_gmv_paise: z.number().int(),
  baseline_gmv_paise: z.number().int(),
  uplift_paise: z.number().int(),
  uplift_bps: z.number().int(),
  orders: z.number().int(),
  aov_paise: z.number().int(),
  aov_without_offer_paise: z.number().int(),
  aov_with_offer_paise: z.number().int(),
  attach_rate_bps: z.number().int(),
  discount_given_paise: z.number().int(),
  margin_earned_paise: z.number().int(),
  offers_published: z.number().int(),
  offers_accepted: z.number().int(),
  offers_declined: z.number().int(),
  offers_suppressed: z.number().int(),
  offers_gated: z.number().int(),
  margin_protected_paise: z.number().int(),
});
export type RevenueMetrics = z.infer<typeof RevenueMetricsSchema>;

export const RebalanceMoveSchema = z.object({
  product_id: z.string(),
  title: z.string(),
  action: z.enum(["promote", "withdraw", "hold"]),
  reason: z.string(),
  observed: z.record(z.string(), z.unknown()).default({}),
});
export type RebalanceMove = z.infer<typeof RebalanceMoveSchema>;

export const RebalanceResultSchema = z.object({
  campaign_id: z.string(),
  evaluated: z.number().int(),
  moves: z.array(RebalanceMoveSchema),
  summary: z.string(),
});
export type RebalanceResult = z.infer<typeof RebalanceResultSchema>;
