import { AsyncQueuer } from "@tanstack/react-pacer/async-queuer";

/**
 * Queue / async test utilities. These deliberately use REAL wall-clock timeouts
 * (never fake timers) so a genuine hang — the "nunca termina" bug these tests
 * exist to catch — FAILS the test with a clear message instead of stalling
 * forever.
 */

export interface WaitOptions {
  /** Hard ceiling in ms. Rejects (test fails) if the predicate never holds. */
  readonly timeout: number;
  /** Poll interval in ms. Defaults to 10ms. */
  readonly interval?: number;
  /** Human label used in the timeout error. */
  readonly label: string;
}

/** Poll `predicate` until it returns true, or reject after `timeout` ms. */
export async function waitFor(
  predicate: () => boolean,
  { timeout, interval = 10, label }: WaitOptions,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) {
      throw new Error(`Timed out after ${timeout}ms waiting for: ${label}`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, interval));
  }
}

/**
 * Busy is derived EXACTLY like the shipping components do: there is work as long
 * as the queuer has an active or pending item. We NEVER look at `isRunning`
 * (which stays true after `start()` — the "never finishes" trap).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function queuerBusy(queuer: AsyncQueuer<any>): boolean {
  const s = queuer.store.state;
  return s.activeItems.length > 0 || s.items.length > 0;
}

/** Wait until the queuer has fully drained (busy → false). */
export async function waitForDrain(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  queuer: AsyncQueuer<any>,
  timeout: number,
): Promise<void> {
  await waitFor(() => !queuerBusy(queuer), {
    timeout,
    label: "the async queue to drain (activeItems + items === 0)",
  });
}

export { AsyncQueuer };
