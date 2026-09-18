/** Bounded registration request. Deliberately excludes sensitive response bodies from errors. */
export async function registrationRequest<T>(
  url: string,
  signal: AbortSignal,
  body?: Record<string, unknown>
): Promise<T> {
  const response = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`Registration HTTP ${response.status}`);
  return (await response.json()) as T;
}

export interface RegistrationOptions {
  signal: AbortSignal;
  onQRCodeReady: (info: { url: string; expireIn: number }) => void;
}
