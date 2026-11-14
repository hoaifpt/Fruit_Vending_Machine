package com.fruitmachine.backend.report.export;

import com.fruitmachine.backend.report.model.SalesSummary;
import java.util.ArrayList;
import java.util.List;

/** The summary rows shared by the CSV and PDF exports, so both list the same metrics in the same order. */
final class ReportMetrics {
    record Metric(String key, String label, long value, boolean money) {
    }

    private ReportMetrics() {
    }

    static List<Metric> summary(SalesSummary s) {
        List<Metric> rows = new ArrayList<>(List.of(
                new Metric("ordersSold", "Số đơn đã bán", s.ordersSold(), false),
                new Metric("grossSales", "Doanh số gộp", s.grossSales(), true),
                new Metric("discounts", "Giảm giá", s.discounts(), true),
                new Metric("netSales", "Doanh số thuần", s.netSales(), true),
                new Metric("deliveredRefunds", "Hoàn tiền đơn đã giao", s.deliveredRefunds(), true),
                new Metric("netRevenue", "Doanh thu thuần", s.netRevenue(), true),
                new Metric("averageOrderValue", "Giá trị đơn trung bình", s.averageOrderValue(), true),
                new Metric("moneyCollected", "Tiền đã thu", s.moneyCollected(), true),
                new Metric("moneyRefunded", "Tiền đã hoàn", s.moneyRefunded().total(), true)));
        s.moneyRefunded().byReason().forEach((reason, amount) -> rows.add(new Metric("moneyRefunded." + reason, "Đã hoàn - " + reason, amount, true)));
        rows.add(new Metric("pendingRefunds.count", "Chờ hoàn (số khoản)", s.pendingRefunds().count(), false));
        rows.add(new Metric("pendingRefunds.amount", "Chờ hoàn (số tiền)", s.pendingRefunds().amount(), true));
        rows.add(new Metric("failedDispenses", "Lần nhả hàng lỗi", s.failedDispenses(), false));
        return rows;
    }
}
