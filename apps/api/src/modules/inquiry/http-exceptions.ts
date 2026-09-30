import { ForbiddenException, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';

export { ForbiddenException, NotFoundException };

/** NestJS has no built-in 429 exception; this provides one. */
export class TooManyRequestsException extends HttpException {
  constructor(message = 'Too many requests') {
    super(message, HttpStatus.TOO_MANY_REQUESTS);
  }
}

/** Re-export the DI decorator so the service file's single import line stays tidy. */
export { Injectable } from '@nestjs/common';
