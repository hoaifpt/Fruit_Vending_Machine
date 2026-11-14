package com.fruitmachine.backend.customerreport.controller;

import com.fruitmachine.backend.common.response.ApiErrorResponse;
import com.fruitmachine.backend.common.response.ApiResponse;
import com.fruitmachine.backend.customerreport.dto.ReportLinkResponse;
import com.fruitmachine.backend.customerreport.service.MachineReportLinkService;
import com.fruitmachine.backend.security.kiosk.AuthenticatedKiosk;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
@RequestMapping(produces = "application/json")
@PreAuthorize("hasRole('KIOSK')")
@SecurityRequirement(name = "kioskKey")
@Tag(name = "Kiosk", description = "Kiosk-facing APIs authenticated with the machine-bound X-Kiosk-Key header (not a user JWT). The machine is always derived from the credential.")
@ApiResponses({
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "401", description = "Missing, malformed, unknown, revoked or wrong X-Kiosk-Key", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "403", description = "Authenticated as a user, not a kiosk", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "500", description = "Unexpected server error; no internal details", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
})
public class KioskReportLinkController {
    private final MachineReportLinkService links;

    @GetMapping("/api/v1/kiosk/incident-report-link")
    @Operation(operationId = "getKioskIncidentReportLink", summary = "Public report URL for the kiosk's \"Báo sự cố\" QR",
            description = "KIOSK only (issue #74). The URL of the public report form of this kiosk's machine. orderCode is added as ?order= only when it is an "
                    + "order of this machine; otherwise it is ignored. 409 REPORT_LINK_NOT_CONFIGURED when PUBLIC_REPORT_BASE_URL is not set.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Report URL"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "409", description = "REPORT_LINK_NOT_CONFIGURED", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<ReportLinkResponse>> link(@AuthenticationPrincipal AuthenticatedKiosk kiosk,
            @RequestParam(required = false) @Parameter(description = "Optional order code to prefill (ignored unless it is an order of this machine).") String orderCode) {
        return ResponseEntity.ok().header("Cache-Control", "no-store").body(ApiResponse.success("Report link retrieved", links.kioskLink(kiosk, orderCode)));
    }
}
