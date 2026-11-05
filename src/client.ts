import { randomUUID } from "node:crypto";
import { CustfindError } from "./errors.js";
import type {
  Balance,
  CreateSearchParams,
  Customer,
  Deal,
  Lead,
  LeadListParams,
  Note,
  OutreachListParams,
  OutreachMessage,
  Page,
  Pipeline,
  Search,
  SearchCreated,
  SenderAccount,
  Usage,
  WebhookDelivery,
  WebhookEndpoint,
  WebhookEventType,
} from "./types.js";

export interface CustfindOptions {
  /** A workspace key, cf_live_… (Settings → API). Defaults to CUSTFIND_API_KEY. */
  apiKey?: string;
  baseUrl?: string;
  /** Per-attempt timeout. Default 30 s. */
  timeoutMs?: number;
  /** Retries after a network error, 409, 429 or 5xx. Default 3. */
  maxRetries?: number;
  /** Override fetch (tests, proxies). */
  fetch?: typeof fetch;
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type Query = Record<string, string | number | boolean | undefined>;

export interface RequestOptions {
  /** Your own Idempotency-Key. One is generated for every write when omitted. */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

const DEFAULT_BASE = "https://api.custfind.com";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const enc = encodeURIComponent;

/**
 * The Custfind API client.
 *
 * Every write carries an Idempotency-Key that stays the same across its
 * retries, so a retried search never starts twice or reserves credits twice.
 */
export class Custfind {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;

  readonly searches: Searches;
  readonly leads: Leads;
  readonly outreach: Outreach;
  readonly pipelines: Pipelines;
  readonly deals: Deals;
  readonly webhooks: Webhooks;
  readonly customers: Customers;
  readonly senderAccounts: SenderAccounts;

  constructor(options: CustfindOptions = {}) {
    const apiKey = options.apiKey ?? process.env.CUSTFIND_API_KEY;
    if (!apiKey) throw new Error("Custfind: pass apiKey or set CUSTFIND_API_KEY");
    this.apiKey = apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRetries = options.maxRetries ?? 3;
    this.fetchImpl = options.fetch ?? fetch;
    this.searches = new Searches(this);
    this.leads = new Leads(this);
    this.outreach = new Outreach(this);
    this.pipelines = new Pipelines(this);
    this.deals = new Deals(this);
    this.webhooks = new Webhooks(this);
    this.customers = new Customers(this);
    this.senderAccounts = new SenderAccounts(this);
  }

  /** The workspace and key behind the current key. */
  me(): Promise<{ organization_id: string; api_key_id: string }> {
    return this.request("GET", "/v1/me");
  }

  /** Plan and remaining credits. */
  balance(): Promise<Balance> {
    return this.request("GET", "/v1/balance");
  }

  /** What API searches spent, optionally grouped by customer or key. */
  usage(params: { from?: string; to?: string; group_by?: "customer" | "api_key" | "none"; external_customer_id?: string } = {}): Promise<Usage> {
    return this.request("GET", "/v1/usage", { query: params });
  }

  /** @internal */
  async request<T>(method: Method, path: string, opts: { query?: Query; body?: unknown } & RequestOptions = {}): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
      "User-Agent": "custfind-node/1.0.0",
    };
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.body);
    }
    if (method !== "GET") headers["Idempotency-Key"] = opts.idempotencyKey ?? randomUUID();

    for (let attempt = 0; ; attempt++) {
      const signal = opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs);
      let res: Response;
      try {
        res = await this.fetchImpl(url, { method, headers, body, signal });
      } catch (err) {
        if (opts.signal?.aborted) throw err;
        if (attempt < this.maxRetries) {
          await sleep(backoff(attempt));
          continue;
        }
        throw new CustfindError(0, err instanceof Error ? err.message : "network_error");
      }
      if (res.ok) {
        if (res.status === 204) return undefined as T;
        const text = await res.text();
        return (text ? JSON.parse(text) : undefined) as T;
      }
      const retryAfter = Number(res.headers.get("Retry-After")) || undefined;
      const retryable = res.status === 409 || res.status === 429 || res.status >= 500;
      if (retryable && attempt < this.maxRetries) {
        await res.body?.cancel();
        await sleep(retryAfter ? retryAfter * 1000 : backoff(attempt));
        continue;
      }
      let code = `http_${res.status}`;
      try {
        const data = (await res.json()) as { error?: string };
        if (data?.error) code = data.error;
      } catch {
        /* not JSON */
      }
      throw new CustfindError(res.status, code, undefined, retryAfter);
    }
  }
}

