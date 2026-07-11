/**
 * Typed helpers for the playground / rate-limiter pages, derived from the
 * repo's generated OpenAPI client (client/api.d.ts, built by
 * openapi-typescript from the committed OpenAPI document).
 *
 * NOTE: the generated file has `components.schemas: never` (the spec inlines
 * all schemas), so the RFC 9457 ProblemDetails shape is extracted from an
 * operation response instead of components['schemas'].
 *
 * The GitHub Pages site has no live backend — these types describe the
 * simulated client⇄app⇄Redis exchanges the pages replay locally in the
 * browser. Do NOT add real fetch() calls to localhost here.
 */
import type { components, operations, paths } from '../../../client/api.d.ts';

export type { components, operations, paths };

/** RFC 9457 Problem Details body (application/problem+json). */
export type ProblemDetails =
  operations['login']['responses'][401]['content']['application/problem+json'];

/** POST /v1/users */
export type CreateUserRequest =
  paths['/v1/users']['post']['requestBody']['content']['application/json'];
export type CreateUserSuccess =
  paths['/v1/users']['post']['responses'][201]['content']['application/json'];

/** POST /v1/auth/login */
export type LoginRequest =
  paths['/v1/auth/login']['post']['requestBody']['content']['application/json'];
export type LoginSuccess =
  paths['/v1/auth/login']['post']['responses'][200]['content']['application/json'];

/** One simulated HTTP exchange, as rendered by the playground pages. */
export interface SimulatedResponse<TBody = LoginSuccess | CreateUserSuccess | ProblemDetails> {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: TBody;
}
