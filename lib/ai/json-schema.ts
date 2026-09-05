/**
 * Zod → OpenAI Structured Outputs schema conversion.
 *
 * Zod is the single source of truth for the assistant contract, so the JSON
 * Schema handed to the model has to be *derived* from it rather than written by
 * hand. Two schemas that must agree but are maintained separately will not stay
 * in agreement.
 *
 * Structured Outputs accepts a deliberately small subset of JSON Schema. It
 * rejects the annotation keywords Zod happily emits from `.min()`, `.max()`,
 * `.regex()` and friends, and it requires every object to be closed and to list
 * every property as required. So conversion is two steps: generate, then
 * sanitize.
 *
 * Dropping those keywords costs nothing in safety. The Zod schema still runs
 * against the model's response in `lib/ai/interpret.ts`, so a title that is too
 * long or a duration out of range is rejected there. The JSON Schema only has
 * to describe the *shape* well enough for the model to fill it in.
 */
import { z } from 'zod';

/**
 * Validation keywords Structured Outputs rejects outright.
 * Enforced by Zod on the way back in instead.
 */
const UNSUPPORTED_KEYWORDS: readonly string[] = [
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minProperties',
  'maxProperties',
  'patternProperties',
  'default',
  'contentMediaType',
  'contentEncoding',
];

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Recursively rewrites a JSON Schema into the Structured Outputs subset.
 *
 * Beyond stripping keywords, this closes every object (`additionalProperties:
 * false`) and marks every declared property as required. The assistant contract
 * is already written that way on purpose — absence is modelled as an explicit
 * `null` — so this is enforcement of an existing invariant rather than a change
 * in meaning.
 */
export function sanitizeForStructuredOutputs(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map((entry) => sanitizeForStructuredOutputs(entry));
  }

  if (!isJsonObject(node)) return node;

  const output: JsonObject = {};

  for (const [key, value] of Object.entries(node)) {
    if (UNSUPPORTED_KEYWORDS.includes(key)) continue;

    if (key === 'properties' && isJsonObject(value)) {
      const properties: JsonObject = {};
      for (const [propertyName, propertySchema] of Object.entries(value)) {
        properties[propertyName] = sanitizeForStructuredOutputs(propertySchema);
      }
      output.properties = properties;
      continue;
    }

    output[key] = sanitizeForStructuredOutputs(value);
  }

  if (output.type === 'object' || isJsonObject(output.properties)) {
    output.additionalProperties = false;
    const properties = isJsonObject(output.properties) ? output.properties : {};
    output.required = Object.keys(properties);
  }

  return output;
}

/**
 * The JSON Schema for a Zod schema, ready to send as `json_schema`.
 *
 * `io: 'input'` describes what the model should *produce* (the pre-transform
 * shape), and `unrepresentable: 'any'` keeps custom refinements — which have no
 * JSON Schema equivalent — from aborting generation.
 */
export function toStructuredOutputSchema(schema: z.ZodType): JsonObject {
  const generated = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io: 'input',
    unrepresentable: 'any',
    // Inlining keeps the payload self-contained; these schemas are small enough
    // that the duplication is not worth a `$ref` indirection the model has to
    // resolve.
    reused: 'inline',
  });

  const sanitized = sanitizeForStructuredOutputs(generated);
  if (!isJsonObject(sanitized)) {
    throw new Error('Expected the generated JSON Schema to be an object.');
  }

  // `$schema` is metadata the API has no use for.
  delete sanitized.$schema;
  return sanitized;
}
