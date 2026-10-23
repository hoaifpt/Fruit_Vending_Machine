package com.fruitmachine.backend.dispense.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;

@Schema(description = "Correlated observation by the claiming station. SUCCESS requires a completed idle motion sequence and exactly one IR count increment; ACK alone is not success. Ambiguity must be TIMEOUT, never an automatic resend.")
public record DispenseResultRequest(@NotNull UUID dispatchToken, @NotNull Result status,
        @Min(0) @Max(4294967295L) Long bowlCountBefore, @Min(0) @Max(4294967295L) Long bowlCountAfter) {
    public enum Result { ACKNOWLEDGED, SUCCESS, FAILED, TIMEOUT }
}
