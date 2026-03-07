import {
    Injectable,
    CanActivate,
    ExecutionContext,
    UnauthorizedException,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import jwksClient, { JwksClient } from 'jwks-rsa';

interface ClerkJwtPayload extends jwt.JwtPayload {
    sub: string;
    email?: string;
    email_verified?: boolean;
}

@Injectable()
export class ClerkAuthGuard implements CanActivate {
    private client: JwksClient;

    constructor() {
        this.client = jwksClient({
            jwksUri: process.env.CLERK_JWKS_URL || 'https://clerk.example.com/.well-known/jwks.json',
            cache: true,
            rateLimit: true,
        });
    }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const authHeader = request.headers['authorization'];

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw new UnauthorizedException('Missing authorization token');
        }

        const token = authHeader.split(' ')[1];

        try {
            const decoded = await this.verifyToken(token);
            request.user = {
                clerkUserId: decoded.sub,
                email: decoded.email,
                emailVerified: decoded.email_verified,
            };
            return true;
        } catch (error) {
            throw new UnauthorizedException('Invalid or expired token');
        }
    }

    private async verifyToken(token: string): Promise<ClerkJwtPayload> {
        return new Promise((resolve, reject) => {
            const getKey = (header: jwt.JwtHeader, callback: jwt.SigningKeyCallback) => {
                if (!header.kid) {
                    return callback(new Error('Missing key id'));
                }

                this.client.getSigningKey(header.kid, (err, key) => {
                    if (err) return callback(err);
                    const signingKey = key?.getPublicKey();
                    callback(null, signingKey);
                });
            };

            jwt.verify(token, getKey, { algorithms: ['RS256'] }, (err, decoded) => {
                if (err) return reject(err);
                if (!decoded || typeof decoded === 'string' || !decoded.sub) {
                    return reject(new Error('Invalid token payload'));
                }

                resolve(decoded as ClerkJwtPayload);
            });
        });
    }
}
