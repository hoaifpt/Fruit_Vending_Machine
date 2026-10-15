package com.fruitmachine.backend.payment.mapper;

import com.fruitmachine.backend.payment.dto.*;
import com.fruitmachine.backend.payment.entity.Payment;
import com.fruitmachine.backend.payment.enums.PaymentStatus;
import org.springframework.stereotype.Component;

@Component
public class PaymentMapper {
    public KioskPaymentResponse kiosk(Payment payment) {
        // A stale QR is never handed back once the attempt is no longer payable.
        String qr = payment.getStatus() == PaymentStatus.PENDING ? payment.getQrCode() : null;
        return new KioskPaymentResponse(payment.getId(), payment.getOrder().getId(), payment.getProvider(), payment.getStatus(),
                payment.getAmount(), qr, payment.getExpiredAt());
    }

    public PaymentSummaryResponse summary(Payment payment) {
        return new PaymentSummaryResponse(payment.getId(), payment.getProvider(), payment.getStatus(), payment.getAmount(),
                payment.getCreatedAt(), payment.getPaidAt(), payment.getExpiredAt());
    }

    public PaymentResponse response(Payment payment) {
        var order = payment.getOrder();
        return new PaymentResponse(payment.getId(), order.getId(), order.getOrderCode(), order.getMachine().getCode(), payment.getProvider(),
                payment.getStatus(), payment.getAmount(), payment.getPaymentReference(), payment.getTransactionId(),
                payment.getCreatedAt(), payment.getPaidAt(), payment.getExpiredAt());
    }

    public PaymentDetailResponse detail(Payment payment) {
        var order = payment.getOrder();
        return new PaymentDetailResponse(payment.getId(), order.getId(), order.getOrderCode(), order.getMachine().getCode(), payment.getProvider(),
                payment.getStatus(), payment.getAmount(), payment.getPaymentReference(), payment.getTransactionId(),
                payment.getCreatedAt(), payment.getPaidAt(), payment.getExpiredAt(), payment.getQrCode());
    }
}
