import { deepStrictEqual, equal, fail, ok } from 'node:assert/strict';

const checkout = Object.freeze({ id: 'checkout-1', amountMinor: 2499, currency: 'USD' });
const primaryAttempt = 'primary-1';
const backupAttempt = 'backup-1';

function pending() {
  return { attempts: ['primary'], captures: [], orders: [], reconciliation: ['pending', primaryAttempt] };
}

function paid(attempt, attempts) {
  return { attempts, captures: [attempt], orders: [attempt], reconciliation: ['paid', attempt] };
}

function startPendingSteps() {
  return [
    { event: 'start', primaryStatus: 'unknown', expected: pending() },
    { event: 'recheck', primaryStatus: 'not-found', expected: pending() },
  ];
}

function scenario(id, primaryCommitted, finalStatus, finalState) {
  return {
    id,
    primaryCommitted,
    steps: [
      ...startPendingSteps(),
      { event: 'recheck', primaryStatus: finalStatus, expected: finalState },
      { event: 'deadline', primaryStatus: finalStatus, expected: finalState },
      { event: 'recheck', primaryStatus: finalStatus, expected: finalState },
    ],
  };
}

export const scenarios = [
  scenario('late-primary-authorization', true, 'authorized', paid(primaryAttempt, ['primary'])),
  scenario('definitive-primary-rejection', false, 'rejected', paid(backupAttempt, ['primary', 'backup'])),
  scenario('no-definitive-evidence', true, 'unknown', pending()),
  {
    id: 'primary-rejection-after-deadline',
    primaryCommitted: false,
    steps: [
      ...startPendingSteps(),
      { event: 'deadline', primaryStatus: 'unknown', expected: pending() },
      {
        event: 'recheck',
        primaryStatus: 'rejected',
        expected: { ...pending(), reconciliation: ['unpaid', primaryAttempt] },
      },
    ],
  },
];

function createWorld(fixture) {
  let primaryStatus;
  const attempts = [];
  const captures = new Set();
  const orders = [];
  let reconciliation = null;

  function processor(name, attemptId, authorizationAccepted) {
    function checkAttempt(id) {
      equal(id, attemptId, `Wrong attempt for ${name}`);
      ok(attempts.includes(name), `${name} was never contacted`);
    }

    return {
      async authorize(request) {
        deepStrictEqual(request, checkout);
        ok(!attempts.includes(name), `Unexpected second authorization on ${name}`);
        attempts.push(name);
        return { attemptId, status: name === 'primary' ? 'unknown' : 'authorized' };
      },

      async status(id) {
        checkAttempt(id);
        return name === 'primary' ? primaryStatus : 'authorized';
      },

      async capture(id) {
        checkAttempt(id);
        equal(authorizationAccepted, true, `Cannot capture an unapproved authorization on ${name}`);
        // Repeated captures on this same attempt are idempotent in the synthetic processor.
        captures.add(id);
      },
    };
  }

  return {
    ports: {
      checkout,
      primary: processor('primary', primaryAttempt, fixture.primaryCommitted),
      backup: processor('backup', backupAttempt, true),
      async placeOrder(attemptId) {
        ok(captures.has(attemptId), 'Order placement must reference a captured payment');
        orders.push(attemptId);
      },
      async recordReconciliation(state, attemptId) {
        if (state === 'paid') {
          ok(captures.has(attemptId), 'Paid reconciliation must reference a captured payment');
        } else {
          ok(state === 'pending' || state === 'unpaid', `Unknown reconciliation state: ${state}`);
          equal(attemptId, primaryAttempt);
        }
        reconciliation = [state, attemptId];
      },
    },

    setPrimaryStatus(status) {
      primaryStatus = status;
    },

    snapshot() {
      return {
        attempts: [...attempts],
        captures: [...captures],
        orders: [...orders],
        reconciliation,
      };
    },
  };
}

/** Run an adapter against one isolated checkout and assert each observed checkpoint. */
export async function verifyScenario(fixture, createAdapter) {
  const world = createWorld(fixture);
  const handle = await createAdapter(world.ports);
  if (typeof handle !== 'function') fail('createAdapter must return an event handler');

  const checkpoints = [];
  for (const [index, step] of fixture.steps.entries()) {
    world.setPrimaryStatus(step.primaryStatus);
    await handle(step.event);
    const observed = world.snapshot();
    deepStrictEqual(
      observed,
      step.expected,
      `${fixture.id} step ${index + 1} (${step.event}). Primary status: ${step.primaryStatus}`,
    );
    checkpoints.push(observed);
  }

  return checkpoints;
}
