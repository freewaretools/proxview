export class ApiError extends Error {
  status: number;
  /** Human-readable explanation, when the server sends one alongside the error code. */
  detail?: string;
  constructor(status: number, code: string, detail?: string) {
    super(code);
    this.status = status;
    this.detail = detail;
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  // Only advertise a JSON content-type when we're actually sending a body —
  // Fastify 400s on an empty body with content-type: application/json.
  const hasBody = options?.body != null;
  const res = await fetch(path, {
    ...options,
    headers: {
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
      ...(options?.headers ?? {}),
    },
    credentials: 'same-origin',
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new ApiError(res.status, (data && data.error) || res.statusText || 'error', data?.message);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'PUT',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
