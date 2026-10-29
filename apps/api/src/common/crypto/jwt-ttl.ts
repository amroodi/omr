import type { JwtSignOptions } from '@nestjs/jwt';

/**
 * A token lifetime from config («8h», «15m», «10m») in the type the JWT library expects. The value is
 * passed on unchanged (same meaning as before), only its type is narrowed for @nestjs/jwt 11.
 */
export function jwtTtl(value: string): NonNullable<JwtSignOptions['expiresIn']> {
  return value as NonNullable<JwtSignOptions['expiresIn']>;
}
