import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Logger,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { InitiatePaymentDto } from '../dto/orders/initiate-payment.dto.js';
import { OrdersService } from '../services/orders.service.js';
import { VnpayService } from '../services/vnpay.service.js';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);
  private readonly initiateCache = new Map<
    string,
    { orderId: number; response: Record<string, unknown> }
  >();

  constructor(
    private readonly ordersService: OrdersService,
    private readonly vnpayService: VnpayService
  ) {}

  private assertOrderOwnership(orderUserId: number | null, req: Request) {
    const currentUser = (req as Request & { user?: { id: number; role?: string } }).user;
    if (
      orderUserId !== null &&
      currentUser?.role !== 'BARISTA' &&
      currentUser?.id !== orderUserId
    ) {
      throw new ForbiddenException('Bạn không có quyền thao tác trên đơn hàng của người khác');
    }
  }

  /**
   * 1. Khách hàng bấm thanh toán -> Sinh URL Cổng thanh toán VNPay Sandbox
   * Hỗ trợ cả đơn PENDING và đơn PAYMENT_FAILED (khách thanh toán lại khi gặp lỗi thẻ/OTP)
   */
  @Post('initiate')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Khởi tạo phiên thanh toán VNPay Sandbox (Hỗ trợ mở thẳng tab theo bankCode, thanh toán lại & Idempotency-Key)',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'Khóa chống khởi tạo trùng phiên thanh toán khi gửi lặp request',
  })
  async initiatePayment(
    @Body() body: InitiatePaymentDto,
    @Req() req: Request,
    @Headers('idempotency-key') idempotencyKey?: string
  ) {
    const normalizedKey = idempotencyKey?.trim();
    if (normalizedKey) {
      const cached = this.initiateCache.get(normalizedKey);
      if (cached) {
        if (cached.orderId !== body.orderId) {
          throw new BadRequestException(
            `Idempotency-Key "${normalizedKey}" đã được sử dụng cho đơn hàng #${cached.orderId}, không thể dùng cho đơn hàng #${body.orderId}`
          );
        }
        return {
          ...cached.response,
          idempotent: true,
        };
      }
    }

    const order = await this.ordersService.getOrderStatus(body.orderId);
    this.assertOrderOwnership(order.userId, req);

    // Cho phép thanh toán khi đơn ở trạng thái PENDING hoặc PAYMENT_FAILED (thanh toán lại)
    if (order.status !== 'PENDING' && order.status !== 'PAYMENT_FAILED') {
      throw new BadRequestException(
        `Đơn hàng #${body.orderId} đang ở trạng thái "${order.status}", không thể khởi tạo thanh toán`
      );
    }

    if (order.total < 5000) {
      throw new BadRequestException(
        'Số tiền thanh toán qua VNPay tối thiểu phải từ 5.000đ trở lên'
      );
    }

    const clientIp =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0] ||
      req.socket.remoteAddress ||
      '127.0.0.1';

    const vnpayUrl = this.vnpayService.createPaymentUrl({
      orderId: order.orderId,
      orderCode: order.orderCode,
      amount: order.total,
      ipAddr: clientIp,
      bankCode: body.bankCode,
    });

    const responsePayload = {
      orderId: order.orderId,
      orderCode: order.orderCode,
      total: order.total,
      method: body.method,
      bankCode: body.bankCode || null,
      paymentUrl: vnpayUrl,
    };

    if (normalizedKey) {
      this.initiateCache.set(normalizedKey, {
        orderId: order.orderId,
        response: responsePayload,
      });
    }

    return {
      ...responsePayload,
      ...(normalizedKey ? { idempotent: false } : {}),
    };
  }

  /**
   * 2. Xử lý phản hồi từ Cổng VNPay Sandbox sau khi khách thanh toán
   */
  @Get('vnpay/return')
  @ApiOperation({ summary: 'Xác minh chữ ký số HMAC-SHA512 và kết quả giao dịch VNPay Sandbox Return' })
  async handleVnpayReturn(@Query() query: Record<string, string>) {
    this.logger.log(`[VNPay Callback] Nhận phản hồi thanh toán cho TxnRef: ${query.vnp_TxnRef}`);

    const verifyResult = this.vnpayService.verifyReturn(query);

    if (!verifyResult.isValid) {
      this.logger.error('[VNPay Callback] Chữ ký số HMAC-SHA512 không hợp lệ!');
      throw new BadRequestException('Chữ ký số phản hồi từ VNPay không hợp lệ!');
    }

    if (!verifyResult.isSuccess) {
      this.logger.warn(`[VNPay Callback] Giao dịch thất bại hoặc bị hủy với mã lỗi: ${verifyResult.responseCode}`);

      const isCancelledByCustomer = verifyResult.responseCode === '24';

      if (verifyResult.orderId) {
        try {
          const currentOrder = await this.ordersService.getOrderStatus(verifyResult.orderId);

          if (currentOrder.status === 'PENDING' || currentOrder.status === 'PAYMENT_FAILED') {
            if (isCancelledByCustomer) {
              // Khách chủ động bấm Hủy trên VNPay (Mã 24) -> Chuyển sang CANCELLED và hoàn tồn kho ngay
              await this.ordersService.cancelOrder(
                verifyResult.orderId,
                'Khách hàng chủ động bấm Hủy giao dịch trên Cổng VNPay'
              );
            } else {
              // Lỗi thanh toán (Mã khác 24: không đủ tiền, sai OTP...) -> Chuyển PAYMENT_FAILED để khách thử lại
              if (currentOrder.status !== 'PAYMENT_FAILED') {
                await this.ordersService.updateStatus(verifyResult.orderId, 'PAYMENT_FAILED' as any);
              }
            }
          }
        } catch (err) {
          this.logger.error(`[VNPay Callback] Lỗi khi xử lý trạng thái đơn #${verifyResult.orderId}: ${(err as Error).message}`);
        }
      }

      return {
        success: false,
        orderId: verifyResult.orderId,
        responseCode: verifyResult.responseCode,
        isCancelled: isCancelledByCustomer,
        message: isCancelledByCustomer
          ? 'Bạn đã hủy giao dịch trên Cổng VNPay. Đơn hàng đã được hủy và tồn kho đã hoàn trả lại quán.'
          : verifyResult.message,
      };
    }

    // Chữ ký hợp lệ và giao dịch thành công (00) -> Chuyển trạng thái đơn sang PAID
    await this.ordersService.processPaymentWebhook({
      transactionRef: `VNPAY_${verifyResult.transactionNo || query.vnp_TxnRef}`,
      orderId: verifyResult.orderId,
      amount: verifyResult.amount,
      status: 'SUCCESS',
      message: `Thanh toán qua Cổng VNPay Sandbox (Mã GD: ${verifyResult.transactionNo})`,
    });

    const updatedOrder = await this.ordersService.getOrderStatus(verifyResult.orderId);

    return {
      success: true,
      orderId: verifyResult.orderId,
      orderCode: updatedOrder.orderCode,
      amount: verifyResult.amount,
      message: 'Thanh toán qua VNPay Sandbox thành công!',
    };
  }

  /**
   * 3. Kiểm tra trạng thái đơn hàng (Dành cho Frontend Polling realtime)
   */
  @Get('status/:orderId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Kiểm tra trạng thái đơn hàng (Yêu cầu đăng nhập & đúng chủ đơn)' })
  async checkStatus(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Req() req: Request
  ) {
    const order = await this.ordersService.getOrderStatus(orderId);
    this.assertOrderOwnership(order.userId, req);
    return order;
  }
}
