import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Global exception filter: turns any thrown error into a consistent JSON
 * envelope so the frontend always gets the same error shape. Registered in
 * main.ts with `app.useGlobalFilters`.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message = this.extractMessage(exception, status);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json({
      statusCode: status,
      path: request.url,
      message,
    });
  }

  /**
   * Always resolve to a string (or string[]). HttpException.getResponse() is an
   * object for pipe/validation errors (`{ statusCode, message, error }`); we
   * lift its `message` so the envelope shape stays uniform for the client.
   */
  private extractMessage(
    exception: unknown,
    status: number,
  ): string | string[] {
    if (!(exception instanceof HttpException)) {
      return status >= HttpStatus.INTERNAL_SERVER_ERROR
        ? 'Internal server error'
        : 'Request failed';
    }
    const body = exception.getResponse();
    if (typeof body === 'string') return body;
    if (
      typeof body === 'object' &&
      body !== null &&
      'message' in body &&
      (body as { message: unknown }).message !== undefined
    ) {
      return (body as { message: string | string[] }).message;
    }
    return exception.message;
  }
}
