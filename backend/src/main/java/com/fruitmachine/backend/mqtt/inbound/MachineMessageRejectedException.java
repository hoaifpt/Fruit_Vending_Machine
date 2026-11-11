package com.fruitmachine.backend.mqtt.inbound;

/**
 * A dropped inbound message. The detail is a fixed, payload-free description; machineCode/messageId are set only once
 * they passed validation, so everything here is safe to log.
 */
public class MachineMessageRejectedException extends RuntimeException {
    private final RejectionReason reason;
    private final String machineCode;
    private final String messageId;

    public MachineMessageRejectedException(RejectionReason reason, String detail, String machineCode, String messageId) {
        super(detail, null, false, false);
        this.reason = reason;
        this.machineCode = machineCode;
        this.messageId = messageId;
    }

    public RejectionReason reason() {
        return reason;
    }

    public String machineCode() {
        return machineCode;
    }

    public String messageId() {
        return messageId;
    }
}
