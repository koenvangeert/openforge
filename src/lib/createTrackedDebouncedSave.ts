interface CreateTrackedDebouncedSaveOptions {
  delayMs: number;
  save: () => Promise<void>;
}

interface DeferredPromise {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
}

export interface TrackedDebouncedSave {
  schedule: () => Promise<void>;
  flush: () => Promise<void>;
  runImmediately: () => Promise<void>;
  isPending: () => boolean;
}

function createDeferredPromise(): DeferredPromise {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;

  const promise = new Promise<void>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return { promise, resolve, reject };
}

export function createTrackedDebouncedSave({ delayMs, save }: CreateTrackedDebouncedSaveOptions): TrackedDebouncedSave {
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let inFlightPromise: Promise<void> | null = null;
  let pendingCompletion: DeferredPromise | null = null;
  let rerunRequested = false;

  function clearTimer(): void {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
  }

  function ensurePendingCompletion(): DeferredPromise {
    if (!pendingCompletion) {
      pendingCompletion = createDeferredPromise();
    }

    return pendingCompletion;
  }

  function resolvePendingCompletion(): void {
    pendingCompletion?.resolve();
    pendingCompletion = null;
  }

  function rejectPendingCompletion(error: unknown): void {
    pendingCompletion?.reject(error);
    pendingCompletion = null;
  }

  function runSaveLoop(): Promise<void> {
    const completion = ensurePendingCompletion();

    if (inFlightPromise) {
      return completion.promise;
    }

    inFlightPromise = (async () => {
      try {
        do {
          rerunRequested = false;
          await save();
        } while (rerunRequested);

        resolvePendingCompletion();
      } catch (error) {
        rejectPendingCompletion(error);
        throw error;
      } finally {
        inFlightPromise = null;
      }
    })();

    return completion.promise;
  }

  function schedule(): Promise<void> {
    const completion = ensurePendingCompletion();

    if (inFlightPromise) {
      rerunRequested = true;
      return completion.promise;
    }

    clearTimer();
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void runSaveLoop().catch(() => {});
    }, delayMs);

    return completion.promise;
  }

  function flush(): Promise<void> {
    if (saveTimer) {
      clearTimer();
      return runSaveLoop();
    }

    return inFlightPromise ?? pendingCompletion?.promise ?? Promise.resolve();
  }

  function runImmediately(): Promise<void> {
    clearTimer();
    const completion = ensurePendingCompletion();

    if (inFlightPromise) {
      rerunRequested = true;
      return completion.promise;
    }

    return runSaveLoop();
  }

  function isPending(): boolean {
    return saveTimer !== null || inFlightPromise !== null;
  }

  return {
    schedule,
    flush,
    runImmediately,
    isPending,
  };
}
