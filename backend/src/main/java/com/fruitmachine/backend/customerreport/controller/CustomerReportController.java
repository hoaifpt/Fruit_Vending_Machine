package com.fruitmachine.backend.customerreport.controller;

import com.fruitmachine.backend.common.response.ApiErrorResponse;
import com.fruitmachine.backend.common.response.ApiResponse;
import com.fruitmachine.backend.customerreport.dto.CustomerReportDetailResponse;
import com.fruitmachine.backend.customerreport.dto.CustomerReportPageResponse;
import com.fruitmachine.backend.customerreport.dto.ReportDecisionRequest;
import com.fruitmachine.backend.customerreport.dto.ReportLinkResponse;
import com.fruitmachine.backend.customerreport.enums.ReportStatus;
import com.fruitmachine.backend.customerreport.enums.ReportType;
import com.fruitmachine.backend.customerreport.enums.ReportVerdict;
import com.fruitmachine.backend.customerreport.service.CustomerReportAdminService;
import com.fruitmachine.backend.customerreport.service.MachineReportLinkService;
import com.fruitmachine.backend.security.permission.Permissions;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.time.LocalDate;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

@RestController
@Validated
@RequiredArgsConstructor
@SecurityRequirement(name = "bearerAuth")
@Tag(name = "Customer Reports", description = "Review of customer incident reports (issue #74). ADMIN sees everything with full contact data; STAFF only "
        + "reports of work orders assigned to them, contact masked.")
@ApiResponses({
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "400", description = "Invalid parameters or body", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "401", description = "Missing/invalid/expired Bearer token", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "403", description = "Missing the permission", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "500", description = "Unexpected server error; no internal details", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
})
public class CustomerReportController {
    private final CustomerReportAdminService reports;
    private final MachineReportLinkService links;

