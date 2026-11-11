package com.fruitmachine.backend.product.batch.controller;

import com.fruitmachine.backend.common.response.ApiErrorResponse;
import com.fruitmachine.backend.common.response.ApiResponse;
import com.fruitmachine.backend.product.batch.dto.*;
import com.fruitmachine.backend.product.batch.service.ProductBatchService;
import io.swagger.v3.oas.annotations.*;
import io.swagger.v3.oas.annotations.media.*;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController @RequiredArgsConstructor
@RequestMapping(value = "/api/v1/product-batches", produces = "application/json")
@PreAuthorize("hasAnyRole('ADMIN', 'STAFF')")
@SecurityRequirement(name = "bearerAuth")
@Tag(name = "Product Batches", description = "Management batch traceability. ACTIVE ADMIN and STAFF can create/read. Immutable after creation; no inventory workflows.")
@ApiResponses({
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "400", description = "Invalid parameters, request validation or malformed/unknown JSON fields", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "401", description = "Missing/invalid/expired Bearer token or unavailable account", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "403", description = "Authenticated account lacks ADMIN/STAFF role", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "500", description = "Unexpected server error; no internal details", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
})
public class ProductBatchController {
    private final ProductBatchService batches;
    @PostMapping(consumes = "application/json")
    @Operation(operationId = "createProductBatch", summary = "Register immutable product batch",
            description = "ADMIN or STAFF. Client supplies globally unique code; stripped and uppercased. Product must exist and be ACTIVE. "
                    + "Expiration must be strictly after preparation and current server time; offset timestamps become UTC at microsecond precision. "
                    + "Quantity is a positive 32-bit JSON integer token, not stock. Creator is taken from current authenticated user. "
                    + "Only batchCode/productId/manufacturedAt/expiresAt/quantity are accepted; creator, identity, inventory and location fields are rejected. "
                    + "No inventory or related entity changes. Database uniqueness protects concurrent creates.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "201", description = "Batch registered; Location points to immutable detail"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Referenced product not found", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "409", description = "Duplicate code, INACTIVE product or concurrent database conflict", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<ProductBatchResponse>> create(@Valid @RequestBody CreateProductBatchRequest request) {
        var batch = batches.createBatch(request);
        return ResponseEntity.created(URI.create("/api/v1/product-batches/" + batch.id())).header("Cache-Control", "no-store")
                .body(ApiResponse.success("Product batch created", batch));
    }
    @GetMapping
    @Operation(operationId = "listProductBatches", summary = "List product batches",
            description = "ADMIN or STAFF. Database pagination, default page 0/size 20, maximum 100. Optional exact product UUID filter; "
                    + "unknown product filter returns an empty page. Default createdAt,desc with UUID ascending tie-break. "
                    + "Includes expired batches and batches of INACTIVE products; no expiration filter or stock calculation. Current product SKU/name included.")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Paginated traceability records")
    public ResponseEntity<ApiResponse<ProductBatchPageResponse>> list(
            @RequestParam(defaultValue = "0") @Min(0) @Parameter(description = "Zero-based page index.") int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) @Parameter(description = "Page size, 1 to 100.") int size,
            @RequestParam(required = false) @Parameter(description = "Optional product UUID filter; no matches means empty page.") UUID productId,
            @RequestParam(defaultValue = "createdAt,desc") @Parameter(description = "One approved field: id, batchCode, manufacturedAt, expiresAt, quantity, createdAt; optional asc/desc, asc when omitted.") String sort) {
        return ResponseEntity.ok().header("Cache-Control", "no-store")
                .body(ApiResponse.success("Product batches retrieved", batches.listBatches(page, size, productId, sort)));
    }
    @GetMapping("/{id}")
    @Operation(operationId = "getProductBatch", summary = "Get product batch details",
            description = "ADMIN or STAFF. Immutable record including expired batches or INACTIVE products. Current product SKU/name and nullable legacy creator UUID only; no recursive entities or security data.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Batch traceability details"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Product batch not found", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<ProductBatchResponse>> get(@PathVariable @Parameter(description = "Product batch UUID.") UUID id) {
        return ResponseEntity.ok().header("Cache-Control", "no-store").body(ApiResponse.success("Product batch retrieved", batches.getBatch(id)));
    }
}
