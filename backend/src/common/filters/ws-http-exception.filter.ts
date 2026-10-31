import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import type { Socket } from 'socket.io';

interface ErrorPayload {
  status: string;
  message: string;
}

/**
 * Gateway handlers throw the same HttpExceptions as the REST controllers,
 * but Nest's default WebSocket handler reports anything that is not a
 * WsException as a generic 500. This filter normalises both into a single
 * `exception` event that clients can act on, and logs genuine bugs with a
 * stack trace instead of leaking them to the socket.
 *
 * It answers the acknowledgement callback as well, and that is not optional.
 * A handler that throws never reaches the `return`, so Nest sends no reply of
 * its own — and a client waiting on that reply waits out its own timeout while
 * the call it asked about keeps ringing on every other device. Emitting
 * `exception` and returning is enough for a client that only listens for
 * events; it is not enough for one that also asked to be told, and the
 * difference is invisible until the timeout fires.
 */
/**
 * The acknowledgement payload for a failed message.
 *
 * `error` rather than the exception's own status, because a caller waiting on
 * an acknowledgement wants to know *that it failed*, and the `exception` event
 * is what carries the detail.
 */
interface AckPayload {
  error: string;
}

@Catch()
export class WsHttpExceptionFilter implements ExceptionFilter<unknown> {
  private readonly logger = new Logger('WsException');

  catch(exception: unknown, host: ArgumentsHost): void {
    const client = host.switchToWs().getClient<Socket>();
    // Only present when the sender supplied one. `data` is socket.io's
    // positional convention: element 0 is the body, the callback is last.
    const ack = lastArgument<(...args: unknown[]) => void>(host.getArgs());

    if (exception instanceof HttpException) {
      const message = extractMessage(exception.getResponse());
      client.emit('exception', {
        status: String(exception.getStatus()),
        message,
      } satisfies ErrorPayload);
      ack?.({ error: message } satisfies AckPayload);
      return;
    }

    if (exception instanceof WsException) {
      const message = extractMessage(exception.getError());
      client.emit('exception', {
        status: 'error',
        message,
      } satisfies ErrorPayload);
      ack?.({ error: message } satisfies AckPayload);
      return;
    }

    const error =
      exception instanceof Error ? exception : new Error(String(exception));

    this.logger.error(`Unhandled gateway error: ${error.message}`, error.stack);

    client.emit('exception', {
      status: 'error',
      message: 'Internal server error',
    } satisfies ErrorPayload);
    // A genuine bug still has to answer, or the caller is left waiting out its
    // own timeout for a reply that is never coming — and the call it asked
    // about stays ringing on every other device in the meantime.
    ack?.({ error: 'Internal server error' } satisfies AckPayload);
  }
}

function lastArgument<T>(args: unknown[]): T | undefined {
  const last = args.at(-1);
  return typeof last === 'function' ? (last as T) : undefined;
}

function extractMessage(response: string | object): string {
  if (typeof response === 'string') {
    return response;
  }

  if (response && typeof response === 'object') {
    const body = response as Record<string, unknown>;

    if (Array.isArray(body.message)) {
      return body.message.join(', ');
    }

    if (typeof body.message === 'string') {
      return body.message;
    }
  }

  return 'Request failed';
}
