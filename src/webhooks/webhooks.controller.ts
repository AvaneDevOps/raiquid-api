import {
  BadRequestException,
  Controller,
  HttpCode,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { WebhooksService } from './webhooks.service';

@ApiExcludeController()
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post('clerk')
  @Public()
  @HttpCode(200)
  handleClerk(@Req() req: RawBodyRequest<Request>) {
    if (!req.rawBody) {
      throw new BadRequestException('Missing raw request body');
    }
    return this.webhooks.handleClerkWebhook(
      req.rawBody,
      req.headers as Record<string, string>,
    );
  }
}
