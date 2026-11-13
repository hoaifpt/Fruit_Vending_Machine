package com.fruitmachine.backend.payment.enums;

/** Why a payment was refunded (issue #72); stored in payments.refund_reason. */
public enum RefundReason {
    /** The machine did not deliver the bowl of the paying payment; the order becomes REFUNDED. */
    DISPENSE_FAILED,
    /** The money arrived after the order was cancelled; the order stays CANCELLED. */
    LATE_PAYMENT,
    /** A second SUCCESS payment for the same order; the order is unchanged. */
    DUPLICATE_PAYMENT,
    /** Delivered but the customer complained about the fruit; the order becomes REFUNDED. */
    PRODUCT_QUALITY,
    /** Admin decision on a completed or failed order; a note is required. */
    OTHER
}
