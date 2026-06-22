export class FetchTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`);
    this.name = "FetchTimeoutError";
  }
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit & { timeoutMs?: number; label?: string }
): Promise<Response> {
  const timeoutMs = init?.timeoutMs ?? 30_000;
  const label = init?.label ?? "Request";
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const { timeoutMs: _t, label: _l, ...rest } = init ?? {};
    return await fetch(input, {
      ...rest,
      signal: rest.signal ?? controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new FetchTimeoutError(label, timeoutMs);
    }
    throw err;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function fetchJsonWithTimeout<T = unknown>(
  input: RequestInfo | URL,
  init?: RequestInit & { timeoutMs?: number; label?: string }
): Promise<{ res: Response; data: T }> {
  const res = await fetchWithTimeout(input, init);
  let data: T;
  try {
    data = (await res.json()) as T;
  } catch {
    throw new Error(
      `${init?.label ?? "Request"} returned HTTP ${res.status} with a non-JSON body`
    );
  }
  return { res, data };
}

export function formatFetchError(err: unknown, action: string): string {
  if (err instanceof FetchTimeoutError) {
    return `${action}: ${err.message}. The server may still be processing — refresh the page.`;
  }
  if (err instanceof TypeError && err.message === "Failed to fetch") {
    return `${action}: network error (Failed to fetch). Check your connection and try again.`;
  }
  if (err instanceof Error) {
    return `${action}: ${err.message}`;
  }
  return `${action}: unexpected error`;
}
