import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const { method, originalUrl } = request;
    const startedAt = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const response = context.switchToHttp().getResponse<Response>();
          const duration = Date.now() - startedAt;
          this.logger.log(
            `${method} ${originalUrl} ${response.statusCode} ${duration}ms`,
          );
        },
        error: (error: Error) => {
          const duration = Date.now() - startedAt;
          this.logger.warn(
            `${method} ${originalUrl} failed ${duration}ms: ${error.message}`,
          );
        },
      }),
    );
  }
}
