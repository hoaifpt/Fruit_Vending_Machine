package com.fruitmachine.backend.report.controller;

import com.fruitmachine.backend.common.response.ApiErrorResponse;
import com.fruitmachine.backend.common.response.ApiResponse;
import com.fruitmachine.backend.report.model.MachineReport;
import com.fruitmachine.backend.report.model.PeakHours;
import com.fruitmachine.backend.report.model.ProductReport;
import com.fruitmachine.backend.report.model.SalesSeries;
import com.fruitmachine.backend.report.model.SalesSummary;
import com.fruitmachine.backend.report.service.ReportExportService;
import com.fruitmachine.backend.report.service.SalesReportService;
import com.fruitmachine.backend.security.permission.Permissions;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ContentDisposition;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequiredArgsConstructor
@SecurityRequirement(name = "bearerAuth")
@Tag(name = "Reports", description = "Sales reports (issue #76), ADMIN only. Amounts in whole VND; days and hours in the business zone (Asia/Ho_Chi_Minh). "
        + "A sale is a delivered order, attributed to completed_at; refunds are attributed to refunded_at; discounts and refunds are shown separately. "
        + "Definitions: docs/reports.md. Common filters: from, to (inclusive dates, at most 366 days), machineId and productId (repeatable, at most 20; unknown id is 400).")
@ApiResponses({
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "400", description = "Missing / invalid range, too many or unknown ids", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "401", description = "Missing/invalid/expired Bearer token", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "403", description = "Missing the report permission (STAFF has no access to revenue)", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "500", description = "Unexpected server error; no internal details", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
})
public class SalesReportController {
    private final SalesReportService reports;
    private final ReportExportService exports;

