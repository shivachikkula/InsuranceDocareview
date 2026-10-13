import { Body, Controller, Get, Post, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { PrismaService } from '../core/prisma.service.js';
import { ZodValidationPipe } from '../core/zod-validation.pipe.js';
import { CurrentUser, Public, type AuthUser } from './auth.decorators.js';

const LoginSchema = z.object({ email: z.email(), password: z.string().min(1) });

/**
 * Demo username/password login. In production, replace with your identity
 * provider (Azure AD / Okta / Cognito) and map its groups to roles.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  @Public()
  @Post('login')
  async login(@Body(new ZodValidationPipe(LoginSchema)) body: z.infer<typeof LoginSchema>) {
    const user = await this.prisma.user.findUnique({ where: { email: body.email } });
    if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const payload: AuthUser = { id: user.id, email: user.email, name: user.name, role: user.role };
    return { accessToken: await this.jwt.signAsync(payload), user: payload };
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }
}
