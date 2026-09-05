import 'server-only';

/**
 * One response envelope for every route.
 *
 * Two rules hold across the whole API surface:
 *
 * 1. **Error messages are written for the person, not the log.** A caller gets
 *    a sentence they could act on. Stack traces, provider messages, SQL text
 *    and environment details never cross the boundary — they are the raw
 *    material of an information-disclosure bug.
 * 2. **A machine-readable `code` accompanies the sentence**, so the client can
 *    branch (offer a reload on a conflict, a retry on a rate limit) without
 *    string-matching prose that will be reworded later.
 */
import { NextResponse } from 'next/server';

export const ERROR_CODES = {
  invalidRequest: 'invalid_request',
  unauthorized: 'unauthorized',
  notFound: 'not_found',
  conflict: 'conflict',
  rateLimited: 'rate_limited',
  unsupportedMode: 'unsupported_mode',
  serverError: 'server_error',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface ApiError {
  error: {
    code: ErrorCode;
    message: string;
    /** Field-level detail for form errors. Never includes raw input values. */
    fields?: Record<string, string>;
  };
}

export function jsonOk<T extends object>(
  data: T,
  init?: { headers?: Record<string, string>; status?: number },
): NextResponse<T> {
  return NextResponse.json(data, {
    status: init?.status ?? 200,
    headers: {
      // Planner responses are per-user and time-sensitive; caching them at any
      // layer would show one user another user's day.
      'Cache-Control': 'no-store',
      ...init?.headers,
    },
  });
}

export function jsonError(
  status: number,
  code: ErrorCode,
  message: string,
  extra?: { fields?: Record<string, string>; headers?: Record<string, string> },
): NextResponse<ApiError> {
  return NextResponse.json(
    { error: { code, message, ...(extra?.fields ? { fields: extra.fields } : {}) } },
    {
      status,
      headers: { 'Cache-Control': 'no-store', ...extra?.headers },
    },
  );
}

/** 413-style guard applied before parsing, so a huge body is never buffered. */
export const MAX_REQUEST_BYTES = 128 * 1024;

/**
 * Reads and parses a JSON body with a size ceiling.
 *
 * `Content-Length` is a hint a client can lie about, so the decoded string is
 * measured too. Returning a discriminated result rather than throwing keeps the
 * route handler's control flow explicit.
 */
export async function readJsonBody(
  request: Request,
): Promise<{ ok: true; value: unknown } | { ok: false; response: NextResponse<ApiError> }> {
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return {
      ok: false,
      response: jsonError(413, ERROR_CODES.invalidRequest, 'That request was too large.'),
    };
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    return {
      ok: false,
      response: jsonError(400, ERROR_CODES.invalidRequest, 'The request body could not be read.'),
    };
  }

  if (text.length > MAX_REQUEST_BYTES) {
    return {
      ok: false,
      response: jsonError(413, ERROR_CODES.invalidRequest, 'That request was too large.'),
    };
  }

  if (text.trim().length === 0) {
    return {
      ok: false,
      response: jsonError(400, ERROR_CODES.invalidRequest, 'The request body was empty.'),
    };
  }

  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return {
      ok: false,
      response: jsonError(400, ERROR_CODES.invalidRequest, 'The request body was not valid JSON.'),
    };
  }
}

/**
 * Flattens Zod issues into field messages.
 *
 * Only the path and the validator's own message are copied; the offending value
 * is never echoed back, so a rejected request cannot be used to bounce content
 * off the API.
 */
export function fieldErrors(
  issues: ReadonlyArray<{ path: ReadonlyArray<string | number | symbol>; message: string }>,
): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join('.') || 'root';
    fields[key] ??= issue.message;
  }
  return fields;
}
