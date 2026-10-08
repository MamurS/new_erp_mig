export const HEADERS_FILE: string;
export const CADDYFILE: string;
export function parseHeaders(text: string): { path: string; headers: [string, string][] }[];
export function caddyBlocks(rules: { path: string; headers: [string, string][] }[]): {
  site: string;
  paths: string;
};
export function renderCaddyfile(caddyfile: string, headersText: string): string;
