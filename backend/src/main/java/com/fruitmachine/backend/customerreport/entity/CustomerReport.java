package com.fruitmachine.backend.customerreport.entity;

import com.fruitmachine.backend.common.entity.BaseEntity;
import com.fruitmachine.backend.customerreport.enums.ReportResolution;
import com.fruitmachine.backend.customerreport.enums.ReportStatus;
import com.fruitmachine.backend.customerreport.enums.ReportType;
import com.fruitmachine.backend.customerreport.enums.ReportVerdict;
import com.fruitmachine.backend.machine.entity.Machine;
import com.fruitmachine.backend.user.entity.User;
import com.fruitmachine.backend.workorder.entity.WorkOrder;
import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * A customer incident report (issue #74). Contact data (name, phone, email) is personal data: never copied into work orders,
 * notifications or logs, masked in lists and shown in full only to CUSTOMER_REPORT_MANAGE holders.
 */
@Entity
@Table(name = "customer_reports")
@Getter
@Setter
@NoArgsConstructor
public class CustomerReport extends BaseEntity {
    @Column(name = "code", length = 32, nullable = false, unique = true)
    private String code;

    @Column(name = "machine_id", nullable = false)
    private UUID machineId;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "machine_id", insertable = false, updatable = false)
    @Setter(AccessLevel.NONE)
    private Machine machine;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "type", length = 24, nullable = false)
    private ReportType type;

    @Column(name = "description", length = 1000)
    private String description;

    @Column(name = "order_code_input", length = 64)
    private String orderCodeInput;

    @Column(name = "order_id")
    private UUID orderId;

    @Column(name = "batch_id")
    private UUID batchId;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "verdict", length = 32, nullable = false)
    private ReportVerdict verdict;

    @Column(name = "contact_name", length = 100)
    private String contactName;

    @Column(name = "contact_phone", length = 20)
    private String contactPhone;

    @Column(name = "contact_email", length = 254)
    private String contactEmail;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "status", length = 16, nullable = false)
    private ReportStatus status = ReportStatus.NEW;

    @Column(name = "work_order_id")
    private UUID workOrderId;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "work_order_id", insertable = false, updatable = false)
    @Setter(AccessLevel.NONE)
    private WorkOrder workOrder;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "resolution", length = 24)
    private ReportResolution resolution;

    @Column(name = "resolution_note", length = 1000)
    private String resolutionNote;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "resolved_by")
    private User resolvedBy;

    @Column(name = "resolved_at", columnDefinition = "timestamptz")
    private Instant resolvedAt;

    /** HMAC-SHA256 (hex) of the client IP under a server secret; the raw IP is never stored. */
    @Column(name = "source_ip_hash", length = 64, nullable = false)
    private String sourceIpHash;
}
