import { StageError } from './errors.ts';

export interface OutgoingRequest {
  method: string;
  url: URL;
  headers: Headers;
  body?: string;
}

export interface IncomingResponse {
  status: number;
  statusText: string;
  contentType: string;
  text: string;
  url: string;
}

export interface SendOptions {
  timeoutMs?: number;
  maxBytes?: number;
  retries?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

function retryDelay(res: Response, attempt: number): number {
  const header = res.headers.get('retry-after');
  if (header) {
    const secs = Number(header);
    const ms = Number.isFinite(secs) ? secs * 1000 : new Date(header).getTime() - Date.now();
    if (Number.isFinite(ms) && ms >= 0) return Math.min(ms, 10_000);
  }
  return Math.min(500 * 2 ** attempt, 5000);
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel();
    throw new StageError('http', `The response is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  }
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new StageError('http', `The response is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`);
    }
    chunks.push(value);
  }
  const charset = res.headers.get('content-type')?.match(/charset=([\w-]+)/i)?.[1] ?? 'utf-8';
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(charset);
  } catch {
    decoder = new TextDecoder('utf-8');
  }
  return decoder.decode(Buffer.concat(chunks));
}

/** Sends a request with a timeout, a size cap and a couple of retries on 429 and 5xx. */
export async function send(req: OutgoingRequest, opts: SendOptions = {}): Promise<IncomingResponse> {
  const {
    timeoutMs = 15_000,
    maxBytes = MAX_RESPONSE_BYTES,
    retries = 2,
    fetchImpl = fetch,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = opts;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetchImpl(req.url, {
        method: req.method,
        headers: req.headers,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body,
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const e = err as Error & { cause?: { code?: string; message?: string } };
      if (e.name === 'TimeoutError' || e.name === 'AbortError') {
        throw new StageError('http', `No answer from ${req.url.host} within ${timeoutMs / 1000} s.`);
      }
      throw new StageError('http', `Couldn't reach ${req.url.host}: ${e.cause?.code ?? e.cause?.message ?? e.message}`);
    }
    if (RETRY_STATUSES.has(res.status) && attempt < retries) {
      const delay = retryDelay(res, attempt);
      await res.body?.cancel();
      await sleep(delay);
      continue;
    }
    return {
      status: res.status,
      statusText: res.statusText,
      contentType: res.headers.get('content-type') ?? '',
      text: await readCapped(res, maxBytes),
      url: res.url || req.url.href,
    };
  }
}
