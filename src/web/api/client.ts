async function request<T>(method: string, url: string): Promise<T> {
  const res = await fetch(url, { method });
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status}`);
  return res.json();
}
export const api = {
  get:  <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string) => request<T>('POST', url),
};
