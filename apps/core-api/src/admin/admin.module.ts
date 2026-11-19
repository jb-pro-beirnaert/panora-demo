import { Module } from '@nestjs/common';
import { QueuesModule } from '../queues/queues.module.js';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';

@Module({
  imports: [QueuesModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
