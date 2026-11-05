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

Every write is sent with an `Idempotency-Key` that stays the same across retries, and network errors, `409`, `429` (respecting `Retry-After`) and `5xx` are retried up to `maxRetries` (3). A timed-out search is never started twice. Pass your own key to make a retry across process restarts safe too:

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
    if (event.type === "search.completed") { /* … */ }
    res.sendStatus(200);
  } catch {
    res.sendStatus(400);
  }
});
```

## Resources

`searches`, `leads`, `outreach`, `pipelines`, `deals`, `webhooks`, `customers`, `senderAccounts`, plus `me()`, `balance()` and `usage()`. See the [API reference](https://custfind.com/developers).

## Developing

```bash
npm install && npm test
```
