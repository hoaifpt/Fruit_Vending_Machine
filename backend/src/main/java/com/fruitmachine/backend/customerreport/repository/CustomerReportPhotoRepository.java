package com.fruitmachine.backend.customerreport.repository;

import com.fruitmachine.backend.customerreport.entity.CustomerReportPhoto;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface CustomerReportPhotoRepository extends JpaRepository<CustomerReportPhoto, UUID> {
    interface PhotoInfo {
        UUID getId();

        String getContentType();

        int getSizeBytes();
    }

    /** Metadata only: the image bytes are loaded by the photo endpoint alone. */
    @Query("select p.id as id, p.contentType as contentType, p.sizeBytes as sizeBytes from CustomerReportPhoto p"
            + " where p.reportId = :reportId order by p.createdAt, p.id")
    List<PhotoInfo> findInfoByReportId(@Param("reportId") UUID reportId);

    Optional<CustomerReportPhoto> findByIdAndReportId(UUID id, UUID reportId);
}
