export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, code = 'BAD_REQUEST') => new HttpError(400, code, message);
export const unauthorized = (message = 'Unauthorized', code = 'UNAUTHORIZED') => new HttpError(401, code, message);
export const forbidden = (message = 'Forbidden', code = 'FORBIDDEN') => new HttpError(403, code, message);
export const notFound = (message = 'Not found', code = 'NOT_FOUND') => new HttpError(404, code, message);
export const conflict = (message: string, code = 'CONFLICT') => new HttpError(409, code, message);
export const gone = (message: string, code = 'GONE') => new HttpError(410, code, message);
export const locked = (message: string, code = 'LOCKED') => new HttpError(423, code, message);
