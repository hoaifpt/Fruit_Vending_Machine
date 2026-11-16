package com.fruitmachine.backend.customerreport.dto;

import com.fruitmachine.backend.customerreport.enums.ReportType;
import java.util.List;

/** What the public form needs: the machine and the limits. */
public record ReportFormResponse(String machineName, String machineCode, List<ReportType> types, int maxPhotos, int maxPhotoBytes) {
}
