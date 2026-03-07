import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthUser {
    clerkUserId: string;
    email?: string;
    emailVerified?: boolean;
    dbUserId?: string;
}

export const CurrentUser = createParamDecorator(
    (data: keyof AuthUser | undefined, ctx: ExecutionContext): AuthUser | string | boolean | undefined => {
        const request = ctx.switchToHttp().getRequest();
        const user = request.user as AuthUser;
        return data ? user?.[data] : user;
    },
);
