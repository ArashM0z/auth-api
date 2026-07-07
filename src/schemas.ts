import { Type } from 'typebox';

/**
 * RFC 9457 Problem Details schema — used as the response schema for every
 * error status. Because Fastify serializes responses strictly against these
 * schemas (fast-json-stringify whitelisting), a field not listed here can
 * never leak into an error response.
 */
export const ProblemSchema = Type.Object(
  {
    type: Type.String({ description: 'URI reference identifying the problem type' }),
    title: Type.String({ description: 'Short human-readable summary of the problem type' }),
    status: Type.Integer({ description: 'HTTP status code' }),
    code: Type.String({ description: 'Stable machine-readable problem code' }),
    detail: Type.Optional(Type.String({ description: 'Occurrence-specific explanation' })),
    instance: Type.Optional(Type.String({ description: 'URI of the request that failed' })),
    requestId: Type.Optional(Type.String({ description: 'Correlation id (X-Request-Id)' })),
    errors: Type.Optional(
      Type.Array(
        Type.Object(
          {
            field: Type.String(),
            rule: Type.String(),
            message: Type.String(),
          },
          { additionalProperties: false },
        ),
        { description: 'Field-level validation failures' },
      ),
    ),
  },
  { additionalProperties: false, description: 'RFC 9457 Problem Details' },
);
