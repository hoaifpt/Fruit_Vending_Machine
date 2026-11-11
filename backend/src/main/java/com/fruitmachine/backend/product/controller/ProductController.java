package com.fruitmachine.backend.product.controller;

import com.fruitmachine.backend.common.response.ApiErrorResponse;
import com.fruitmachine.backend.common.response.ApiResponse;
import com.fruitmachine.backend.product.dto.*;
import com.fruitmachine.backend.product.enums.ProductStatus;
import com.fruitmachine.backend.product.service.ProductService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
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

@RestController
@RequestMapping(value = "/api/v1/products", produces = "application/json")
@RequiredArgsConstructor
@SecurityRequirement(name = "bearerAuth")
@Tag(name = "Products", description = "Management catalog. ACTIVE ADMIN/STAFF can read; ADMIN only can write. No public kiosk API.")
@ApiResponses({
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "400", description = "Invalid parameters, validation failure or malformed/unknown JSON fields", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "401", description = "Missing/invalid/expired Bearer token or unavailable account", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "403", description = "Authenticated account lacks the required role", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "500", description = "Unexpected server error; no internal details", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
})
public class ProductController {
    private final ProductService products;

    @GetMapping
    @PreAuthorize("hasAnyRole('ADMIN', 'STAFF')")
    @Operation(operationId = "listProducts", summary = "List/search catalog products",
            description = "ADMIN or STAFF. Database pagination with combined optional status and case-insensitive literal substring search on name/SKU. "
                    + "Default page 0, size 20; maximum size 100. One sort field/direction using Spring conventions, default createdAt,desc; UUID ascending tie-break. "
                    + "Both statuses are visible by default; out-of-range pages are empty.")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Paginated catalog products")
    public ResponseEntity<ApiResponse<ProductPageResponse>> list(
            @RequestParam(defaultValue = "0") @Min(0) @Parameter(description = "Zero-based page index.") int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) @Parameter(description = "Page size, 1 to 100.") int size,
            @RequestParam(required = false) @Parameter(description = "Optional ACTIVE or INACTIVE filter.") ProductStatus status,
            @RequestParam(required = false) @Size(max = 200) @Parameter(description = "Optional literal substring of name/SKU, case-insensitive, stripped; blank means no filter. Maximum 200 characters.") String search,
            @RequestParam(defaultValue = "createdAt,desc") @Parameter(description = "One approved field: id, sku, name, price, status, createdAt, updatedAt; optional asc/desc (asc when omitted). Example name,asc.") String sort) {
        return ResponseEntity.ok().header("Cache-Control", "no-store")
                .body(ApiResponse.success("Products retrieved", products.listProducts(page, size, status, search, sort)));
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAnyRole('ADMIN', 'STAFF')")
    @Operation(operationId = "getProduct", summary = "Get catalog product details",
            description = "ADMIN or STAFF. Returns catalog fields for an existing UUID, including INACTIVE products; no batch/inventory collections.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Catalog product"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Product not found", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<ProductResponse>> get(@PathVariable @Parameter(description = "Product UUID.") UUID id) {
        return success("Product retrieved", products.getProduct(id));
    }

    @PostMapping(consumes = "application/json")
    @PreAuthorize("hasRole('ADMIN')")
    @Operation(operationId = "createProduct", summary = "Create catalog product",
            description = "ADMIN only. Creates ACTIVE product with stripped/uppercased unique SKU and positive BigDecimal price. "
                    + "Only sku/name/description/price/imageUrl are accepted. Status/id/timestamps/batch/inventory fields are rejected. "
                    + "Price is at most 9999999999.99 and two decimal places; no silent rounding. Database UNIQUE protects concurrent creates.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "201", description = "ACTIVE product created; Location points to the product"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "409", description = "SKU already exists or concurrent database uniqueness conflict", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<ProductResponse>> create(@Valid @RequestBody CreateProductRequest request) {
        var product = products.createProduct(request);
        return ResponseEntity.created(URI.create("/api/v1/products/" + product.id())).header("Cache-Control", "no-store")
                .body(ApiResponse.success("Product created", product));
    }

    @PutMapping(value = "/{id}", consumes = "application/json")
    @PreAuthorize("hasRole('ADMIN')")
    @Operation(operationId = "updateProduct", summary = "Replace catalog product fields",
            description = "ADMIN only. Replaces name/description/price/imageUrl. Omitted/null description/imageUrl clears them. "
                    + "SKU/status/id/timestamps are rejected. Does not rewrite historical order prices, payments or batches.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Updated catalog product"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Product not found", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<ProductResponse>> update(@PathVariable @Parameter(description = "Product UUID.") UUID id,
            @Valid @RequestBody UpdateProductRequest request) {
        return success("Product updated", products.updateProduct(id, request));
    }

    @PatchMapping(value = "/{id}/status", consumes = "application/json")
    @PreAuthorize("hasRole('ADMIN')")
    @Operation(operationId = "updateProductStatus", summary = "Activate/deactivate catalog product",
            description = "ADMIN only. Sets ACTIVE or INACTIVE, preserving identity and all related history. INACTIVE disables future operational use, not deletion. "
                    + "Same-status requests are idempotent. No inventory/batch/order changes or hard deletion.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Product with current catalog status"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Product not found", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<ProductResponse>> status(@PathVariable @Parameter(description = "Product UUID.") UUID id,
            @Valid @RequestBody UpdateProductStatusRequest request) {
        return success("Product status updated", products.updateStatus(id, request));
    }

    private ResponseEntity<ApiResponse<ProductResponse>> success(String message, ProductResponse product) {
        return ResponseEntity.ok().header("Cache-Control", "no-store").body(ApiResponse.success(message, product));
    }
}
