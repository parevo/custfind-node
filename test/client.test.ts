import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Custfind, CustfindError, verifyWebhook, WebhookVerificationError } from "../src/index.js";

type Seen = { method: string; url: string; headers: IncomingMessage["headers"]; body: string };

async function server(handler: (req: Seen, n: number) => { status: number; body?: unknown; headers?: Record<string, string> }) {
  const seen: Seen[] = [];
  const srv = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const s = { method: req.method ?? "", url: req.url ?? "", headers: req.headers, body };
      seen.push(s);
      const out = handler(s, seen.length);
      res.writeHead(out.status, { "Content-Type": "application/json", ...(out.headers ?? {}) });
      res.end(out.body === undefined ? "" : JSON.stringify(out.body));
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const { port } = srv.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, seen, close: () => new Promise((r) => srv.close(r)) };
}

test("sends the key, query and body; parses JSON", async () => {
  const s = await server(() => ({ status: 202, body: { job_id: "j1", status: "queued" } }));
  const cf = new Custfind({ apiKey: "cf_live_test", baseUrl: s.url });
  const res = await cf.searches.create({ sector: "Dental clinic", location: "Istanbul", limit: 25 });
  assert.equal(res.job_id, "j1");
  assert.equal(s.seen[0].method, "POST");
  assert.equal(s.seen[0].url, "/v1/searches");
  assert.equal(s.seen[0].headers.authorization, "Bearer cf_live_test");
  assert.deepEqual(JSON.parse(s.seen[0].body), { sector: "Dental clinic", location: "Istanbul", limit: 25 });
  assert.ok(s.seen[0].headers["idempotency-key"], "writes carry an Idempotency-Key");
  await cf.leads.list({ min_score: 70, contact: "email" });
  assert.equal(s.seen[1].url, "/v1/leads?min_score=70&contact=email");
  assert.equal(s.seen[1].headers["idempotency-key"], undefined, "reads do not");
  await s.close();
});

test("retries 5xx and 429 with the same Idempotency-Key", async () => {
  const s = await server((_r, n) => (n === 1 ? { status: 503, body: { error: "x" } } : n === 2 ? { status: 429, body: { error: "rate_limited" }, headers: { "Retry-After": "0" } } : { status: 202, body: { job_id: "j2" } }));
  const cf = new Custfind({ apiKey: "k", baseUrl: s.url, maxRetries: 3 });
  const res = await cf.searches.create({ sector: "x" });
  assert.equal(res.job_id, "j2");
  assert.equal(s.seen.length, 3);
  const keys = new Set(s.seen.map((r) => r.headers["idempotency-key"]));
  assert.equal(keys.size, 1, "one key across retries");
  await s.close();
});

test("raises CustfindError with the API code; no retry on 4xx", async () => {
  const s = await server(() => ({ status: 402, body: { error: "customer_limit_reached" } }));
  const cf = new Custfind({ apiKey: "k", baseUrl: s.url });
  await assert.rejects(cf.searches.create({ sector: "x", external_customer_id: "acme" }), (err: unknown) => {
    assert.ok(err instanceof CustfindError);
    assert.equal(err.status, 402);
    assert.equal(err.code, "customer_limit_reached");
    return true;
  });
  assert.equal(s.seen.length, 1);
  await s.close();
});

test("encodes ids in paths and handles 204", async () => {
  const s = await server(() => ({ status: 204 }));
  const cf = new Custfind({ apiKey: "k", baseUrl: s.url });
  assert.equal(await cf.customers.removeLimit("acme/eu 1"), undefined);
  assert.equal(s.seen[0].url, "/v1/customers/acme%2Feu%201/limit");
  assert.equal(s.seen[0].method, "DELETE");
  await s.close();
});

test("waitForCompletion polls until a final status", async () => {
  const statuses = ["queued", "processing", "completed"];
  const s = await server((_r, n) => ({ status: 200, body: { id: "j", status: statuses[Math.min(n - 1, 2)] } }));
  const cf = new Custfind({ apiKey: "k", baseUrl: s.url });
  const done = await cf.searches.waitForCompletion("j", { intervalMs: 5 });
  assert.equal(done.status, "completed");
  assert.equal(s.seen.length, 3);
  await s.close();
});

