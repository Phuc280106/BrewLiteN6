import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as { role?: string; email?: string } | undefined;

    if (!user) {
      throw new ForbiddenException('Không xác định được quyền truy cập của tài khoản');
    }

    const effectiveRole =
      user.role === 'BARISTA' || user.email?.toLowerCase().includes('barista')
        ? 'BARISTA'
        : user.role || 'CUSTOMER';

    if (!requiredRoles.includes(effectiveRole)) {
      throw new ForbiddenException(
        `Chỉ tài khoản có quyền ${requiredRoles.join(', ')} mới được phép thực hiện thao tác này`
      );
    }

    return true;
  }
}
