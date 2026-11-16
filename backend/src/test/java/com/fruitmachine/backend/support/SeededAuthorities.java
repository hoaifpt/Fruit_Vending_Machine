package com.fruitmachine.backend.support;

import com.fruitmachine.backend.security.permission.Permissions;
import java.util.List;
import java.util.stream.Stream;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;

/** Issue #48: the authorities a principal of a seeded role gets from V13, for tests that build a principal by hand. */
public final class SeededAuthorities {
    public static final List<String> STAFF_PERMISSIONS = List.of(Permissions.ALERT_MANAGE, Permissions.ALERT_READ, Permissions.BATCH_CREATE,
            Permissions.BATCH_READ, Permissions.CUSTOMER_REPORT_READ, Permissions.INVENTORY_READ, Permissions.INVENTORY_WRITE, Permissions.MACHINE_READ, Permissions.ORDER_READ,
            Permissions.MAINTENANCE_COMMAND_EXECUTE, Permissions.MAINTENANCE_COMMAND_READ, Permissions.MAINTENANCE_PLAN_READ, Permissions.PRICING_READ, Permissions.PRODUCT_READ,
            Permissions.RESTOCK_EXECUTE, Permissions.WORK_ORDER_EXECUTE, Permissions.WORK_ORDER_READ_ASSIGNED);

    private SeededAuthorities() {
    }

    public static List<GrantedAuthority> of(String role) {
        var permissions = role.equals("ADMIN") ? Permissions.ALL : role.equals("STAFF") ? STAFF_PERMISSIONS : List.<String>of();
        return Stream.concat(Stream.of("ROLE_" + role), permissions.stream()).<GrantedAuthority>map(SimpleGrantedAuthority::new).toList();
    }
}
