package com.fruitmachine.backend.pricing.model;

import java.time.Instant;

/**
 * Today's near-expiry window in the business zone: a batch expiring in [dayStart, dayEnd) is eligible while the setting is enabled.
 * Passed as parameters to the catalog query and used for inventory flags, so SQL and Java share the same bounds.
 */
public record NearExpiryWindow(boolean enabled, int percent, Instant dayStart, Instant dayEnd) {
    public boolean covers(Instant expiresAt) {
        return enabled && expiresAt != null && !expiresAt.isBefore(dayStart) && expiresAt.isBefore(dayEnd);
    }
}
