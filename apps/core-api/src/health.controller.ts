import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/principal.js';

@Controller('health')
@Public()
export class HealthController {
  @Get()
  health() {
    return { status: 'ok', service: 'core-api' };
  }
}
