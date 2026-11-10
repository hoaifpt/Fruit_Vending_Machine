package com.fruitmachine.backend.security.permission;

import java.util.List;

/**
 * Permission codes (V13 catalog) and the matching method-security expressions. Annotations reference these constants, so a
 * typo fails compilation instead of silently denying access. A new permission needs: a migration inserting the permission and
 * its role_permissions rows (fixed UUIDs), a constant here (code + HAS_ expression, and an entry in ALL), the URL rule in
 * SecurityConfig, the @PreAuthorize on the endpoint and an entry in the authorization tests. See docs/permission-authorization.md.
 */
public final class Permissions {
    public static final String USER_READ = "USER_READ";
    public static final String USER_WRITE = "USER_WRITE";
    public static final String PERMISSION_MANAGE = "PERMISSION_MANAGE";
    public static final String PRODUCT_READ = "PRODUCT_READ";
    public static final String PRODUCT_WRITE = "PRODUCT_WRITE";
    public static final String MACHINE_READ = "MACHINE_READ";
    public static final String MACHINE_WRITE = "MACHINE_WRITE";
    public static final String KIOSK_CREDENTIAL_MANAGE = "KIOSK_CREDENTIAL_MANAGE";
    public static final String BATCH_READ = "BATCH_READ";
    public static final String BATCH_CREATE = "BATCH_CREATE";
    public static final String INVENTORY_READ = "INVENTORY_READ";
    public static final String INVENTORY_WRITE = "INVENTORY_WRITE";
    public static final String ORDER_READ = "ORDER_READ";
    public static final String PAYMENT_READ = "PAYMENT_READ";
    public static final String PAYMENT_WEBHOOK_LOG_READ = "PAYMENT_WEBHOOK_LOG_READ";

    public static final String HAS_USER_READ = "hasAuthority('" + USER_READ + "')";
    public static final String HAS_USER_WRITE = "hasAuthority('" + USER_WRITE + "')";
    public static final String HAS_PERMISSION_MANAGE = "hasAuthority('" + PERMISSION_MANAGE + "')";
    public static final String HAS_PRODUCT_READ = "hasAuthority('" + PRODUCT_READ + "')";
    public static final String HAS_PRODUCT_WRITE = "hasAuthority('" + PRODUCT_WRITE + "')";
    public static final String HAS_MACHINE_READ = "hasAuthority('" + MACHINE_READ + "')";
    public static final String HAS_MACHINE_WRITE = "hasAuthority('" + MACHINE_WRITE + "')";
    public static final String HAS_KIOSK_CREDENTIAL_MANAGE = "hasAuthority('" + KIOSK_CREDENTIAL_MANAGE + "')";
    public static final String HAS_BATCH_READ = "hasAuthority('" + BATCH_READ + "')";
    public static final String HAS_BATCH_CREATE = "hasAuthority('" + BATCH_CREATE + "')";
    public static final String HAS_INVENTORY_READ = "hasAuthority('" + INVENTORY_READ + "')";
    public static final String HAS_INVENTORY_WRITE = "hasAuthority('" + INVENTORY_WRITE + "')";
    public static final String HAS_ORDER_READ = "hasAuthority('" + ORDER_READ + "')";
    public static final String HAS_PAYMENT_READ = "hasAuthority('" + PAYMENT_READ + "')";
    public static final String HAS_PAYMENT_WEBHOOK_LOG_READ = "hasAuthority('" + PAYMENT_WEBHOOK_LOG_READ + "')";

    /** The full catalog of this release, in V13 order. */
    public static final List<String> ALL = List.of(USER_READ, USER_WRITE, PERMISSION_MANAGE, PRODUCT_READ, PRODUCT_WRITE, MACHINE_READ,
            MACHINE_WRITE, KIOSK_CREDENTIAL_MANAGE, BATCH_READ, BATCH_CREATE, INVENTORY_READ, INVENTORY_WRITE, ORDER_READ, PAYMENT_READ,
            PAYMENT_WEBHOOK_LOG_READ);

    /** The ADMIN role must always keep these, otherwise nobody could manage users or permissions any more. */
    public static final List<String> ADMIN_REQUIRED = List.of(PERMISSION_MANAGE, USER_WRITE);

    private Permissions() {
    }
}
