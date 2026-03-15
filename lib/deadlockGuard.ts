export type DeadlockObservation = {
  signature: string;
  firstDetectedAtMs: number;
};

export function evaluateDeadlockObservation(params: {
  previous: DeadlockObservation | null;
  signature: string;
  nowMs: number;
  confirmAfterMs: number;
}): { next: DeadlockObservation; promote: boolean } {
  const { previous, signature, nowMs, confirmAfterMs } = params;

  if (!previous || previous.signature !== signature) {
    return {
      next: {
        signature,
        firstDetectedAtMs: nowMs,
      },
      promote: false,
    };
  }

  return {
    next: previous,
    promote: nowMs - previous.firstDetectedAtMs >= Math.max(0, confirmAfterMs),
  };
}
