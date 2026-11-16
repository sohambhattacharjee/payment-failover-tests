import { rejects } from 'node:assert/strict';
import { test } from 'node:test';
import { scenarios, verifyScenario } from '../index.mjs';
import { createReferenceAdapter } from '../reference.mjs';

for (const fixture of scenarios) {
  test(fixture.id, async () => {
    await verifyScenario(fixture, createReferenceAdapter);
  });
}

const lateAuthorization = scenarios.find(({ id }) => id === 'late-primary-authorization');
const definitiveRejection = scenarios.find(({ id }) => id === 'definitive-primary-rejection');
const expiredCheckout = scenarios.find(({ id }) => id === 'primary-rejection-after-deadline');

test('detects a backup attempt after a non-definitive lookup miss', async () => {
  function unsafeFailover(ports) {
    const handle = createReferenceAdapter(ports);
    return async (event) => {
      await handle(event);
      if (event === 'recheck') await ports.backup.authorize(ports.checkout);
    };
  }

  await rejects(
    () => verifyScenario(lateAuthorization, unsafeFailover),
    /late-primary-authorization step 2 \(recheck\)/,
  );
});

test('detects a checkout left pending after the primary definitively rejects it', async () => {
  function neverRecovers(ports) {
    const handle = createReferenceAdapter(ports);
    return async (event) => {
      if (event === 'start') await handle(event);
    };
  }

  await rejects(
    () => verifyScenario(definitiveRejection, neverRecovers),
    /definitive-primary-rejection step 3 \(recheck\)/,
  );
});

test('detects duplicate order creation even when the payment capture is idempotent', async () => {
  function duplicatesOrder(ports) {
    return createReferenceAdapter({
      ...ports,
      async placeOrder(attemptId) {
        await ports.placeOrder(attemptId);
        await ports.placeOrder(attemptId);
      },
    });
  }

  await rejects(
    () => verifyScenario(lateAuthorization, duplicatesOrder),
    /late-primary-authorization step 3 \(recheck\)/,
  );
});

test('detects a new backup charge after the checkout closes', async () => {
  function ignoresDeadline(ports) {
    const handle = createReferenceAdapter(ports);
    return async (event) => {
      if (event !== 'deadline') await handle(event);
    };
  }

  await rejects(
    () => verifyScenario(expiredCheckout, ignoresDeadline),
    /primary-rejection-after-deadline step 4 \(recheck\)/,
  );
});
