import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny, z } from 'zod';

type Source = 'body' | 'query' | 'params';

/**
 * Validates req[source] with a zod schema. The parsed (typed, stripped) value is
 * stored on res.locals[source] — Express 5 makes req.query read-only.
 */
export const validate =
  <S extends ZodTypeAny>(schema: S, source: Source = 'body') =>
  (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request',
          issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      });
    }
    res.locals[source] = result.data;
    next();
  };

export const parsed = <S extends ZodTypeAny>(res: Response, _schema: S, source: Source = 'body'): z.infer<S> =>
  res.locals[source];
