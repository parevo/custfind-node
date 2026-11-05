# @custfind/node

Official Node.js client for the [Custfind API](https://custfind.com/developers): start lead searches, read scored leads, write and send emails, move deals and receive webhooks. No dependencies; Node 18+.

```bash
npm install @custfind/node
```

```js
import { Custfind } from "@custfind/node";

const cf = new Custfind({ apiKey: process.env.CUSTFIND_API_KEY });

const { job_id } = await cf.searches.create({
  sector: "Dental clinic",
  location: "Kadıköy, Istanbul",
  limit: 25,                       // caps the credits this search reserves
  external_customer_id: "acme-42", // optional: bill your own customer
});

await cf.searches.waitForCompletion(job_id);
for await (const lead of cf.searches.allLeads(job_id)) {
  console.log(lead.name, lead.email, lead.score);
}
```

## Safe retries

Every write is sent with an `Idempotency-Key` that stays the same across retries, and network errors, `429` (respecting `Retry-After`), `5xx` and `409 idempotency_in_progress` are retried up to `maxRetries` (3). Any other `409` is final and thrown at once. A timed-out search is never started twice. Pass your own key to make a retry across process restarts safe too:

```js
await cf.searches.create(params, { idempotencyKey: `search-${order.id}` });
```

## Errors

Failed calls throw `CustfindError` with `status` and the API's `code` (`api_requires_paid_plan`, `customer_limit_reached`, `insufficient_scope`, …).

## Webhooks

```js
import express from "express";
import { verifyWebhook } from "@custfind/node";

app.post("/webhooks/custfind", express.raw({ type: "application/json" }), (req, res) => {
  try {
    const event = verifyWebhook(req.body, req.get("Custfind-Signature"), process.env.CUSTFIND_WEBHOOK_SECRET);
    if (event.type === "lead.created") console.log(event.data.name); // data is typed per event
    res.sendStatus(200);
  } catch {
    res.sendStatus(400);
  }
});
```

## Resources

Lists page with `searches.allLeads(id, filters)` and `leads.all(filters)` (async iterators).

`searches`, `leads`, `outreach`, `pipelines`, `deals`, `webhooks`, `customers`, `senderAccounts`, plus `me()`, `balance()` and `usage()`. See the [API reference](https://custfind.com/developers).

## Contributing

This repository is a read-only mirror of `sdks/node` in Custfind's main repository, updated on every release. Issues are welcome here; pull requests are read and ported by hand, then closed, since the next release overwrites this repository.

## Developing

```bash
npm install && npm test
```

## Changelog

- **1.1.0** — Only `409 idempotency_in_progress` is retried (a final 409 used to be retried until it gave up). Works on Node 18 (no `AbortSignal.any`). Typed webhook events per `type` (`verifyWebhook` is no longer generic). `searches.leads`/`allLeads` take every lead filter; new `leads.all`; `leads.get` returns enrichment, emails and calls; `leads.crm` and `outreach.list` (with `stats`) are typed; `seller_profile_id` on searches, `assigned_user_id` on deals; `outreach.send` takes a `Date`; plain-text error bodies are kept in the message.
