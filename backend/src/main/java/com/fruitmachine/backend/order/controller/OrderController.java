package com.fruitmachine.backend.order.controller;

import com.fruitmachine.backend.common.response.ApiErrorResponse;
import com.fruitmachine.backend.common.response.ApiResponse;
import com.fruitmachine.backend.order.dto.OrderDetailResponse;
import com.fruitmachine.backend.order.dto.OrderPageResponse;
import com.fruitmachine.backend.order.enums.OrderStatus;
import com.fruitmachine.backend.order.service.OrderService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.time.Instant;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
@RequestMapping(produces = "application/json")
@PreAuthorize("hasAnyRole('ADMIN', 'STAFF')")
@SecurityRequirement(name = "bearerAuth")
@Tag(name = "Orders", description = "Read-only order management for ADMIN and STAFF. There is no write, delete or status endpoint; order status is produced only by backend workflows.")
@ApiResponses({
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "400", description = "Invalid parameters", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "401", description = "Missing/invalid/expired Bearer token (a kiosk key is not accepted here)", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "403", description = "Authenticated account lacks ADMIN/STAFF role", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "500", description = "Unexpected server error; no internal details", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
})
public class OrderController {
    private final OrderService orders;

    @GetMapping("/api/v1/orders")
    @Operation(operationId = "listOrders", summary = "List and filter orders",
            description = "ADMIN or STAFF. Database pagination page0/size20/max100. Filters combine: status, machineId, createdFrom (inclusive), createdTo (exclusive), search (literal case-insensitive substring of orderCode). "
                    + "Approved sorts createdAt (default desc), totalAmount, orderCode, each with a UUID tie-break.")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Database page of order summaries")
    public ResponseEntity<ApiResponse<OrderPageResponse>> list(
            @RequestParam(defaultValue = "0") @Min(0) @Parameter(description = "Zero-based page.") int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) @Parameter(description = "Page size 1..100.") int size,
            @RequestParam(required = false) @Parameter(description = "Exact stored order status.") OrderStatus status,
            @RequestParam(required = false) @Parameter(description = "Machine UUID filter.") UUID machineId,
            @RequestParam(required = false) @Parameter(description = "ISO-8601 instant, inclusive lower bound of createdAt.") Instant createdFrom,
            @RequestParam(required = false) @Parameter(description = "ISO-8601 instant, exclusive upper bound of createdAt.") Instant createdTo,
            @RequestParam(required = false) @Parameter(description = "Literal case-insensitive substring of orderCode.") String search,
            @RequestParam(defaultValue = "createdAt,desc") @Parameter(description = "One of createdAt, totalAmount, orderCode with optional asc/desc.") String sort) {
        return ok("Orders retrieved", orders.list(page, size, status, machineId, createdFrom, createdTo, search, sort));
    }

    @GetMapping("/api/v1/orders/{id}")
    @Operation(operationId = "getOrder", summary = "Get order details",
            description = "ADMIN or STAFF. Items with immutable price snapshots and the physical-bowl allocations of each line (slot code, batch code and expiry, status).")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Order details"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Order not found", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<OrderDetailResponse>> get(@PathVariable @Parameter(description = "Order UUID.") UUID id) {
        return ok("Order retrieved", orders.getDetail(id));
    }

    private <T> ResponseEntity<ApiResponse<T>> ok(String message, T data) {
        return ResponseEntity.ok().header("Cache-Control", "no-store").body(ApiResponse.success(message, data));
    }
}
