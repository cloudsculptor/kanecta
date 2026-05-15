export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(
  baseUrl: string,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, (body as { error?: string }).error ?? res.statusText);
  }
  return body as T;
}

export function makeClient(baseUrl: string) {
  return {
    get: <T>(path: string) => request<T>(baseUrl, path),
    post: <T>(path: string, data?: unknown) =>
      request<T>(baseUrl, path, { method: 'POST', body: JSON.stringify(data) }),
    put: <T>(path: string, data?: unknown) =>
      request<T>(baseUrl, path, { method: 'PUT', body: JSON.stringify(data) }),
    delete: <T>(path: string) => request<T>(baseUrl, path, { method: 'DELETE' }),
  };
}

export type ApiClient = ReturnType<typeof makeClient>;
