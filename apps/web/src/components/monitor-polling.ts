/** One request at a time; hidden/offline pages retain their last successful result. */
export function startMonitorPolling<T>(options: {
  load: (signal: AbortSignal) => Promise<T>;
  receive: (value: T) => void;
  fail: (error: unknown) => void;
  refreshing: (value: boolean) => void;
}) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: AbortController | null = null;
  let failures = 0;
  const available = () => !document.hidden && navigator.onLine;
  const pause = () => {
    clearTimeout(timer);
    active?.abort();
    active = null;
    options.refreshing(false);
  };
  const refresh = async () => {
    clearTimeout(timer);
    if (stopped || !available()) return;
    active?.abort();
    const controller = new AbortController();
    active = controller;
    options.refreshing(true);
    try {
      const data = await options.load(controller.signal);
      if (stopped || controller !== active || controller.signal.aborted) return;
      failures = 0;
      options.receive(data);
    } catch (error) {
      if (stopped || controller !== active || controller.signal.aborted) return;
      failures += 1;
      options.fail(error);
    } finally {
      if (!stopped && controller === active) {
        active = null;
        options.refreshing(false);
        if (available()) timer = setTimeout(refresh, Math.min(300_000, 30_000 * 2 ** failures));
      }
    }
  };
  const availabilityChanged = () => {
    pause();
    if (available()) void refresh();
  };
  document.addEventListener("visibilitychange", availabilityChanged);
  window.addEventListener("online", availabilityChanged);
  window.addEventListener("offline", availabilityChanged);
  void refresh();
  return () => {
    stopped = true;
    pause();
    document.removeEventListener("visibilitychange", availabilityChanged);
    window.removeEventListener("online", availabilityChanged);
    window.removeEventListener("offline", availabilityChanged);
  };
}
