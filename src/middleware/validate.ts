import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { AppError } from './errorHandler.js';

type ValidationType = 'body' | 'query' | 'params';

interface ValidationOptions {
  stripUnknown?: boolean;
}

/**
 * Middleware factory for validating request data using Zod schemas
 */
export function validate(
  schema: ZodSchema,
  type: ValidationType = 'body',
  options: ValidationOptions = { stripUnknown: true }
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dataToValidate = req[type];

      const result = await schema.safeParseAsync(dataToValidate);

      if (!result.success) {
        const errors = formatZodErrors(result.error);
        throw new AppError(`Validation failed: ${errors}`, 400);
      }

      // Replace request data with validated (and potentially transformed) data
      req[type] = result.data;
      next();
    } catch (error) {
      if (error instanceof AppError) {
        next(error);
      } else if (error instanceof ZodError) {
        const errors = formatZodErrors(error);
        next(new AppError(`Validation failed: ${errors}`, 400));
      } else {
        next(error);
      }
    }
  };
}

/**
 * Validate multiple parts of the request at once
 */
export function validateMultiple(schemas: {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors: string[] = [];

      if (schemas.body) {
        const result = await schemas.body.safeParseAsync(req.body);
        if (!result.success) {
          errors.push(...formatZodErrorsArray(result.error, 'body'));
        } else {
          req.body = result.data;
        }
      }

      if (schemas.query) {
        const result = await schemas.query.safeParseAsync(req.query);
        if (!result.success) {
          errors.push(...formatZodErrorsArray(result.error, 'query'));
        } else {
          req.query = result.data;
        }
      }

      if (schemas.params) {
        const result = await schemas.params.safeParseAsync(req.params);
        if (!result.success) {
          errors.push(...formatZodErrorsArray(result.error, 'params'));
        } else {
          req.params = result.data;
        }
      }

      if (errors.length > 0) {
        throw new AppError(`Validation failed: ${errors.join('; ')}`, 400);
      }

      next();
    } catch (error) {
      if (error instanceof AppError) {
        next(error);
      } else {
        next(error);
      }
    }
  };
}

/**
 * Format Zod errors into a readable string
 */
function formatZodErrors(error: ZodError): string {
  return error.errors
    .map((err) => {
      const path = err.path.length > 0 ? `${err.path.join('.')}: ` : '';
      return `${path}${err.message}`;
    })
    .join(', ');
}

/**
 * Format Zod errors into an array with location prefix
 */
function formatZodErrorsArray(error: ZodError, location: string): string[] {
  return error.errors.map((err) => {
    const path = err.path.length > 0 ? `${err.path.join('.')}` : location;
    return `[${location}] ${path}: ${err.message}`;
  });
}

/**
 * Validate and extract a single parameter
 */
export function validateParam(paramName: string, schema: ZodSchema) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const value = req.params[paramName];
      const result = await schema.safeParseAsync(value);

      if (!result.success) {
        throw new AppError(
          `Invalid ${paramName}: ${result.error.errors[0].message}`,
          400
        );
      }

      req.params[paramName] = result.data;
      next();
    } catch (error) {
      next(error);
    }
  };
}
