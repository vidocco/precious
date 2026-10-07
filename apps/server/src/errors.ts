/** An error with an HTTP status and a message meant for the person using the app. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly issues?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, 'not_found', `${what} not found.`);
export const forbidden = (message: string) => new HttpError(403, 'forbidden', message);
export const badRequest = (message: string, issues?: { path: string; message: string }[]) =>
  new HttpError(400, 'bad_request', message, issues);
