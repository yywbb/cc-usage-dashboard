async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status}`);
  return res.json();
}
export const api = {
  get:    <T>(url: string) => request<T>('GET', url),
  post:   <T>(url: string, body?: unknown) => request<T>('POST', url, body),
  put:    <T>(url: string, body?: unknown) => request<T>('PUT', url, body),
  patch:  <T>(url: string, body?: unknown) => request<T>('PATCH', url, body),
  delete: <T>(url: string) => request<T>('DELETE', url),
};
