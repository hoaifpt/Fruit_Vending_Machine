package com.fruitmachine.backend.customerreport.enums;

/** What the customer reports (issue #74). */
public enum ReportType {
    /** Paid but no bowl came out; the order code is required and verified. */
    PAID_NOT_RECEIVED("Đã thanh toán nhưng không nhận được hàng"),
    /** Delivered but the fruit was bad; the order code is optional and links the batch of the sold bowl. */
    PRODUCT_QUALITY("Chất lượng sản phẩm"),
    /** Something is wrong with the machine. */
    MACHINE_FAULT("Máy gặp sự cố"),
    /** Anything else, reviewed by an administrator. */
    OTHER("Khác");

    private final String label;

    ReportType(String label) {
        this.label = label;
    }

    public String label() {
        return label;
    }

    /** Money and quality cases need a way to contact the customer. */
    public boolean needsContact() {
        return this == PAID_NOT_RECEIVED || this == PRODUCT_QUALITY;
    }
}
