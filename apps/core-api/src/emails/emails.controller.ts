import {
  ReceiveEmailRequestSchema,
  type EmailAccepted,
  type ReceiveEmailRequest,
} from '@demo/shared';
import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { EmailsService } from './emails.service.js';

@Controller('emails')
export class EmailsController {
  constructor(private readonly emails: EmailsService) {}

  /** An e-mail received by a brokerage's claims inbox (sent by the simulator in the demo). */
  @Post()
  @HttpCode(202)
  receive(
    @Body({ schema: ReceiveEmailRequestSchema }) input: ReceiveEmailRequest,
  ): Promise<EmailAccepted> {
    return this.emails.receive(input);
  }
}
