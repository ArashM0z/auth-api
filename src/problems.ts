/**
 * RFC 9457 "Problem Details for HTTP APIs". Every non-2xx response the API
 * produces uses this one format (application/problem+json), with a stable
 * machine-readable `code` and a documented `type` URI per problem.
 */
import type { FastifyRequest } from 'fastify';

interface ProblemDefinition {
  readonly status: number;
  readonly slug: string;
  readonly title: string;
}

export const PROBLEM_TYPES = {
  VALIDATION_ERROR: { status: 400, slug: 'validation-error', title: 'Request failed validation' },
  MALFORMED_BODY: { status: 400, slug: 'malformed-body', title: 'Request body is not valid JSON' },
  INVALID_CREDENTIALS: { status: 401, slug: 'invalid-credentials', title: 'Invalid credentials' },
  NOT_FOUND: { status: 404, slug: 'not-found', title: 'Resource not found' },
  METHOD_NOT_ALLOWED: { status: 405, slug: 'method-not-allowed', title: 'Method not allowed' },
  USERNAME_TAKEN: { status: 409, slug: 'username-taken', title: 'Username already exists' },
  PAYLOAD_TOO_LARGE: { status: 413, slug: 'payload-too-large', title: 'Request body too large' },
  UNSUPPORTED_MEDIA_TYPE: {
    status: 415,
    slug: 'unsupported-media-type',
    title: 'Unsupported media type',
  },
  INVALID_USERNAME: {
    status: 422,
    slug: 'invalid-username',
    title: 'Username does not meet requirements',
  },
  WEAK_PASSWORD: { status: 422, slug: 'weak-password', title: 'Password does not meet policy' },
  RATE_LIMITED: { status: 429, slug: 'rate-limited', title: 'Too many requests' },
  INTERNAL_ERROR: { status: 500, slug: 'internal-error', title: 'Internal server error' },
  SERVICE_UNAVAILABLE: {
    status: 503,
    slug: 'service-unavailable',
    title: 'Service temporarily unavailable',
  },
} as const satisfies Record<string, ProblemDefinition>;

export type ProblemCode = keyof typeof PROBLEM_TYPES;

// Mutable shapes: these must be assignable to the TypeBox-derived reply
// types, and Static<> produces mutable properties/arrays.
export interface FieldError {
  field: string;
  rule: string;
  message: string;
}

export interface ProblemBody {
  type: string;
  title: string;
  status: number;
  code: ProblemCode;
  detail?: string;
  instance?: string;
  requestId?: string;
  errors?: FieldError[];
}

interface ProblemOptions {
  detail?: string;
  errors?: FieldError[];
  headers?: Record<string, string>;
}

/** Throwable problem; the global error handler renders it as problem+json. */
export class ProblemError extends Error {
  readonly code: ProblemCode;
  readonly detail: string | undefined;
  readonly errors: FieldError[] | undefined;
  readonly headers: Record<string, string> | undefined;

  constructor(code: ProblemCode, options: ProblemOptions = {}) {
    super(options.detail ?? PROBLEM_TYPES[code].title);
    this.name = 'ProblemError';
    this.code = code;
    this.detail = options.detail;
    this.errors = options.errors;
    this.headers = options.headers;
  }

  get status(): number {
    return PROBLEM_TYPES[this.code].status;
  }
}

export function problemBody(
  code: ProblemCode,
  request: FastifyRequest,
  options: Pick<ProblemOptions, 'detail' | 'errors'> = {},
): ProblemBody {
  const def = PROBLEM_TYPES[code];
  return {
    type: `/problems/${def.slug}`,
    title: def.title,
    status: def.status,
    code,
    instance: request.url,
    requestId: request.id,
    ...(options.detail !== undefined ? { detail: options.detail } : {}),
    ...(options.errors !== undefined && options.errors.length > 0
      ? { errors: [...options.errors] }
      : {}),
  };
}

export const PROBLEM_CONTENT_TYPE = 'application/problem+json; charset=utf-8';
