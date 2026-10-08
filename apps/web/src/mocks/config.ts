/* Runtime switches of the mock server. */
export const mockConfig = {
  /** 10 % of requests fail with 500 when enabled (demo toggle). */
  failures: false,
  /** Random latency range in ms. Zero in unit tests. */
  latency: import.meta.env.MODE === 'test' ? ([0, 0] as const) : ([150, 450] as const),
  xss: import.meta.env.VITE_SEED_XSS === 'true',
};
