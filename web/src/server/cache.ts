import "server-only";

type Entry<T> = { value?: T; expires: number; pending?: Promise<T> };
const store = new Map<string, Entry<unknown>>();

/**
 * Per-instance read-through cache. Concurrent callers share one in-flight request, and a failed
 * refresh keeps serving the last good value so the UI never drops to empty on an RPC hiccup.
 */
export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit?.value !== undefined && hit.expires > now) return hit.value;
  if (hit?.pending) return hit.pending;
  const pending = load()
    .then((value) => { store.set(key, { value, expires: Date.now() + ttlMs }); return value; })
    .catch((e) => {
      if (hit?.value !== undefined) { store.set(key, { value: hit.value, expires: Date.now() + 5_000 }); return hit.value; }
      store.delete(key);
      throw e;
    });
  store.set(key, { ...(hit ?? { expires: 0 }), pending });
  return pending;
}
