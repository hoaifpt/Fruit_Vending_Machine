package com.fruitmachine.backend.security.kiosk;

import java.util.UUID;

/** Principal of an authenticated kiosk; the machine is always derived from the credential. */
public record AuthenticatedKiosk(UUID credentialId, UUID machineId, String machineCode) {
}
