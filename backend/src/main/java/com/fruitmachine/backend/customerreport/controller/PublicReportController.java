package com.fruitmachine.backend.customerreport.controller;

import com.fruitmachine.backend.common.response.ApiErrorResponse;
import com.fruitmachine.backend.common.response.ApiResponse;
import com.fruitmachine.backend.customerreport.dto.PublicReportRequest;
import com.fruitmachine.backend.customerreport.dto.ReportFormResponse;
import com.fruitmachine.backend.customerreport.dto.ReportSubmittedResponse;
import com.fruitmachine.backend.customerreport.ratelimit.ClientIpResolver;
import com.fruitmachine.backend.customerreport.service.PublicReportService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirements;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequiredArgsConstructor
@RequestMapping(produces = "application/json")
@SecurityRequirements
@Tag(name = "Public Reports", description = "Customer incident reports from the public web form (issue #74, WF-02). No authentication: the machine is "
        + "identified by the report token in its kiosk QR. Rate limited per client address (429 + Retry-After).")
@ApiResponses({
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Unknown or rotated report token, or INACTIVE machine (same body)", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "429", description = "Too many requests from this source or for this machine; see Retry-After", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "500", description = "Unexpected server error; no internal details", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
})
public class PublicReportController {
    private final PublicReportService service;
    private final ClientIpResolver clients;

    @GetMapping("/api/v1/public/report-forms/{reportToken}")
    @Operation(operationId = "getReportForm", summary = "Form information for a machine's report QR",
            description = "Public. Machine name and code, report types and photo limits. 30 requests / minute / source.")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Form information")
    public ResponseEntity<ApiResponse<ReportFormResponse>> form(@PathVariable @Parameter(description = "Report token from the QR.") String reportToken) {
        return ResponseEntity.ok().header("Cache-Control", "no-store").body(ApiResponse.success("Report form retrieved", service.form(reportToken)));
    }

    @PostMapping(path = "/api/v1/public/report-forms/{reportToken}/reports", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @Operation(operationId = "submitCustomerReport", summary = "Submit a customer incident report",
            description = "Public, multipart/form-data: part `report` (application/json) and 0..3 `photos` (JPEG or PNG by content, at most 2 MB and "
                    + "4000 x 4000 px each; re-encoded without metadata). PAID_NOT_RECEIVED needs orderCode; other types need a description; "
                    + "PAID_NOT_RECEIVED and PRODUCT_QUALITY need a phone or e-mail; consent must be true; unknown fields are 400. Every accepted "
                    + "submission gets the same 201 body, whatever the order state; a filled honeypot (website) is accepted and not stored. "
                    + "5 submissions / minute / source and 60 / hour / machine, counted before validation.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "201", description = "Report accepted"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "400", description = "Validation failed", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "413", description = "Request larger than 7 MB", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<ReportSubmittedResponse>> submit(@PathVariable @Parameter(description = "Report token from the QR.") String reportToken,
            @RequestPart("report") PublicReportRequest report,
            @RequestPart(name = "photos", required = false) @Parameter(description = "0..3 photos.") List<MultipartFile> photos,
            HttpServletRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).header("Cache-Control", "no-store")
                .body(ApiResponse.success("Report submitted", service.submit(reportToken, report, photos, clients.resolve(request))));
    }
}
