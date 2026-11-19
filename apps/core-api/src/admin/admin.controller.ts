import { CoreSeedSchema, type CoreSeed } from '@demo/shared';
import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AdminTokenGuard } from './admin-token.guard.js';
import { AdminService } from './admin.service.js';

/** Demo-only routes: registered only with DEMO_MODE=true (see AppModule). */
@Controller('admin')
@UseGuards(AdminTokenGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Post('seed')
  @HttpCode(200)
  async seed(@Body({ schema: CoreSeedSchema }) world: CoreSeed) {
    return { status: 'seeded', counts: await this.admin.seed(world) };
  }

  @Post('reset')
  @HttpCode(200)
  async reset() {
    await this.admin.reset();
    return { status: 'reset' };
  }
}
