package com.fruitmachine.backend.customerreport.entity;

import com.fruitmachine.backend.common.entity.CreatedEntity;
import jakarta.persistence.*;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** A photo of a report, re-encoded on upload (no EXIF / GPS). Stored in the database (object storage is out of scope). */
@Entity
@Table(name = "customer_report_photos")
@Getter
@Setter
@NoArgsConstructor
public class CustomerReportPhoto extends CreatedEntity {
    @Column(name = "report_id", nullable = false)
    private UUID reportId;

    @Column(name = "content_type", length = 16, nullable = false)
    private String contentType;

    @Column(name = "size_bytes", nullable = false)
    private int sizeBytes;

    @JdbcTypeCode(SqlTypes.VARBINARY)
    @Column(name = "data", nullable = false, columnDefinition = "bytea")
    private byte[] data;
}
