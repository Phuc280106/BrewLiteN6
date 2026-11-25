import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from '../database/database.module.js';
import { AuthModule } from './auth.module.js';
import { OrdersController } from '../controllers/orders.controller.js';
import { PaymentsController } from '../controllers/payments.controller.js';
import { OrdersService } from '../services/orders.service.js';
import { OrderExpiryService } from '../services/order-expiry.service.js';
import { VnpayService } from '../services/vnpay.service.js';
import { RolesGuard } from '../common/guards/roles.guard.js';

@Module({
  imports: [ScheduleModule.forRoot(), DatabaseModule, AuthModule],
  controllers: [OrdersController, PaymentsController],
  providers: [OrdersService, VnpayService, OrderExpiryService, RolesGuard],
})
export class OrdersModule {}