function backoff(attempt: number): number {
  return Math.min(8000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
}

class Resource {
  constructor(protected readonly client: Custfind) {}
}

export class Searches extends Resource {
  /** Starts a search. Set `limit` to what you need: it caps the credits reserved. */
  create(params: CreateSearchParams, opts?: RequestOptions): Promise<SearchCreated> {
    return this.client.request("POST", "/v1/searches", { body: params, ...opts });
  }
  get(id: string): Promise<Search> {
    return this.client.request("GET", `/v1/searches/${enc(id)}`);
  }
  list(params: { limit?: number } = {}): Promise<Search[]> {
    return this.client.request("GET", "/v1/searches", { query: params });
  }
  cancel(id: string, opts?: RequestOptions): Promise<Search> {
    return this.client.request("POST", `/v1/searches/${enc(id)}/cancel`, opts);
  }
  leads(id: string, params: { page?: number; page_size?: number } = {}): Promise<Page<Lead>> {
    return this.client.request("GET", `/v1/searches/${enc(id)}/leads`, { query: params });
  }
  /** Polls until the search completes, fails or is cancelled. */
  async waitForCompletion(id: string, opts: { intervalMs?: number; timeoutMs?: number } = {}): Promise<Search> {
    const interval = opts.intervalMs ?? 3000;
    const deadline = Date.now() + (opts.timeoutMs ?? 30 * 60_000);
    for (;;) {
      const search = await this.get(id);
      if (search.status === "completed" || search.status === "failed" || search.status === "cancelled") return search;
      if (Date.now() + interval > deadline) throw new CustfindError(0, "wait_timeout", `search ${id} still ${search.status}`);
      await sleep(interval);
    }
  }
  /** Every lead of a search, page by page. */
  async *allLeads(id: string, pageSize = 100): AsyncGenerator<Lead> {
    for (let page = 1; ; page++) {
      const res = await this.leads(id, { page, page_size: pageSize });
      for (const lead of res.items ?? []) yield lead;
      if (page * pageSize >= res.total || (res.items ?? []).length === 0) return;
    }
  }
}

export class Leads extends Resource {
  list(params: LeadListParams = {}): Promise<Page<Lead>> {
    return this.client.request("GET", "/v1/leads", { query: params as Query });
  }
  get(id: string): Promise<{ lead: Lead; enrichment?: Record<string, unknown> }> {
    return this.client.request("GET", `/v1/leads/${enc(id)}`);
  }
  outreach(id: string): Promise<OutreachMessage[]> {
    return this.client.request("GET", `/v1/leads/${enc(id)}/outreach`);
  }
  /** Writes the lead's draft if missing. `regenerate` rewrites it (one AI edit). */
  writeDraft(id: string, params: { regenerate?: boolean } = {}, opts?: RequestOptions): Promise<OutreachMessage[]> {
    return this.client.request("POST", `/v1/leads/${enc(id)}/outreach`, { body: params, ...opts });
  }
  crm(id: string): Promise<Record<string, unknown>> {
    return this.client.request("GET", `/v1/leads/${enc(id)}/crm`);
  }
  addNote(id: string, body: string, opts?: RequestOptions): Promise<Note> {
    return this.client.request("POST", `/v1/leads/${enc(id)}/notes`, { body: { body }, ...opts });
  }
}

export class Outreach extends Resource {
  list(params: OutreachListParams = {}): Promise<Page<OutreachMessage>> {
    return this.client.request("GET", "/v1/outreach", { query: params as Query });
  }
  get(id: string): Promise<OutreachMessage> {
    return this.client.request("GET", `/v1/outreach/${enc(id)}`);
  }
  update(id: string, params: { message: string; email_subject?: string }, opts?: RequestOptions): Promise<OutreachMessage> {
    return this.client.request("PATCH", `/v1/outreach/${enc(id)}`, { body: params, ...opts });
  }
  /** Rewrites with AI by tone or instruction; one AI edit, refunded on failure. */
  rewrite(id: string, params: { tone?: "professional" | "short" | "casual"; instruction?: string }, opts?: RequestOptions): Promise<OutreachMessage> {
    return this.client.request("POST", `/v1/outreach/${enc(id)}/rewrite`, { body: params, ...opts });
  }
  /** Sends now, or at `scheduled_at` (RFC 3339). */
  send(id: string, params: { scheduled_at?: string } = {}, opts?: RequestOptions): Promise<OutreachMessage> {
    return this.client.request("POST", `/v1/outreach/${enc(id)}/send`, { body: params, ...opts });
  }
}

export class Pipelines extends Resource {
  list(): Promise<Pipeline[]> {
    return this.client.request("GET", "/v1/pipelines");
  }
}

export class Deals extends Resource {
  create(params: { lead_id: string; stage_id?: string; title?: string; value_cents?: number; currency?: string }, opts?: RequestOptions): Promise<Deal> {
    return this.client.request("POST", "/v1/deals", { body: params, ...opts });
  }
  update(id: string, params: { stage_id?: string; pipeline_id?: string; title?: string; value_cents?: number; currency?: string }, opts?: RequestOptions): Promise<Deal> {
    return this.client.request("PATCH", `/v1/deals/${enc(id)}`, { body: params, ...opts });
  }
}

export class Webhooks extends Resource {
  /** Registers an endpoint. The returned `secret` is shown only now. */
  create(params: { url: string; events: WebhookEventType[]; description?: string }, opts?: RequestOptions): Promise<{ endpoint: WebhookEndpoint; secret: string }> {
    return this.client.request("POST", "/v1/webhooks", { body: params, ...opts });
  }
  list(): Promise<WebhookEndpoint[]> {
    return this.client.request("GET", "/v1/webhooks");
  }
  update(id: string, params: { enabled?: boolean; events?: WebhookEventType[]; url?: string; description?: string }, opts?: RequestOptions): Promise<WebhookEndpoint> {
    return this.client.request("PATCH", `/v1/webhooks/${enc(id)}`, { body: params, ...opts });
  }
  delete(id: string, opts?: RequestOptions): Promise<void> {
    return this.client.request("DELETE", `/v1/webhooks/${enc(id)}`, opts);
  }
  sendTest(id: string, opts?: RequestOptions): Promise<WebhookDelivery> {
    return this.client.request("POST", `/v1/webhooks/${enc(id)}/test`, opts);
  }
  deliveries(id: string, params: { limit?: number } = {}): Promise<WebhookDelivery[]> {
    return this.client.request("GET", `/v1/webhooks/${enc(id)}/deliveries`, { query: params });
  }
}

export class Customers extends Resource {
  list(): Promise<Customer[]> {
    return this.client.request("GET", "/v1/customers");
  }
  get(id: string): Promise<Customer> {
    return this.client.request("GET", `/v1/customers/${enc(id)}`);
  }
  setLimit(id: string, monthlyCredits: number, opts?: RequestOptions): Promise<Customer> {
    return this.client.request("PUT", `/v1/customers/${enc(id)}/limit`, { body: { monthly_credits: monthlyCredits }, ...opts });
  }
  removeLimit(id: string, opts?: RequestOptions): Promise<void> {
    return this.client.request("DELETE", `/v1/customers/${enc(id)}/limit`, opts);
  }
}

export class SenderAccounts extends Resource {
  list(params: { external_customer_id?: string } = {}): Promise<SenderAccount[]> {
    return this.client.request("GET", "/v1/sender-accounts", { query: params });
  }
  /** Connects a mailbox (tested before saving). With external_customer_id it serves only that customer. */
  create(
    params: { name: string; email: string; smtp_host: string; smtp_port: number; smtp_user: string; smtp_pass: string; external_customer_id?: string },
    opts?: RequestOptions,
  ): Promise<SenderAccount> {
    return this.client.request("POST", "/v1/sender-accounts", { body: params, ...opts });
  }
  delete(id: string, opts?: RequestOptions): Promise<void> {
    return this.client.request("DELETE", `/v1/sender-accounts/${enc(id)}`, opts);
  }
}
