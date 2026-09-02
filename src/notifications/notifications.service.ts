import { Injectable, NotImplementedException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user.type';
import type { ListNotificationsQueryDto } from './dto/list-notifications.query.dto';

/**
 * Notifications area (/notifications). Stub per the project-structure scope.
 */
@Injectable()
export class NotificationsService {
  /** GET /notifications — frontend: notifications tray (all dashboards). */
  list(_user: AuthUser, _query: ListNotificationsQueryDto): Promise<unknown> {
    // TODO: implement. Paginated Notification rows for the current user,
    // newest first, optional unread-only filter, with an unread count.
    throw new NotImplementedException();
  }
}
