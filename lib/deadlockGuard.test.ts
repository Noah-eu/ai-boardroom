import { describe, expect, it } from 'vitest';
import { evaluateDeadlockObservation } from './deadlockGuard';

describe('deadlockGuard', () => {
  it('does not promote deadlock on first observation', () => {
    const result = evaluateDeadlockObservation({
      previous: null,
      signature: 'p1:sig-a',
      nowMs: 1_000,
      confirmAfterMs: 2_000,
    });

    expect(result.promote).toBe(false);
    expect(result.next.signature).toBe('p1:sig-a');
    expect(result.next.firstDetectedAtMs).toBe(1_000);
  });

  it('does not promote transient stall before confirmation window', () => {
    const first = evaluateDeadlockObservation({
      previous: null,
      signature: 'p1:sig-a',
      nowMs: 1_000,
      confirmAfterMs: 2_000,
    });

    const second = evaluateDeadlockObservation({
      previous: first.next,
      signature: 'p1:sig-a',
      nowMs: 2_200,
      confirmAfterMs: 2_000,
    });

    expect(second.promote).toBe(false);
  });

  it('promotes real deadlock only after no-progress window', () => {
    const first = evaluateDeadlockObservation({
      previous: null,
      signature: 'p1:sig-a',
      nowMs: 1_000,
      confirmAfterMs: 2_000,
    });

    const second = evaluateDeadlockObservation({
      previous: first.next,
      signature: 'p1:sig-a',
      nowMs: 3_500,
      confirmAfterMs: 2_000,
    });

    expect(second.promote).toBe(true);
  });

  it('resets observation window when signature changes', () => {
    const first = evaluateDeadlockObservation({
      previous: null,
      signature: 'p1:sig-a',
      nowMs: 1_000,
      confirmAfterMs: 2_000,
    });

    const second = evaluateDeadlockObservation({
      previous: first.next,
      signature: 'p1:sig-b',
      nowMs: 4_000,
      confirmAfterMs: 2_000,
    });

    expect(second.promote).toBe(false);
    expect(second.next.signature).toBe('p1:sig-b');
    expect(second.next.firstDetectedAtMs).toBe(4_000);
  });
});
