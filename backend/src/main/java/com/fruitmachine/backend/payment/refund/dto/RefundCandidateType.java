package com.fruitmachine.backend.payment.refund.dto;

/** Why a SUCCESS payment is on the refund to-do list. */
public enum RefundCandidateType {
    /** Order DISPENSE_FAILED and the payment is the one that paid it. */
    DISPENSE_FAILED,
    /** Order CANCELLED: the money arrived too late. */
    LATE_PAYMENT,
    /** Another, earlier SUCCESS (or already refunded) payment exists for the order. */
    DUPLICATE_PAYMENT,
    /** Reserved for customer reports (a later issue); returns nothing yet. */
    CUSTOMER_REPORT
}
