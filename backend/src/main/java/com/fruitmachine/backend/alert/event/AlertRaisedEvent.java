package com.fruitmachine.backend.alert.event;

import java.util.UUID;

/** A new alert was inserted (not a de-duplicated repeat). Published inside that transaction; notifications are created after commit. */
public record AlertRaisedEvent(UUID alertId) {
}
