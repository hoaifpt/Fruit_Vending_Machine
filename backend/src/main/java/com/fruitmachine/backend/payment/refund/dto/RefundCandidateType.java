package com.fruitmachine.backend.payment.refund.dto;

/** Why a SUCCESS payment is on the refund to-do list. */
public enum RefundCandidateType {
    /** Order DISPENSE_FAILED and the payment is the one that paid it. */
    DISPENSE_FAILED,
    /** Order CANCELLED: the money arrived too late. */
    LATE_PAYMENT,
    /** Another, earlier SUCCESS (or already refunded) payment exists for the order. */
    DUPLICATE_PAYMENT,
    /** Issue #74: the order has an open customer report with verdict REFUND_ELIGIBLE or DELIVERED_PER_MACHINE (Admin judges quality cases). */
    CUSTOMER_REPORT
}
