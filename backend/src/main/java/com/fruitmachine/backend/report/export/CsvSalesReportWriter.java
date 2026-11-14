package com.fruitmachine.backend.report.export;

import com.fruitmachine.backend.report.model.*;
import java.io.IOException;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

/**
 * CSV rendering of a SalesReport (issue #76): UTF-8 with BOM, comma separator, RFC 4180 quoting, sections [Filters] [Summary] [Daily]
 * [Products] [Peak hours] [Machines] separated by a blank line, each with a header row. Amounts are plain integers, dates ISO. Text cells
 * starting with = + - @ tab or CR are prefixed with ' so spreadsheets never evaluate them as formulas (numbers are written as numbers).
 */
@Component
public class CsvSalesReportWriter {
    private static final String CRLF = "\r\n";

    public void write(SalesReport report, OutputStream output) throws IOException {
        Writer out = new OutputStreamWriter(output, StandardCharsets.UTF_8);
        out.write('﻿');
        SalesSummary s = report.summary();
        FiltersEcho f = s.filters();
        ZoneId zone = ZoneId.of(f.zone());

        section(out, "Filters", "key", "value");
        row(out, text("from"), text(f.from().toString()));
        row(out, text("to"), text(f.to().toString()));
        row(out, text("machineIds"), text(ids(f.machineIds())));
        row(out, text("productIds"), text(ids(f.productIds())));
        row(out, text("zone"), text(f.zone()));
        row(out, text("generatedAt"), text(DateTimeFormatter.ISO_OFFSET_DATE_TIME.format(report.generatedAt().atZone(zone))));
        row(out, text("generatedBy"), text(report.generatedBy()));
        out.write(CRLF);

        section(out, "Summary", "metric", "value");
        for (var metric : ReportMetrics.summary(s)) row(out, text(metric.key()), number(metric.value()));
        out.write(CRLF);

        section(out, "Daily", "date", "ordersSold", "grossSales", "discounts", "netSales", "deliveredRefunds", "netRevenue");
        for (SalesBucket b : report.daily()) {
            row(out, text(b.start().toString()), number(b.ordersSold()), number(b.grossSales()), number(b.discounts()), number(b.netSales()),
                    number(b.deliveredRefunds()), number(b.netRevenue()));
        }
        out.write(CRLF);

        section(out, "Products", "productId", "sku", "name", "status", "quantity", "grossSales", "discounts", "netSales", "deliveredRefunds", "sharePercent");
        for (ProductSales p : report.products()) {
            row(out, text(p.productId().toString()), text(p.sku()), text(p.name()), text(p.status()), number(p.quantity()), number(p.grossSales()),
                    number(p.discounts()), number(p.netSales()), number(p.deliveredRefunds()), p.sharePercent().toPlainString());
        }
        out.write(CRLF);

        section(out, "Peak hours", "hour", "ordersSold", "netSales");
        for (PeakHours.PeakHour h : report.peakHours().hours()) row(out, number(h.hour()), number(h.ordersSold()), number(h.netSales()));
        out.write(CRLF);

        section(out, "Machines", "machineId", "code", "name", "ordersSold", "netSales", "deliveredRefunds", "netRevenue");
        for (MachineSales m : report.machines()) {
            row(out, text(m.machineId().toString()), text(m.code()), text(m.name()), number(m.ordersSold()), number(m.netSales()),
                    number(m.deliveredRefunds()), number(m.netRevenue()));
        }
        out.flush();
    }

    private static void section(Writer out, String name, String... headers) throws IOException {
        out.write(text("[" + name + "]") + CRLF);
        String[] cells = new String[headers.length];
        for (int i = 0; i < headers.length; i++) cells[i] = text(headers[i]);
        row(out, cells);
    }

    private static void row(Writer out, String... cells) throws IOException {
        out.write(String.join(",", cells));
        out.write(CRLF);
    }

    private static String number(long value) {
        return Long.toString(value);
    }

    /** RFC 4180 quoting plus the formula-injection guard. */
    static String text(String value) {
        if (value == null) return "";
        String cell = value;
        if (!cell.isEmpty() && "=+-@\t\r".indexOf(cell.charAt(0)) >= 0) cell = "'" + cell;
        if (cell.contains(",") || cell.contains("\"") || cell.contains("\n") || cell.contains("\r")) cell = "\"" + cell.replace("\"", "\"\"") + "\"";
        return cell;
    }

    private static String ids(List<UUID> ids) {
        return ids.stream().map(UUID::toString).collect(Collectors.joining(" "));
    }
}
