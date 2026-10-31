import { HttpException, HttpStatus } from '@nestjs/common';

/** Error with a stable machine-readable `code` the mobile app can switch on. */
export class AppError extends HttpException {
  constructor(status: HttpStatus, code: string, message: string, extra: Record<string, unknown> = {}) {
    super({ statusCode: status, code, message, ...extra }, status);
  }
}
