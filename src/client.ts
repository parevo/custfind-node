import { randomUUID } from "node:crypto";
import { CustfindError } from "./errors.js";
import type {
  Balance,
  CreateSearchParams,
  Customer,
  Deal,
  Lead,
  LeadCRM,
  LeadDetail,
  LeadListParams,
  Note,
  OutreachListParams,
  OutreachMessage,
  OutreachPage,
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
  /** Retries after a network error, 429, 5xx or a write still in progress. Default 3. */
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
const VERSION = "1.1.0";
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
      "User-Agent": `custfind-node/${VERSION}`,
    };
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.body);
    }
    if (method !== "GET") headers["Idempotency-Key"] = opts.idempotencyKey ?? randomUUID();

    for (let attempt = 0; ; attempt++) {
      const { signal, done } = attemptSignal(this.timeoutMs, opts.signal);
      let res: Response;
      try {
        res = await this.fetchImpl(url, { method, headers, body, signal });
      } catch (err) {
        done();
        if (opts.signal?.aborted) throw err;
        if (attempt < this.maxRetries) {
          await sleep(backoff(attempt));
          continue;
        }
        throw new CustfindError(0, err instanceof Error ? err.message : "network_error");
      }
      let text: string;
      try {
        text = await res.text();
      } finally {
        done();
      }
      if (res.ok) {
        return (res.status === 204 || !text ? undefined : JSON.parse(text)) as T;
      }
      const header = res.headers.get("Retry-After");
      const retryAfter = header !== null && header.trim() !== "" && Number.isFinite(Number(header)) ? Number(header) : undefined;
      let code = `http_${res.status}`;
      let detail: string | undefined;
      try {
        const data = JSON.parse(text) as { error?: string; detail?: string };
        if (data?.error) code = data.error;
        detail = data?.detail;
      } catch {
        // A few routes answer in plain text ("invalid json body").
        detail = text.trim() || undefined;
      }
      // A 409 is retried only while an earlier attempt of the same write is
      // still running; any other 409 ("invalid job state") is final, and a
      // retry would only get it replayed.
      const retryable = res.status === 429 || res.status >= 500 || (res.status === 409 && code === "idempotency_in_progress");
      if (retryable && attempt < this.maxRetries) {
        await sleep(retryAfter !== undefined ? retryAfter * 1000 : backoff(attempt));
        continue;
      }
      throw new CustfindError(res.status, code, detail ? `Custfind API error ${res.status}: ${code} (${detail})` : undefined, retryAfter);
    }
  }
}

/**
 * A per-attempt signal: aborts on the caller's signal or after timeoutMs.
 * (AbortSignal.any needs Node 20.3; this works on 18.)
 */
function attemptSignal(timeoutMs: number, outer?: AbortSignal): { signal: AbortSignal; done: () => void } {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException("The operation timed out.", "TimeoutError")), timeoutMs);
  const onAbort = () => ctrl.abort(outer?.reason);
  if (outer?.aborted) ctrl.abort(outer.reason);
  else outer?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: ctrl.signal,
    done: () => {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onAbort);
    },
  };
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
  /** One page of a search's leads; takes the same filters as `leads.list`. */
  leads(id: string, params: Omit<LeadListParams, "job_id"> = {}): Promise<Page<Lead>> {
    return this.client.request("GET", `/v1/searches/${enc(id)}/leads`, { query: params as Query });
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
  /** Every lead of a search, page by page. Iterate a finished search: while one runs, new leads can shift the pages. */
  allLeads(id: string, params: Omit<LeadListParams, "job_id" | "page"> | number = {}): AsyncGenerator<Lead> {
    // A number is the page size (the 1.0 signature).
    const p = typeof params === "number" ? { page_size: params } : params;
    return paginate((q) => this.leads(id, q), p);
  }
}

export class Leads extends Resource {
  list(params: LeadListParams = {}): Promise<Page<Lead>> {
    return this.client.request("GET", "/v1/leads", { query: params as Query });
  }
  /** Every lead matching the filters, page by page. */
  all(params: Omit<LeadListParams, "page"> = {}): AsyncGenerator<Lead> {
    return paginate((p) => this.list(p), params);
  }
  /** A lead with its enrichment, emails and calls. */
  get(id: string): Promise<LeadDetail> {
    return this.client.request("GET", `/v1/leads/${enc(id)}`);
  }
  outreach(id: string): Promise<OutreachMessage[]> {
    return this.client.request("GET", `/v1/leads/${enc(id)}/outreach`);
  }
  /** Writes the lead's draft if missing. `regenerate` rewrites it (one AI edit). */
  writeDraft(id: string, params: { regenerate?: boolean } = {}, opts?: RequestOptions): Promise<OutreachMessage[]> {
    return this.client.request("POST", `/v1/leads/${enc(id)}/outreach`, { body: params, ...opts });
  }
  /** The lead's deal, notes, tasks, tags, emails and meetings. */
  crm(id: string): Promise<LeadCRM> {
    return this.client.request("GET", `/v1/leads/${enc(id)}/crm`);
  }
  addNote(id: string, body: string, opts?: RequestOptions): Promise<Note> {
    return this.client.request("POST", `/v1/leads/${enc(id)}/notes`, { body: { body }, ...opts });
  }
}

export class Outreach extends Resource {
  list(params: OutreachListParams = {}): Promise<OutreachPage> {
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
    if (!params.tone && !params.instruction) return Promise.reject(new Error("Custfind: rewrite needs a tone or an instruction"));
    return this.client.request("POST", `/v1/outreach/${enc(id)}/rewrite`, { body: params, ...opts });
  }
  /** Sends now, or at `scheduled_at` (a Date or RFC 3339). */
  send(id: string, params: { scheduled_at?: string | Date } = {}, opts?: RequestOptions): Promise<OutreachMessage> {
    const at = params.scheduled_at instanceof Date ? params.scheduled_at.toISOString().replace(/\.\d{3}Z$/, "Z") : params.scheduled_at;
    return this.client.request("POST", `/v1/outreach/${enc(id)}/send`, { body: at ? { scheduled_at: at } : {}, ...opts });
  }
}

export class Pipelines extends Resource {
  list(): Promise<Pipeline[]> {
    return this.client.request("GET", "/v1/pipelines");
  }
}

export class Deals extends Resource {
  /** Opens a deal for a lead; without stage_id it starts in the default pipeline's first stage. */
  create(params: { lead_id: string; stage_id?: string; title?: string; value_cents?: number; currency?: string; assigned_user_id?: string }, opts?: RequestOptions): Promise<Deal> {
    return this.client.request("POST", "/v1/deals", { body: params, ...opts });
  }
  update(
    id: string,
    params: { stage_id?: string; pipeline_id?: string; title?: string; value_cents?: number; currency?: string; assigned_user_id?: string },
    opts?: RequestOptions,
  ): Promise<Deal> {
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

async function* paginate<P extends { page?: number; page_size?: number }>(fetchPage: (p: P) => Promise<Page<Lead>>, params: P): AsyncGenerator<Lead> {
  const pageSize = params.page_size ?? 100;
  for (let page = 1; ; page++) {
    const res = await fetchPage({ ...params, page, page_size: pageSize });
    const items = res.items ?? [];
    for (const lead of items) yield lead;
    if (items.length === 0 || page * pageSize >= res.total) return;
  }
}
