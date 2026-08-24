/**
 * Client for the AgentMandi API.
 *
 * Everything the dashboard renders is parsed through the shared zod schemas, so
 * a shape change on the API surfaces here as a loud error rather than a blank
 * panel. Money stays as integer paise all the way to the formatter.
 */

import {
  AgentRunResultSchema,
  AuditChainVerificationSchema,
  AuditEventSchema,
  CatalogFeedPageSchema,
  DecisionSchema,
  HealthSchema,
  MandateRecordSchema,
  PaymentRecordSchema,
  PurchaseIntentSchema,
  ScenarioSchema,
  type AgentRunResult,
  type AuditChainVerification,
  type AuditEvent,
  type CatalogFeedPage,
  type Decision,
  type Health,
  type MandateRecord,
  type PaymentRecord,
  type PurchaseIntent,
  type Scenario,
} from "@agentmandi/shared-types";
import { z } from "zod";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:8000";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<S extends z.ZodTypeAny>(
  path: string,
  schema: S,
  init?: RequestInit,
): Promise<z.infer<S>> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      cache: "no-store",
    });
  } catch {
    throw new ApiError(
      `Cannot reach the AgentMandi API at ${API_BASE}. Is it running?`,
      0,
    );
  }

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail = body.detail ?? detail;
    } catch {
      /* the body was not JSON; the status text will do */
    }
    throw new ApiError(detail, response.status);
  }

  return schema.parse(await response.json());
}

const post = <S extends z.ZodTypeAny>(path: string, schema: S, body?: unknown) =>
  request(path, schema, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });

// ------------------------------------------------------------------- reads

export const getHealth = () => request("/health", HealthSchema);

export const getAuditEvents = (limit = 120) =>
  request(`/audit/events?limit=${limit}`, z.array(AuditEventSchema));

export const verifyAuditChain = () =>
  request("/audit/verify", AuditChainVerificationSchema);

export const getMandates = () => request("/mandate", z.array(MandateRecordSchema));

export const getIntents = (limit = 60) =>
  request(`/intents?limit=${limit}`, z.array(PurchaseIntentSchema));

export const getDecision = (intentId: string) =>
  request(`/intents/${intentId}/decision`, DecisionSchema);

export const getCatalogFeed = (limit = 60) =>
  request(`/catalog/feed?limit=${limit}`, CatalogFeedPageSchema);

const ScenarioListSchema = z.object({
  count: z.number().int(),
  scenarios: z.array(ScenarioSchema),
});
export const getScenarios = () => request("/demo/scenarios", ScenarioListSchema);

const PolicyConfigSchema = z.object({
  policy_version: z.string(),
  hitl_threshold_paise: z.number().int(),
  hitl_threshold_inr: z.number(),
  max_qty_per_intent: z.number().int(),
  merchant_id: z.string(),
  checks: z.array(
    z.object({ order: z.number().int(), id: z.string(), name: z.string() }),
  ),
});
export const getPolicyConfig = () => request("/policy/config", PolicyConfigSchema);

// ------------------------------------------------------------------ writes

const QuickMandateSchema = z.object({
  mandate_token: z.string(),
  mandate: MandateRecordSchema,
  hint: z.string(),
});

export const issueQuickMandate = (body: {
  buyer_id?: string;
  per_txn_cap_paise?: number;
  total_budget_paise?: number;
  allowed_categories?: string[];
  ttl_hours?: number;
}) => post("/demo/mandate", QuickMandateSchema, body);

export const runAgent = (goal: string, mandateToken: string, autoPay = true) =>
  post("/agent/run", AgentRunResultSchema, {
    goal,
    mandate_token: mandateToken,
    auto_pay: autoPay,
  });

const ScenarioResultSchema = z.object({
  scenario_id: z.string(),
  title: z.string(),
  proves: z.string(),
  outcome: z.string(),
  summary: z.string(),
  mandate_id: z.string(),
  mandate_token: z.string(),
  steps: z.array(z.record(z.string(), z.unknown())),
  audit_tail: z.array(z.record(z.string(), z.unknown())),
});
export const runScenario = (id: string) =>
  post(`/demo/scenarios/${id}`, ScenarioResultSchema);

const ResetSchema = z.object({ reset: z.boolean(), ingested: z.number().int() });
export const resetDemo = () => post("/demo/reset", ResetSchema);

/**
 * Approve or reject a gated intent.
 *
 * Hits `/demo/resolve-gate`, which calls the same `resolve_gate` service that
 * `POST /policy/resolve` does -- every other guardrail is re-run against current
 * state before an approval sticks -- and additionally opens the checkout for an
 * approved intent. The dashboard needs that second step because it holds no
 * mandate token of its own; the agent-facing `/policy/resolve` stops at the
 * decision.
 */
export const resolveGate = (
  intentId: string,
  approve: boolean,
  resolvedBy = "dashboard-operator",
) =>
  post(
    `/demo/resolve-gate/${intentId}?approve=${approve}&resolved_by=${encodeURIComponent(resolvedBy)}`,
    z.object({
      intent: PurchaseIntentSchema,
      decision: DecisionSchema,
      next_action: z.string(),
      checkout_url: z.string().nullable().optional(),
      payment: PaymentRecordSchema.optional(),
    }),
  );

/** The payment opened for an intent, if a checkout has been started. */
export const getPaymentForIntent = (intentId: string) =>
  request(`/payments/intent/${intentId}`, PaymentRecordSchema);

export const confirmPurchase = (intentId: string, mandateToken: string) =>
  post(
    "/intents/confirm",
    z.object({
      intent: PurchaseIntentSchema,
      payment: z.object({
        rzp_payment_link_id: z.string().nullable(),
        rzp_order_id: z.string().nullable(),
        status: z.string(),
      }),
      checkout_url: z.string().nullable(),
      message: z.string(),
    }),
    { intent_id: intentId, mandate_token: mandateToken },
  );

export const simulatePayment = (linkId: string, outcome: "success" | "failure") =>
  post(
    `/payments/simulator/${linkId}/pay?outcome=${outcome}`,
    z.object({ status: z.string(), event: z.string().optional() }),
  );

export type {
  AgentRunResult,
  AuditChainVerification,
  AuditEvent,
  CatalogFeedPage,
  Decision,
  Health,
  MandateRecord,
  PaymentRecord,
  PurchaseIntent,
  Scenario,
};
