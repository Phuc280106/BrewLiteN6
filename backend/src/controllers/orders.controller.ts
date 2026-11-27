import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { CreateOrderDto } from '../dto/orders/create-order.dto.js';
import { UpdateOrderStatusDto } from '../dto/orders/update-order-status.dto.js';
import { OrdersService } from '../services/orders.service.js';

@ApiTags('Orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get('promotions')
  @ApiOperation({
    summary: 'Lấy danh sách mã khuyến mãi đang áp dụng',
  })
  getPromotions() {
    return this.ordersService.getPromotions();
  }

  @Get('availability/:productId')
  @ApiOperation({
    summary: 'Tính số ly tối đa dựa theo tồn kho nguyên liệu hiện tại',
  })
  @ApiQuery({ name: 'size', required: false, example: 'M' })
  async getAvailability(
    @Param('productId', ParseIntPipe) productId: number,
    @Query('size') size?: string
  ) {
    if (size) {
      const maxCups = await this.ordersService.calculateProductAvailability(
        productId,
        size
      );
      return { productId, size, maxCups, availability: maxCups };
    }

    const details = await this.ordersService.calculateProductAvailabilityDetails(
      productId
    );
    return {
      productId,
      maxCups: details.maxCups,
      availability: details.maxCups,
      bySize: details.bySize,
    };
  }

  @Get('promotions/validate')
  @ApiOperation({
    summary: 'Kiểm tra tính hợp lệ và số tiền giảm giá của mã khuyến mãi (Kiểm tra cả ràng buộc 1 lần/user)',
  })
  @ApiQuery({ name: 'code', example: 'BREW10' })
  @ApiQuery({ name: 'subtotal', example: 60000 })
  @ApiQuery({ name: 'userId', required: false, example: 1 })
  validatePromotion(
    @Query('code') code: string,
    @Query('subtotal') subtotal: string,
    @Query('userId') userId?: string
  ) {
    return this.ordersService.validatePromotion(
      code,
      Number(subtotal) || 0,
      userId ? Number(userId) : undefined
    );
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Lấy lịch sử đơn hàng kèm món của user đang đăng nhập (GET /orders/me)',
  })
  findMyOrders(@Request() req: { user: { id: number } }) {
    return this.ordersService.findMyOrders(req.user.id);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BARISTA')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Lấy toàn bộ đơn hàng kèm món (Chỉ dành cho Barista)',
  })
  findAll() {
    return this.ordersService.findAll();
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    })
  )
  @ApiOperation({
    summary: 'Tạo đơn hàng ở trạng thái PENDING kèm mã khuyến mãi, điểm thưởng và hỗ trợ Idempotency-Key',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'Khóa chống tạo trùng đơn hàng khi gửi lặp request',
  })
  create(
    @Body() body: CreateOrderDto,
    @Request() req: { user: { id: number; role?: string } },
    @Headers('idempotency-key') idempotencyKey?: string
  ) {
    if (req.user?.role === 'BARISTA' || req.user?.role === 'STAFF') {
      throw new ForbiddenException(
        'Tài khoản Barista chỉ quản lý pha chế, không thể đặt đơn hàng'
      );
    }
    return this.ordersService.create(body, req.user?.id, idempotencyKey);
  }

  @Patch(':id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BARISTA')
  @ApiBearerAuth()
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    })
  )
  @ApiOperation({
    summary: 'Cập nhật trạng thái đơn hàng theo State Machine - Chỉ dành cho Barista, chặn chuyển PENDING -> PAID thủ công (PATCH /orders/:id/status)',
  })
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateOrderStatusDto
  ) {
    return this.ordersService.updateStatus(id, body.status);
  }

  @Post(':id/cancel')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Khách hàng tự hủy đơn hàng (Chỉ áp dụng khi đơn ở PENDING hoặc PAYMENT_FAILED; đơn PAID chỉ do Barista xử lý)',
  })
  cancelOrder(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: { user: { id: number } }
  ) {
    return this.ordersService.cancelOrder(id, 'Khách hàng yêu cầu hủy đơn', req.user.id);
  }
}
