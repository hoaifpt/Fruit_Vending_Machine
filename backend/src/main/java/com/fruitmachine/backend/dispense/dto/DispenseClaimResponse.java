package com.fruitmachine.backend.dispense.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.UUID;

@Schema(description = "Exclusive dispatch claim. dispatchToken is returned once; loss of this response never permits a second claim or motor resend. Keep it in the station journal, not the browser.")
public record DispenseClaimResponse(DispenseCommandResponse command, UUID dispatchToken) {}
