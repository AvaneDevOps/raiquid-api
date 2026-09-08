import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationTone } from '../common/enums';
import { Prisma } from '../generated/prisma/client';
import type { AuthUser } from '../auth/auth-user.type';
import type { ListNotificationsQueryDto } from './dto/list-notifications.query.dto';

export interface NotifyInput {
  userId: string;
  title: string;
  body: string;
  tone?: NotificationTone;
  href?: string;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser, query: ListNotificationsQueryDto) {
    const userId = this.requireUserId(user);
    const where = {
      userId,
      ...(query.unreadOnly ? { readAt: null } : {}),
    };

    const [data, total, unreadCount] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);

    return {
      data,
      page: query.page,
      pageSize: query.pageSize,
      total,
      unreadCount,
    };
  }

  notify(input: NotifyInput, tx: Prisma.TransactionClient = this.prisma) {
    return tx.notification.create({
      data: {
        userId: input.userId,
        title: input.title,
        body: input.body,
        tone: input.tone ?? NotificationTone.informational,
        href: input.href,
      },
    });
  }

  private requireUserId(user: AuthUser): string {
    if (!user.dbUserId) {
      throw new ForbiddenException('User is not provisioned yet');
    }
    return user.dbUserId;
  }
}
