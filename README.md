# Payment Failover Tests

These deterministic fixtures test a checkout that loses the response from its primary payment processor while a backup is available. The adapter drives the checkout under test. The harness observes authorization attempts, completed captures, order creation, and reconciliation records directly through synthetic ports.

## Run locally

Use Node.js 20 or later. Run the tests from this directory. The project has no dependencies to install.

```sh
node --test
```

All four fixtures begin with a timeout and a non-definitive status lookup. They then diverge:

| Later evidence | Expected outcome |
| --- | --- |
| The primary confirms authorization | Capture on the primary and place one order. |
| The primary confirms terminal rejection | Authorize and capture on the backup and place one order. |
| The outcome remains unknown at the checkout deadline | Preserve the primary attempt for reconciliation and leave the checkout pending. |
| The primary confirms terminal rejection after the checkout deadline | Resolve reconciliation as unpaid without placing an order or charging the backup. |

The tests include intentionally incorrect adapters to confirm that premature failover, stalled recovery after decisive evidence, duplicate orders, and backup charging after the deadline are detected.

## Adapt a checkout

Import `scenarios` and `verifyScenario` from `index.mjs`. An adapter receives the synthetic `checkout`, `primary` and `backup` processors (`authorize`, `status`, `capture`), and sinks for `placeOrder` and `recordReconciliation`. Return an async handler for `start`, `recheck`, and `deadline` that maps those events and ports to the checkout under test. Each fixture creates a fresh world. See `reference.mjs` for a complete example.

## First upstream validation

Compare the fixtures against [Hyperswitch's connector tests](https://github.com/juspay/hyperswitch-prism/blob/main/setup.md) and [multi-processor retry behavior](https://github.com/juspay/hyperswitch-docs/blob/main/integration-guide/workflows/smart-retries/README.md). The first contribution candidate is a runner-specific test that connects late primary evidence to both processor effects and merchant outcomes. Check the existing orchestration and merchant tests before proposing it upstream.

The normalized evidence and deadline are simulated. Authorization status, lookup finality, and capture idempotency vary by integration. These cases cover a single checkout and assume a healthy backup, reliable status once definitive, and idempotent same-attempt captures. Handling a primary authorization that becomes visible after the deadline depends on the merchant's cancellation and fulfillment policy and falls outside these fixtures. No integration with an actual processor or outside project has been verified.