test("verifyWebhook accepts a valid signature and rejects tampering", () => {
  const secret = "whsec_test";
  const body = JSON.stringify({ id: "evt", type: "search.completed", data: { id: "j" } });
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  const event = verifyWebhook(body, `t=${t},v1=${sig}`, secret);
  assert.equal(event.type, "search.completed");
  assert.throws(() => verifyWebhook(body + " ", `t=${t},v1=${sig}`, secret), WebhookVerificationError);
  assert.throws(() => verifyWebhook(body, `t=${t},v1=${sig}`, "whsec_other"), WebhookVerificationError);
  assert.throws(() => verifyWebhook(body, `t=${t - 3600},v1=${sig}`, secret), WebhookVerificationError);
  assert.throws(() => verifyWebhook(body, "garbage", secret), WebhookVerificationError);
});

test("retries a write still in progress, but not a final 409", async () => {
  const s = await server((_r, n) =>
    n === 1 ? { status: 409, body: { error: "idempotency_in_progress" }, headers: { "Retry-After": "0" } } : n === 2 ? { status: 200, body: { id: "j" } } : { status: 409, body: { error: "invalid job state" } },
  );
  const cf = new Custfind({ apiKey: "k", baseUrl: s.url });
  assert.equal((await cf.searches.cancel("j")).id, "j");
  assert.equal(s.seen.length, 2);
  assert.equal(s.seen[0].headers["idempotency-key"], s.seen[1].headers["idempotency-key"]);
  await assert.rejects(cf.searches.cancel("j"), (err: unknown) => err instanceof CustfindError && err.status === 409 && err.code === "invalid job state");
  assert.equal(s.seen.length, 3, "a final 409 is not retried");
  await s.close();
});

test("keeps the text of a plain-text error", async () => {
  const s = await server(() => ({ status: 400 }));
  const cf = new Custfind({
    apiKey: "k",
    baseUrl: s.url,
    fetch: async () => new Response("invalid json body\n", { status: 400, headers: { "Content-Type": "text/plain" } }),
  });
  await assert.rejects(cf.deals.create({ lead_id: "l" }), (err: unknown) => err instanceof CustfindError && err.code === "http_400" && err.message.includes("invalid json body"));
  await s.close();
});

test("search leads take filters and allLeads pages through them", async () => {
  const s = await server((_r, n) => ({ status: 200, body: n === 1 ? { items: [{ id: "a" }, { id: "b" }], total: 3, page: 1, page_size: 2 } : { items: [{ id: "c" }], total: 3, page: 2, page_size: 2 } }));
  const cf = new Custfind({ apiKey: "k", baseUrl: s.url });
  const ids: string[] = [];
  for await (const lead of cf.searches.allLeads("j1", { page_size: 2, min_score: 60, sort: "score_desc" })) ids.push(lead.id);
  assert.deepEqual(ids, ["a", "b", "c"]);
  assert.equal(s.seen[0].url, "/v1/searches/j1/leads?page_size=2&min_score=60&sort=score_desc&page=1");
  assert.equal(s.seen[1].url, "/v1/searches/j1/leads?page_size=2&min_score=60&sort=score_desc&page=2");
  await s.close();
});

test("send takes a Date and an aborted signal stops the call", async () => {
  const s = await server(() => ({ status: 202, body: { id: "m" } }));
  const cf = new Custfind({ apiKey: "k", baseUrl: s.url });
  await cf.outreach.send("m", { scheduled_at: new Date(Date.UTC(2026, 2, 1, 6)) });
  assert.equal(s.seen[0].body, '{"scheduled_at":"2026-03-01T06:00:00Z"}');
  const ctrl = new AbortController();
  ctrl.abort();
  await assert.rejects(cf.request("GET", "/v1/me", { signal: ctrl.signal }));
  assert.equal(s.seen.length, 1, "an aborted call is not retried");
  await s.close();
});

test("verifyWebhook accepts a signature made by the API", () => {
  // Signed by the API's shared.WebhookSignatureValue.
  const body = '{"id":"evt_1","type":"search.completed","created_at":"2023-11-14T22:13:20Z","organization_id":"org_1","data":{"id":"job_1","status":"completed","leads_found":12}}';
  const header = "t=1700000000,v1=09714fde5144a52b4b8218ce4fbd186b9cb1fce94a75f5396bfbc54f6fbee486";
  const event = verifyWebhook(body, header, "whsec_test", Infinity);
  assert.equal(event.type, "search.completed");
  if (event.type === "search.completed") assert.equal(event.data.leads_found, 12);
});
