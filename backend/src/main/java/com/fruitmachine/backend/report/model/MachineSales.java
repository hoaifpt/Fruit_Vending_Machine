package com.fruitmachine.backend.report.model;

import java.util.UUID;

public record MachineSales(UUID machineId, String code, String name, long ordersSold, long netSales, long deliveredRefunds, long netRevenue) {
}
