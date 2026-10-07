import { type EndpointRole, type RunError, searchResultSchema } from '@precious/shared';

/** Checks the mapped output has the shape its role promises. Keeps what's valid. */
export function validateOutput(role: EndpointRole, output: unknown): { output: unknown; errors: RunError[] } {
  const errors: RunError[] = [];
  if (role === 'search') {
    if (!Array.isArray(output)) {
      return { output: [], errors: [{ stage: 'validate', message: 'Search must produce a list of results.' }] };
    }
    const valid: unknown[] = [];
    for (const [i, r] of output.entries()) {
      const parsed = searchResultSchema.safeParse(r);
      if (parsed.success) {
        valid.push(parsed.data);
      } else if (errors.length < 5) {
        const issue = parsed.error.issues[0];
        const field = issue?.path.join('.') || 'result';
        errors.push({
          stage: 'validate',
          path: `results[${i}].${field}`,
          message: `Result ${i + 1}: ${field} ${issue?.code === 'invalid_type' && issue.message.includes('undefined') ? 'is missing' : `– ${issue?.message}`}`,
        });
      }
    }
    return { output: valid, errors };
  }
  if (role === 'lookup') {
    if (!output || typeof output !== 'object' || Array.isArray(output)) {
      return { output: {}, errors: [{ stage: 'validate', message: 'A lookup must produce an object of values.' }] };
    }
    return { output, errors };
  }
  if (output === undefined || output === null) {
    return { output: null, errors: [{ stage: 'validate', message: 'The value expression produced nothing.' }] };
  }
  return { output, errors };
}
