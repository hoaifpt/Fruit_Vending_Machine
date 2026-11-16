package com.fruitmachine.backend.dashboard.controller;

import com.fruitmachine.backend.common.response.ApiErrorResponse;
import com.fruitmachine.backend.common.response.ApiResponse;
import com.fruitmachine.backend.dashboard.dto.DashboardOverviewResponse;
import com.fruitmachine.backend.dashboard.service.DashboardService;
import com.fruitmachine.backend.security.permission.Permissions;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
@RequestMapping(produces = "application/json")
@SecurityRequirement(name = "bearerAuth")
@Tag(name = "Dashboard", description = "Operations dashboard (issue #76) for ADMIN and STAFF; money only for REPORT_SALES_READ holders.")
@ApiResponses({
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "401", description = "Missing/invalid/expired Bearer token", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "403", description = "Missing DASHBOARD_READ", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "500", description = "Unexpected server error; no internal details", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
})
public class DashboardController {
    private final DashboardService dashboard;

    @GetMapping("/api/v1/dashboard/overview")
    @PreAuthorize(Permissions.HAS_DASHBOARD_READ)
    @Operation(operationId = "getDashboardOverview", summary = "Home screen overview",
            description = "DASHBOARD_READ (ADMIN, STAFF). Machines (status, connectivity, latest temperature, sellable bowls, open alerts), alerts by severity, "
                    + "work orders (open, in progress, overdue, assigned to me), stock (low-stock and blocked slots, bowls expiring today; health-check predicates). "
                    + "today (orders and net sales of the business day, yesterday's net sales) and refunds (pending candidates) only with REPORT_SALES_READ: the "
                    + "fields are absent for STAFF. At most 7 SQL statements; poll every 30 s.")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Overview")
    public ResponseEntity<ApiResponse<DashboardOverviewResponse>> overview() {
        return ResponseEntity.ok().header("Cache-Control", "no-store").body(ApiResponse.success("Dashboard retrieved", dashboard.overview()));
    }
}
