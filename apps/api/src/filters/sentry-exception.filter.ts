import { ArgumentsHost, Catch, HttpException, Injectable } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { captureApiException } from '../observability/sentry';

@Catch()
@Injectable()
export class SentryExceptionFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    const statusCode = exception instanceof HttpException ? exception.getStatus() : 500;

    if (statusCode >= 500) {
      captureApiException(exception, {
        layer: 'nestjs',
        statusCode,
      });
    }

    super.catch(exception, host);
  }
}
