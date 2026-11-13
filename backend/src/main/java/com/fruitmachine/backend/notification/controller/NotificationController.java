package com.fruitmachine.backend.notification.controller;

import com.fruitmachine.backend.common.response.ApiErrorResponse;
import com.fruitmachine.backend.common.response.ApiResponse;
import com.fruitmachine.backend.notification.dto.MarkedReadResponse;
import com.fruitmachine.backend.notification.dto.NotificationPageResponse;
import com.fruitmachine.backend.notification.dto.UnreadCountResponse;
import com.fruitmachine.backend.notification.service.NotificationService;
import com.fruitmachine.backend.security.permission.Permissions;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping(value = "/api/v1/notifications", produces = "application/json")
@RequiredArgsConstructor
@SecurityRequirement(name = "bearerAuth")
@Tag(name = NotificationController.TAG, description = NotificationController.TAG_DESCRIPTION)
@ApiResponses({
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "400", description = "Malformed UUID or invalid paging", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "401", description = "Missing/invalid/expired Bearer token or unavailable account; kiosk keys are not accepted", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "500", description = "Unexpected server error; no internal details", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
})
public class NotificationController {
    public static final String TAG = "Notifications";
    public static final String TAG_DESCRIPTION = "Portal notifications of the signed-in user: one per new alert for users holding ALERT_NOTIFY (ADMIN by default). "
            + "Any signed-in user, own notifications only; no extra permission. Poll unread-count every 30 s.";

    private final NotificationService notifications;

    @GetMapping("/me")
    @PreAuthorize(Permissions.IS_USER)
    @Operation(operationId = "listMyNotifications", summary = "List my notifications",
            description = "Signed-in user. Own notifications, newest first; unreadOnly=true keeps unread ones. page >= 0, size 1 to 100 (default 20).")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Page of notifications")
    public ResponseEntity<ApiResponse<NotificationPageResponse>> mine(
            @RequestParam(defaultValue = "false") @Parameter(description = "Only unread notifications.") boolean unreadOnly,
            @RequestParam(defaultValue = "0") @Parameter(description = "Zero-based page index.") int page,
            @RequestParam(defaultValue = "20") @Parameter(description = "Page size, 1 to 100.") int size) {
        return ok("Notifications retrieved", notifications.mine(unreadOnly, page, size));
    }

    @GetMapping("/me/unread-count")
    @PreAuthorize(Permissions.IS_USER)
    @Operation(operationId = "countMyUnreadNotifications", summary = "Count my unread notifications",
            description = "Signed-in user. Cheap count for polling (every 30 s recommended).")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Unread count")
    public ResponseEntity<ApiResponse<UnreadCountResponse>> unreadCount() {
        return ok("Unread count retrieved", notifications.unreadCount());
    }

    @PostMapping("/{id}/read")
    @PreAuthorize(Permissions.IS_USER)
    @Operation(operationId = "markNotificationRead", summary = "Mark one notification read",
            description = "Signed-in user, own notification only (another user's id is 404). Idempotent: marked is 0 when it was already read.")
    @ApiResponses({
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Marked read"),
        @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "404", description = "Notification not found", content = @Content(schema = @Schema(implementation = ApiErrorResponse.class)))
    })
    public ResponseEntity<ApiResponse<MarkedReadResponse>> markRead(@PathVariable @Parameter(description = "Notification UUID.") UUID id) {
        return ok("Notification marked read", notifications.markRead(id));
    }

    @PostMapping("/me/read-all")
    @PreAuthorize(Permissions.IS_USER)
    @Operation(operationId = "markAllMyNotificationsRead", summary = "Mark all my notifications read", description = "Signed-in user. Marks every unread own notification read.")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", description = "Number marked read")
    public ResponseEntity<ApiResponse<MarkedReadResponse>> markAllRead() {
        return ok("Notifications marked read", notifications.markAllRead());
    }

    private static <T> ResponseEntity<ApiResponse<T>> ok(String message, T data) {
        return ResponseEntity.ok().header("Cache-Control", "no-store").body(ApiResponse.success(message, data));
    }
}
