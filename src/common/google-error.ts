export function parseGoogleError(err: any): { message: string; statusCode?: number; retryAfterSeconds?: number } {
  const out: { message: string; statusCode?: number; retryAfterSeconds?: number } = {
    message: err?.message ?? String(err),
  };

  const data = err?.response?.data ?? err?.data ?? null;

  if (data) {
    try {
      if (data.error) {
        out.message = data.error.message ?? out.message;
        out.statusCode = data.error.code ?? err?.response?.status;
        const details = data.error.details;
        if (Array.isArray(details)) {
          for (const d of details) {
            if (d['@type'] && (d['@type'].includes('RetryInfo') || d?.retryDelay)) {
              const retryDelay = d['retryDelay'] ?? d?.retryDelay;
              if (retryDelay && typeof retryDelay === 'string') {
                const sMatch = retryDelay.match(/(\d+)(?:\.\d+)?/);
                if (sMatch) out.retryAfterSeconds = Math.ceil(Number(sMatch[1]));
              }
            }
          }
        }
      } else if (typeof data === 'string') {
        const parsed = JSON.parse(data);
        if (parsed?.error) {
          out.message = parsed.error.message ?? out.message;
          out.statusCode = parsed.error.code ?? out.statusCode;
        }
      }
    } catch {}
  } else {
    try {
      const m = String(err?.message ?? '');
      const match = m.match(/"retryDelay"\s*:\s*"(.*?)"/);
      if (match && match[1]) {
        const s = match[1].replace('s', '');
        const n = Number(s);
        if (!Number.isNaN(n)) out.retryAfterSeconds = Math.ceil(n);
      }
    } catch {}
  }

  if (!out.statusCode && err?.response?.status) out.statusCode = err.response.status;
  return out;
}
