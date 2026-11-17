export interface GroupableShadowObservation {
  readonly id: string;
  readonly checkout_session_ref: string | null;
  readonly observed_at: string;
  readonly form_id: string | null;
  readonly form_name: string | null;
  readonly client_name: string;
}

export interface GroupedShadowObservationCase<T extends GroupableShadowObservation> {
  readonly key: string;
  readonly sessionRef: string | null;
  readonly observations: readonly T[];
  readonly latestObservedAt: string;
  readonly formId: string | null;
  readonly formName: string | null;
  readonly clientName: string;
}

export function groupObservationsByCase<T extends GroupableShadowObservation>(
  observations: readonly T[],
): readonly GroupedShadowObservationCase<T>[] {
  const groups = new Map<string, T[]>();
  for (const observation of observations) {
    const key = observation.checkout_session_ref
      ? `session:${observation.checkout_session_ref}`
      : `observation:${observation.id}`;
    const current = groups.get(key) ?? [];
    current.push(observation);
    groups.set(key, current);
  }
  return [...groups.entries()].map(([key, grouped]) => {
    const latest = grouped[0];
    if (!latest) throw new Error("Customer case cannot be empty.");
    return {
      key,
      sessionRef: latest.checkout_session_ref,
      observations: grouped,
      latestObservedAt: latest.observed_at,
      formId: latest.form_id,
      formName: latest.form_name,
      clientName: latest.client_name,
    };
  });
}
