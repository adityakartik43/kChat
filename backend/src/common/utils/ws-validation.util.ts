import { ClassConstructor, plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { WsException } from '@nestjs/websockets';

/**
 * WebSocket payloads do not pass through the global ValidationPipe, so
 * gateway handlers validate their input with this helper. It mirrors the
 * HTTP behaviour: unknown properties are rejected.
 */
export async function validateWsPayload<T extends object>(
  cls: ClassConstructor<T>,
  payload: unknown,
): Promise<T> {
  const instance = plainToInstance(cls, payload ?? {}, {
    excludeExtraneousValues: false,
  });

  const errors = await validate(instance, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  if (errors.length > 0) {
    const messages = errors.flatMap((error) =>
      Object.values(error.constraints ?? {}).map(
        (message) => `${error.property}: ${message}`,
      ),
    );

    throw new WsException(messages.join(', ') || 'Invalid payload');
  }

  return instance;
}
