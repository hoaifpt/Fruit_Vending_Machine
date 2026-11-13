package com.fruitmachine.backend.security.permission;

import java.util.List;

/**
 * Permission codes (V13 catalog, AUDIT_LOG_READ from V16, ALERT_* from V17) and the matching method-security expressions. Annotations reference these constants, so a
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
    public static final String PRICING_READ = "PRICING_READ";
    public static final String PRICING_MANAGE = "PRICING_MANAGE";
    public static final String MAINTENANCE_COMMAND_READ = "MAINTENANCE_COMMAND_READ";
    public static final String MAINTENANCE_COMMAND_EXECUTE = "MAINTENANCE_COMMAND_EXECUTE";
    public static final String MACHINE_RESET = "MACHINE_RESET";
    public static final String WORK_ORDER_READ_ALL = "WORK_ORDER_READ_ALL";
    public static final String WORK_ORDER_READ_ASSIGNED = "WORK_ORDER_READ_ASSIGNED";
    public static final String WORK_ORDER_MANAGE = "WORK_ORDER_MANAGE";
    public static final String WORK_ORDER_EXECUTE = "WORK_ORDER_EXECUTE";
    public static final String RESTOCK_PLAN = "RESTOCK_PLAN";
    public static final String RESTOCK_EXECUTE = "RESTOCK_EXECUTE";
    public static final String INVENTORY_LOAD_DIRECT = "INVENTORY_LOAD_DIRECT";
    public static final String MAINTENANCE_PLAN_READ = "MAINTENANCE_PLAN_READ";
    public static final String MAINTENANCE_PLAN_MANAGE = "MAINTENANCE_PLAN_MANAGE";
    public static final String PAYMENT_READ = "PAYMENT_READ";
    public static final String PAYMENT_WEBHOOK_LOG_READ = "PAYMENT_WEBHOOK_LOG_READ";
    public static final String AUDIT_LOG_READ = "AUDIT_LOG_READ";
    public static final String ALERT_READ = "ALERT_READ";
    public static final String ALERT_MANAGE = "ALERT_MANAGE";
    /** Not checked by an endpoint: users holding it receive a notification for every new alert. */
    public static final String ALERT_NOTIFY = "ALERT_NOTIFY";

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
    public static final String HAS_PRICING_READ = "hasAuthority('" + PRICING_READ + "')";
    public static final String HAS_PRICING_MANAGE = "hasAuthority('" + PRICING_MANAGE + "')";
    public static final String HAS_MAINTENANCE_COMMAND_READ = "hasAuthority('" + MAINTENANCE_COMMAND_READ + "')";
    public static final String HAS_MAINTENANCE_COMMAND_EXECUTE = "hasAuthority('" + MAINTENANCE_COMMAND_EXECUTE + "')";
    public static final String HAS_MACHINE_RESET = "hasAuthority('" + MACHINE_RESET + "')";
    public static final String HAS_WORK_ORDER_READ_ALL = "hasAuthority('" + WORK_ORDER_READ_ALL + "')";
    public static final String HAS_WORK_ORDER_READ_ASSIGNED = "hasAuthority('" + WORK_ORDER_READ_ASSIGNED + "')";
    public static final String HAS_WORK_ORDER_MANAGE = "hasAuthority('" + WORK_ORDER_MANAGE + "')";
    public static final String HAS_WORK_ORDER_EXECUTE = "hasAuthority('" + WORK_ORDER_EXECUTE + "')";
    public static final String HAS_RESTOCK_PLAN = "hasAuthority('" + RESTOCK_PLAN + "')";
    public static final String HAS_RESTOCK_EXECUTE = "hasAuthority('" + RESTOCK_EXECUTE + "')";
    public static final String HAS_INVENTORY_LOAD_DIRECT = "hasAuthority('" + INVENTORY_LOAD_DIRECT + "')";
    public static final String HAS_MAINTENANCE_PLAN_READ = "hasAuthority('" + MAINTENANCE_PLAN_READ + "')";
    public static final String HAS_MAINTENANCE_PLAN_MANAGE = "hasAuthority('" + MAINTENANCE_PLAN_MANAGE + "')";
    public static final String HAS_PAYMENT_READ = "hasAuthority('" + PAYMENT_READ + "')";
    public static final String HAS_PAYMENT_WEBHOOK_LOG_READ = "hasAuthority('" + PAYMENT_WEBHOOK_LOG_READ + "')";
    public static final String HAS_AUDIT_LOG_READ = "hasAuthority('" + AUDIT_LOG_READ + "')";
    public static final String HAS_ALERT_READ = "hasAuthority('" + ALERT_READ + "')";
    public static final String HAS_ALERT_MANAGE = "hasAuthority('" + ALERT_MANAGE + "')";
    /** Endpoints on the caller's own data (notifications): any signed-in user, no permission. */
    public static final String IS_USER = "isAuthenticated()";

    /** The full catalog of this release, in migration order (V13, V16, V17). */
    public static final List<String> ALL = List.of(USER_READ, USER_WRITE, PERMISSION_MANAGE, PRODUCT_READ, PRODUCT_WRITE, MACHINE_READ,
            MACHINE_WRITE, KIOSK_CREDENTIAL_MANAGE, BATCH_READ, BATCH_CREATE, INVENTORY_READ, INVENTORY_WRITE, ORDER_READ, PAYMENT_READ,
            PAYMENT_WEBHOOK_LOG_READ, AUDIT_LOG_READ, ALERT_READ, ALERT_MANAGE, ALERT_NOTIFY, PRICING_READ, PRICING_MANAGE, MAINTENANCE_COMMAND_READ,
            MAINTENANCE_COMMAND_EXECUTE, MACHINE_RESET, WORK_ORDER_READ_ALL, WORK_ORDER_READ_ASSIGNED, WORK_ORDER_MANAGE,
            WORK_ORDER_EXECUTE, RESTOCK_PLAN, RESTOCK_EXECUTE, INVENTORY_LOAD_DIRECT,
            MAINTENANCE_PLAN_READ, MAINTENANCE_PLAN_MANAGE);

    /** The ADMIN role must always keep these, otherwise nobody could manage users or permissions any more. */
    public static final List<String> ADMIN_REQUIRED = List.of(PERMISSION_MANAGE, USER_WRITE);

    private Permissions() {
    }
}
