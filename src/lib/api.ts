export function apiPath(path: string): string {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${basePath}${normalized}`;
}

export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(apiPath(path), init);
}
