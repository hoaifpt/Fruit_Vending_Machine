package com.fruitmachine.backend.customerreport.dto;

import io.swagger.v3.oas.annotations.media.Schema;

/** The same shape for every accepted submission: it never reveals whether the order exists or its state. */
public record ReportSubmittedResponse(@Schema(example = "RPT-20261114-7KQ2") String reportCode, String message) {
}