    @GetMapping(path = "/api/v1/customer-reports", produces = "application/json")
    @PreAuthorize(Permissions.HAS_CUSTOMER_REPORT_READ)
    @Operation(operationId = "listCustomerReports", summary = "List customer reports",
            description = "CUSTOMER_REPORT_READ. Newest first, database paging; from/to are business-zone dates of createdAt (inclusive). Contact data is always masked here. "
                    + "Without CUSTOMER_REPORT_MANAGE only reports of work orders assigned to the caller are listed.")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Page of reports")
    public ResponseEntity<ApiResponse<CustomerReportPageResponse>> list(
            @RequestParam(required = false) @Parameter(description = "Status filter.") ReportStatus status,
            @RequestParam(required = false) @Parameter(description = "Type filter.") ReportType type,
            @RequestParam(required = false) @Parameter(description = "Verdict filter.") ReportVerdict verdict,
            @RequestParam(required = false) @Parameter(description = "Machine UUID filter.") UUID machineId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) @Parameter(description = "First business-zone day (inclusive).") LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) @Parameter(description = "Last business-zone day (inclusive).") LocalDate to,
            @RequestParam(required = false) @Parameter(description = "true: only reports with a verified order; false: only without.") Boolean hasOrder,
            @RequestParam(defaultValue = "0") @Min(0) @Parameter(description = "Zero-based page.") int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) @Parameter(description = "Page size 1..100.") int size) {
        return ok("Customer reports retrieved", reports.list(status, type, verdict, machineId, from, to, hasOrder, page, size));
    }

    @GetMapping(path = "/api/v1/customer-reports/{id}", produces = "application/json")
    @PreAuthorize(Permissions.HAS_CUSTOMER_REPORT_READ)
    @Operation(operationId = "getCustomerReport", summary = "Get a customer report",
            description = "CUSTOMER_REPORT_READ. Full contact data only for CUSTOMER_REPORT_MANAGE; reports the caller may not see are 404.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Report detail"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Report not found or not visible", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<CustomerReportDetailResponse>> get(@PathVariable @Parameter(description = "Report UUID.") UUID id) {
        return ok("Customer report retrieved", reports.get(id));
    }

    @GetMapping(path = "/api/v1/customer-reports/{id}/photos/{photoId}", produces = {MediaType.IMAGE_JPEG_VALUE, MediaType.IMAGE_PNG_VALUE, "application/json"})
    @PreAuthorize(Permissions.HAS_CUSTOMER_REPORT_READ)
    @Operation(operationId = "getCustomerReportPhoto", summary = "Get a report photo",
            description = "CUSTOMER_REPORT_READ, same visibility as the report. The re-encoded image with its stored Content-Type, inline, nosniff, private no-store.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "The image", content = {
            @Content(mediaType = MediaType.IMAGE_JPEG_VALUE, schema = @Schema(type = "string", format = "binary")),
            @Content(mediaType = MediaType.IMAGE_PNG_VALUE, schema = @Schema(type = "string", format = "binary"))}),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Report or photo not found or not visible", content = @Content(mediaType = "application/json", schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<byte[]> photo(@PathVariable @Parameter(description = "Report UUID.") UUID id,
            @PathVariable @Parameter(description = "Photo UUID.") UUID photoId) {
        var photo = reports.photo(id, photoId);
        return ResponseEntity.ok().contentType(MediaType.parseMediaType(photo.getContentType())).contentLength(photo.getData().length)
                .header("Content-Disposition", ContentDisposition.inline().build().toString())
                .header("X-Content-Type-Options", "nosniff")
                .cacheControl(CacheControl.noStore().cachePrivate())
                .body(photo.getData());
    }

    @PostMapping(path = "/api/v1/customer-reports/{id}/review", produces = "application/json")
    @PreAuthorize(Permissions.HAS_CUSTOMER_REPORT_MANAGE)
    @Operation(operationId = "reviewCustomerReport", summary = "Take a report into review",
            description = "CUSTOMER_REPORT_MANAGE (ADMIN). NEW -> IN_REVIEW, audited. 409 REPORT_NOT_NEW or REPORT_ALREADY_CLOSED.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Report detail"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Report not found", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "409", description = "REPORT_NOT_NEW or REPORT_ALREADY_CLOSED", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<CustomerReportDetailResponse>> review(@PathVariable @Parameter(description = "Report UUID.") UUID id) {
        return ok("Customer report in review", reports.review(id));
    }

    @PostMapping(path = "/api/v1/customer-reports/{id}/resolve", consumes = "application/json", produces = "application/json")
    @PreAuthorize(Permissions.HAS_CUSTOMER_REPORT_MANAGE)
    @Operation(operationId = "resolveCustomerReport", summary = "Resolve a report",
            description = "CUSTOMER_REPORT_MANAGE (ADMIN). resolution FIXED, NO_ACTION_NEEDED or REFUNDED; RESOLVED is final (409 REPORT_ALREADY_CLOSED). Audited. "
                    + "Recording a refund for the order (POST /payments/{id}/refund) resolves its open reports as REFUNDED automatically.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Report detail"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Report not found", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "409", description = "REPORT_ALREADY_CLOSED", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<CustomerReportDetailResponse>> resolve(@PathVariable @Parameter(description = "Report UUID.") UUID id,
            @Valid @RequestBody ReportDecisionRequest request) {
        return ok("Customer report resolved", reports.resolve(id, request));
    }

    @PostMapping(path = "/api/v1/customer-reports/{id}/reject", consumes = "application/json", produces = "application/json")
    @PreAuthorize(Permissions.HAS_CUSTOMER_REPORT_MANAGE)
    @Operation(operationId = "rejectCustomerReport", summary = "Reject a report",
            description = "CUSTOMER_REPORT_MANAGE (ADMIN). resolution SPAM or DUPLICATE; REJECTED is final (409 REPORT_ALREADY_CLOSED). Audited.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Report detail"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Report not found", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "409", description = "REPORT_ALREADY_CLOSED", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<CustomerReportDetailResponse>> reject(@PathVariable @Parameter(description = "Report UUID.") UUID id,
            @Valid @RequestBody ReportDecisionRequest request) {
        return ok("Customer report rejected", reports.reject(id, request));
    }

    @PostMapping(path = "/api/v1/machines/{id}/report-token/rotate", produces = "application/json")
    @PreAuthorize(Permissions.HAS_MACHINE_REPORT_LINK_MANAGE)
    @Operation(operationId = "rotateMachineReportToken", summary = "Rotate the public report QR of a machine",
            description = "MACHINE_REPORT_LINK_MANAGE (ADMIN). A new report token; the old QR stops working at once (404). Returns the new URL. Audited. "
                    + "409 REPORT_LINK_NOT_CONFIGURED when PUBLIC_REPORT_BASE_URL is not set.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "New report URL"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Machine not found", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "409", description = "REPORT_LINK_NOT_CONFIGURED", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<ReportLinkResponse>> rotate(@PathVariable @Parameter(description = "Machine UUID.") UUID id) {
        return ok("Report token rotated", links.rotate(id));
    }

    private <T> ResponseEntity<ApiResponse<T>> ok(String message, T data) {
        return ResponseEntity.ok().header("Cache-Control", "no-store").body(ApiResponse.success(message, data));
    }
}
