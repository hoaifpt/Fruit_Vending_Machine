package com.fruitmachine.backend.customerreport.service;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fruitmachine.backend.common.exception.ConflictException;
import com.fruitmachine.backend.common.exception.ResourceNotFoundException;
import com.fruitmachine.backend.customerreport.config.PublicReportProperties;
import com.fruitmachine.backend.customerreport.dto.ReportLinkResponse;
import com.fruitmachine.backend.machine.entity.Machine;
import com.fruitmachine.backend.machine.repository.MachineRepository;
import com.fruitmachine.backend.order.repository.OrderRepository;
import com.fruitmachine.backend.security.kiosk.AuthenticatedKiosk;
import com.fruitmachine.backend.security.permission.Permissions;
import java.util.Locale;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.util.UriComponentsBuilder;

/** The public report URL of a machine for its kiosk QR, and its rotation by an administrator (issue #74 §2). */
@Service
@RequiredArgsConstructor
public class MachineReportLinkService {
    public static final String NOT_CONFIGURED = "REPORT_LINK_NOT_CONFIGURED";
    public static final String AUDIT_ROTATED = "MACHINE_REPORT_TOKEN_ROTATED";

    private final MachineRepository machines;
    private final OrderRepository orders;
    private final PublicReportProperties properties;
    private final ReportAudit audit;
    private final jakarta.persistence.EntityManager entityManager;

    /** The kiosk's own machine; an order code is added only when it is an order of that machine (otherwise ignored). */
    @Transactional(readOnly = true)
    @PreAuthorize("hasRole('KIOSK')")
    public ReportLinkResponse kioskLink(AuthenticatedKiosk kiosk, String orderCode) {
        Machine machine = machines.findById(kiosk.machineId()).orElseThrow(() -> new ResourceNotFoundException("Machine not found"));
        String order = null;
        if (orderCode != null && !orderCode.isBlank()) {
            String normalized = orderCode.strip().toUpperCase(Locale.ROOT);
            if (PublicReportService.ORDER_CODE.matcher(normalized).matches()
                    && orders.findByOrderCodeAndMachineId(normalized, machine.getId()).isPresent()) order = normalized;
        }
        return new ReportLinkResponse(machine.getId(), url(machine.getReportToken(), order));
    }

    /** A new token: the old QR stops working at once. */
    @Transactional
    @PreAuthorize(Permissions.HAS_MACHINE_REPORT_LINK_MANAGE)
    public ReportLinkResponse rotate(UUID machineId) {
        Machine machine = machines.findForUpdateById(machineId).orElseThrow(() -> new ResourceNotFoundException("Machine not found"));
        String token = ReportSupport.newReportToken();
        // A direct update: the column is database-generated on insert, so the entity does not write it.
        entityManager.createQuery("update Machine m set m.reportToken = :token where m.id = :id").setParameter("token", token)
                .setParameter("id", machine.getId()).executeUpdate();
        audit.write(AUDIT_ROTATED, "Machine", machine.getId(), null, JsonNodeFactory.instance.objectNode().put("machineCode", machine.getCode()));
        return new ReportLinkResponse(machine.getId(), url(token, null));
    }

    private String url(String token, String orderCode) {
        if (properties.baseUrl().isEmpty()) throw new ConflictException(NOT_CONFIGURED + ": the public report URL (PUBLIC_REPORT_BASE_URL) is not configured");
        var builder = UriComponentsBuilder.fromUriString(properties.baseUrl()).pathSegment(token);
        if (orderCode != null) builder.queryParam("order", orderCode);
        return builder.build().encode().toUriString();
    }
}
