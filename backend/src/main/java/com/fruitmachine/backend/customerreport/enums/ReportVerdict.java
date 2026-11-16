package com.fruitmachine.backend.customerreport.enums;

/** What the backend found when it checked the reported order (issue #74 §4.1). */
public enum ReportVerdict {
    /** No order is checked for this report. */
    NOT_APPLICABLE,
    /** No order with that code for this machine within the lookback (7 business days). */
    ORDER_NOT_FOUND,
    /** Paid and not delivered (DISPENSE_FAILED), or paid after cancellation: refund candidate. */
    REFUND_ELIGIBLE,
    /** Paid; the machine has not reported the final dispense result yet. */
    DISPENSE_PENDING,
    /** The machine reported the bowl as delivered (COMPLETED). */
    DELIVERED_PER_MACHINE,
    /** The order or its paying payment was already refunded. */
    ALREADY_REFUNDED,
    /** No successful payment for the order. */
    NOT_PAID
}
