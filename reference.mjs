/** Illustrative policy for the synthetic contract. */
export function createReferenceAdapter(ports) {
  const { checkout, primary, backup, placeOrder, recordReconciliation } = ports;
  let primaryAttempt;
  let resolved = false;
  let checkoutClosed = false;

  async function finalize(processor, attemptId) {
    await processor.capture(attemptId);
    await placeOrder(attemptId);
    await recordReconciliation('paid', attemptId);
    resolved = true;
  }

  return async function handle(event) {
    if (event === 'start') {
      ({ attemptId: primaryAttempt } = await primary.authorize(checkout));
      await recordReconciliation('pending', primaryAttempt);
      return;
    }

    if (event === 'deadline') {
      checkoutClosed = true;
      return;
    }

    if (event !== 'recheck' || resolved) return;

    const status = await primary.status(primaryAttempt);
    if (status === 'authorized') {
      await finalize(primary, primaryAttempt);
    } else if (status === 'rejected') {
      if (checkoutClosed) {
        await recordReconciliation('unpaid', primaryAttempt);
        resolved = true;
      } else {
        const { attemptId } = await backup.authorize(checkout);
        await finalize(backup, attemptId);
      }
    }
  };
}