    @GetMapping(path = "/api/v1/reports/sales/summary", produces = "application/json")
    @PreAuthorize(Permissions.HAS_REPORT_SALES_READ)
    @Operation(operationId = "getSalesSummary", summary = "Sales summary",
            description = "REPORT_SALES_READ. ordersSold, grossSales, discounts, netSales (sales by completed_at); deliveredRefunds (PRODUCT_QUALITY / OTHER refunds "
                    + "of delivered orders by refunded_at); netRevenue = netSales - deliveredRefunds; averageOrderValue = netSales / ordersSold rounded down; "
                    + "moneyCollected (payments SUCCESS / REFUNDED by paid_at); moneyRefunded (all refunds by refunded_at, by reason); pendingRefunds (current refund "
                    + "candidates, ignores the filters); failedDispenses (orders paid in range that failed to dispense).")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Summary")
    public ResponseEntity<ApiResponse<SalesSummary>> summary(@RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) @Parameter(description = "First day (inclusive).") LocalDate from,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) @Parameter(description = "Last day (inclusive).") LocalDate to,
            @RequestParam(name = "machineId", required = false) @Parameter(description = "Machine filter, repeatable.") List<UUID> machineIds,
            @RequestParam(name = "productId", required = false) @Parameter(description = "Product filter, repeatable.") List<UUID> productIds) {
        return ok("Sales summary retrieved", reports.summary(reports.filters(from, to, machineIds, productIds)));
    }

    @GetMapping(path = "/api/v1/reports/sales/timeseries", produces = "application/json")
    @PreAuthorize(Permissions.HAS_REPORT_SALES_READ)
    @Operation(operationId = "getSalesTimeseries", summary = "Sales time series",
            description = "REPORT_SALES_READ. One bucket per DAY, ISO WEEK (Monday start) or calendar MONTH in the business zone, zero-filled; start / end are clipped "
                    + "to the range. Per bucket: ordersSold, grossSales, discounts, netSales, deliveredRefunds (by refunded_at), netRevenue.")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Time series")
    public ResponseEntity<ApiResponse<SalesSeries>> timeseries(@RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) @Parameter(description = "First day (inclusive).") LocalDate from,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) @Parameter(description = "Last day (inclusive).") LocalDate to,
            @RequestParam(name = "machineId", required = false) @Parameter(description = "Machine filter, repeatable.") List<UUID> machineIds,
            @RequestParam(name = "productId", required = false) @Parameter(description = "Product filter, repeatable.") List<UUID> productIds,
            @RequestParam(defaultValue = "DAY") @Parameter(description = "DAY, WEEK or MONTH.") SalesSeries.Granularity granularity) {
        return ok("Sales time series retrieved", reports.series(reports.filters(from, to, machineIds, productIds), granularity));
    }

    @GetMapping(path = "/api/v1/reports/sales/peak-hours", produces = "application/json")
    @PreAuthorize(Permissions.HAS_REPORT_SALES_READ)
    @Operation(operationId = "getSalesPeakHours", summary = "Sales by hour of day",
            description = "REPORT_SALES_READ. 24 entries (hour of completed_at in the business zone) with ordersSold and netSales, plus a 7 x 24 matrix of ordersSold "
                    + "(Monday first).")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Peak hours")
    public ResponseEntity<ApiResponse<PeakHours>> peakHours(@RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) @Parameter(description = "First day (inclusive).") LocalDate from,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) @Parameter(description = "Last day (inclusive).") LocalDate to,
            @RequestParam(name = "machineId", required = false) @Parameter(description = "Machine filter, repeatable.") List<UUID> machineIds,
            @RequestParam(name = "productId", required = false) @Parameter(description = "Product filter, repeatable.") List<UUID> productIds) {
        return ok("Peak hours retrieved", reports.peakHours(reports.filters(from, to, machineIds, productIds)));
    }

    @GetMapping(path = "/api/v1/reports/sales/products", produces = "application/json")
    @PreAuthorize(Permissions.HAS_REPORT_SALES_READ)
    @Operation(operationId = "getSalesByProduct", summary = "Top products",
            description = "REPORT_SALES_READ. Products with sales or delivered refunds in range (inactive products included): quantity, grossSales, discounts, netSales, "
                    + "deliveredRefunds, sharePercent (netSales / total netSales, 1 decimal, 0 when the total is 0). Sorted by QUANTITY or NET_SALES descending, ties by "
                    + "name then id; limit 1..100.")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Products")
    public ResponseEntity<ApiResponse<ProductReport>> products(@RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) @Parameter(description = "First day (inclusive).") LocalDate from,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) @Parameter(description = "Last day (inclusive).") LocalDate to,
            @RequestParam(name = "machineId", required = false) @Parameter(description = "Machine filter, repeatable.") List<UUID> machineIds,
            @RequestParam(name = "productId", required = false) @Parameter(description = "Product filter, repeatable.") List<UUID> productIds,
            @RequestParam(defaultValue = "NET_SALES") @Parameter(description = "QUANTITY or NET_SALES.") ProductReport.SortBy sortBy,
            @RequestParam(defaultValue = "10") @Parameter(description = "1..100.") int limit) {
        return ok("Product sales retrieved", reports.products(reports.filters(from, to, machineIds, productIds), sortBy, limit));
    }

    @GetMapping(path = "/api/v1/reports/sales/machines", produces = "application/json")
    @PreAuthorize(Permissions.HAS_REPORT_SALES_READ)
    @Operation(operationId = "getSalesByMachine", summary = "Sales by machine",
            description = "REPORT_SALES_READ. Every machine (or the filtered ones) with ordersSold, netSales, deliveredRefunds and netRevenue; zeros when nothing was sold.")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Machines")
    public ResponseEntity<ApiResponse<MachineReport>> machines(@RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) @Parameter(description = "First day (inclusive).") LocalDate from,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) @Parameter(description = "Last day (inclusive).") LocalDate to,
            @RequestParam(name = "machineId", required = false) @Parameter(description = "Machine filter, repeatable.") List<UUID> machineIds,
            @RequestParam(name = "productId", required = false) @Parameter(description = "Product filter, repeatable.") List<UUID> productIds) {
        return ok("Machine sales retrieved", reports.machines(reports.filters(from, to, machineIds, productIds)));
    }

    @GetMapping(path = "/api/v1/reports/sales/export", produces = {"text/csv", "application/pdf", "application/json"})
    @PreAuthorize(Permissions.HAS_REPORT_EXPORT)
    @Operation(operationId = "exportSalesReport", summary = "Export the sales report as CSV or PDF",
            description = "REPORT_EXPORT. One report (summary, DAY series, peak hours, all products, machines) rendered as CSV (UTF-8 with BOM, sections, RFC 4180, "
                    + "formula-injection guard) or PDF (A4, Noto Sans, amounts 1.234.567 ₫); both carry exactly the same numbers. Attachment "
                    + "freshvend-sales_<from>_<to>.<csv|pdf>, Cache-Control no-store. One audit_logs row REPORT_EXPORTED per export.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "The file", content = {
            @Content(mediaType = "text/csv", schema = @Schema(type = "string", format = "binary")),
            @Content(mediaType = "application/pdf", schema = @Schema(type = "string", format = "binary"))})
    })
    public void export(@RequestParam @Parameter(description = "CSV or PDF.") ReportExportService.Format format,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) @Parameter(description = "First day (inclusive).") LocalDate from,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) @Parameter(description = "Last day (inclusive).") LocalDate to,
            @RequestParam(name = "machineId", required = false) @Parameter(description = "Machine filter, repeatable.") List<UUID> machineIds,
            @RequestParam(name = "productId", required = false) @Parameter(description = "Product filter, repeatable.") List<UUID> productIds,
            HttpServletResponse response) throws IOException {
        var filters = reports.filters(from, to, machineIds, productIds);
        var report = exports.prepare(filters, format);
        response.setStatus(HttpServletResponse.SC_OK);
        response.setContentType(format == ReportExportService.Format.CSV ? "text/csv;charset=UTF-8" : "application/pdf");
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Content-Disposition", ContentDisposition.attachment().filename(ReportExportService.filename(filters, format)).build().toString());
        exports.render(report, format, response.getOutputStream());
        response.flushBuffer();
    }

    private <T> ResponseEntity<ApiResponse<T>> ok(String message, T data) {
        return ResponseEntity.ok().header("Cache-Control", "no-store").body(ApiResponse.success(message, data));
    }
}
