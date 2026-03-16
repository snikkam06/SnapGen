import {
    Injectable,
    CanActivate,
    ExecutionContext,
    ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../decorators/current-user.decorator';

@Injectable()
export class AdminGuard implements CanActivate {
    constructor(private prisma: PrismaService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const user = request.user as AuthUser | undefined;

        if (!user?.clerkUserId) {
            throw new ForbiddenException('Authentication required');
        }

        const dbUser = await this.prisma.user.findUnique({
            where: { clerkUserId: user.clerkUserId },
            select: { role: true },
        });

        if (!dbUser || dbUser.role !== 'admin') {
            throw new ForbiddenException('Admin access required');
        }

        return true;
    }
}
