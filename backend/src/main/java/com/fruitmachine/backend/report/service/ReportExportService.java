package com.fruitmachine.backend.report.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fruitmachine.backend.audit.entity.AuditLog;
import com.fruitmachine.backend.audit.repository.AuditLogRepository;
import com.fruitmachine.backend.report.export.CsvSalesReportWriter;
import com.fruitmachine.backend.report.export.PdfSalesReportWriter;
import com.fruitmachine.backend.report.model.ReportFilters;
import com.fruitmachine.backend.report.model.SalesReport;
import com.fruitmachine.backend.security.permission.Permissions;
import com.fruitmachine.backend.security.user.AuthenticatedUser;
import com.fruitmachine.backend.user.entity.User;
import com.fruitmachine.backend.user.repository.UserRepository;
import java.io.IOException;
import java.io.OutputStream;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/** Builds the SalesReport once, writes one audit row (REPORT_EXPORTED), and renders it as CSV or PDF (issue #76). */
@Service
@RequiredArgsConstructor
public class ReportExportService {
    public static final String AUDIT_ACTION = "REPORT_EXPORTED";

    public enum Format { CSV, PDF }

    private final SalesReportService reports;
    private final CsvSalesReportWriter csv;
    private final PdfSalesReportWriter pdf;
    private final AuditLogRepository audits;
    private final UserRepository users;
    private final ObjectMapper json;

    /** The report and its audit row, in one transaction; rendering happens afterwards without the database. */
    @Transactional
    @PreAuthorize(Permissions.HAS_REPORT_EXPORT)
    public SalesReport prepare(ReportFilters filters, Format format) {
        var principal = (AuthenticatedUser) SecurityContextHolder.getContext().getAuthentication().getPrincipal();
        User actor = users.findById(principal.getId()).orElseThrow();
        SalesReport report = reports.report(filters, actor.getFullName());
        ObjectNode details = json.createObjectNode().put("format", format.name());
        details.set("filters", json.valueToTree(filters.echo()));
        var row = new AuditLog();
        row.setUser(actor);
        row.setAction(AUDIT_ACTION);
        row.setEntityType("SalesReport");
        row.setEntityId(actor.getId());
        row.setNewValue(details);
        row.setIpAddress(clientIp());
        audits.save(row);
        return report;
    }

    public void render(SalesReport report, Format format, OutputStream output) throws IOException {
        if (format == Format.CSV) csv.write(report, output);
        else pdf.write(report, output);
    }

    public static String filename(ReportFilters filters, Format format) {
        return "freshvend-sales_" + filters.from() + "_" + filters.to() + "." + format.name().toLowerCase(java.util.Locale.ROOT);
    }

    private static String clientIp() {
        if (!(RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attributes)) return null;
        String address = attributes.getRequest().getRemoteAddr();
        if (address == null || address.isBlank()) return null;
        return address.length() > 45 ? address.substring(0, 45) : address;
    }
}
