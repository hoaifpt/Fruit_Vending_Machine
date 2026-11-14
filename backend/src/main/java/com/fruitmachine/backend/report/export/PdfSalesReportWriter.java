package com.fruitmachine.backend.report.export;

import com.fruitmachine.backend.report.model.*;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.UncheckedIOException;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDType0Font;
import org.springframework.stereotype.Component;

/**
 * PDF rendering of a SalesReport (issue #76) with Apache PDFBox: A4, the embedded Noto Sans font (resources/fonts, SIL OFL) so
 * Vietnamese renders, amounts as 1.234.567 ₫. Same figures as the CSV: both render the one SalesReport object.
 */
@Component
public class PdfSalesReportWriter {
    private static final float MARGIN = 40, SIZE = 9, LEADING = 13, TITLE = 15;
    private static final PDRectangle PAGE = PDRectangle.A4;
    private static final DateTimeFormatter WHEN = DateTimeFormatter.ofPattern("dd/MM/yyyy HH:mm");
    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("dd/MM/yyyy");

    public void write(SalesReport report, OutputStream output) throws IOException {
        try (PDDocument document = new PDDocument()) {
            var canvas = new Canvas(document, load(document, "/fonts/NotoSans-Regular.ttf"), load(document, "/fonts/NotoSans-Bold.ttf"));
            SalesSummary s = report.summary();
            FiltersEcho f = s.filters();
            ZoneId zone = ZoneId.of(f.zone());

            canvas.line("Báo cáo bán hàng FreshVend", true, TITLE);
            canvas.line("Khoảng thời gian: " + DAY.format(f.from()) + " - " + DAY.format(f.to()) + " (" + f.zone() + ")", false, SIZE);
            canvas.line("Máy: " + (f.machineIds().isEmpty() ? "tất cả" : String.join(", ", f.machineIds().stream().map(Object::toString).toList())), false, SIZE);
            canvas.line("Sản phẩm: " + (f.productIds().isEmpty() ? "tất cả" : String.join(", ", f.productIds().stream().map(Object::toString).toList())), false, SIZE);
            canvas.line("Tạo lúc: " + WHEN.format(report.generatedAt().atZone(zone)) + " bởi " + (report.generatedBy() == null ? "" : report.generatedBy()), false, SIZE);
            canvas.gap();

            canvas.heading("Tổng quan");
            List<String[]> summary = new ArrayList<>();
            for (var metric : ReportMetrics.summary(s)) {
                summary.add(new String[]{metric.label() + " (" + metric.key() + ")", metric.money() ? money(metric.value()) : count(metric.value())});
            }
            canvas.table(new String[]{"Chỉ số", "Giá trị"}, new float[]{360, 155}, summary);

            canvas.heading("Theo ngày");
            List<String[]> daily = new ArrayList<>();
            for (SalesBucket b : report.daily()) {
                daily.add(new String[]{b.start().toString(), count(b.ordersSold()), money(b.grossSales()), money(b.discounts()), money(b.netSales()),
                        money(b.deliveredRefunds()), money(b.netRevenue())});
            }
            canvas.table(new String[]{"Ngày", "Đơn", "Doanh số gộp", "Giảm giá", "Doanh số thuần", "Hoàn tiền", "Doanh thu thuần"},
                    new float[]{65, 35, 85, 70, 85, 70, 105}, daily);

            canvas.heading("Sản phẩm");
            List<String[]> products = new ArrayList<>();
            for (ProductSales p : report.products()) {
                products.add(new String[]{p.name(), count(p.quantity()), money(p.grossSales()), money(p.discounts()), money(p.netSales()),
                        money(p.deliveredRefunds()), p.sharePercent().toPlainString() + "%"});
            }
            canvas.table(new String[]{"Sản phẩm", "SL", "Doanh số gộp", "Giảm giá", "Doanh số thuần", "Hoàn tiền", "Tỷ trọng"},
                    new float[]{120, 30, 80, 65, 85, 70, 65}, products);

            canvas.heading("Giờ cao điểm");
            List<String[]> hours = new ArrayList<>();
            for (PeakHours.PeakHour h : report.peakHours().hours()) {
                hours.add(new String[]{String.format("%02d:00-%02d:00", h.hour(), (h.hour() + 1) % 24), count(h.ordersSold()), money(h.netSales())});
            }
            canvas.table(new String[]{"Giờ", "Đơn", "Doanh số thuần"}, new float[]{120, 80, 140}, hours);

            canvas.heading("Máy");
            List<String[]> machines = new ArrayList<>();
            for (MachineSales m : report.machines()) {
                machines.add(new String[]{m.code() + " - " + m.name(), count(m.ordersSold()), money(m.netSales()), money(m.deliveredRefunds()),
                        money(m.netRevenue())});
            }
            canvas.table(new String[]{"Máy", "Đơn", "Doanh số thuần", "Hoàn tiền", "Doanh thu thuần"}, new float[]{170, 45, 100, 90, 110}, machines);

            canvas.close();
            document.save(output);
        }
    }

    /** vi-VN amount: 1.234.567 ₫ (negative: -1.234 ₫). */
    static String money(long value) {
        return grouped(value) + " ₫";
    }

    static String count(long value) {
        return grouped(value);
    }

    private static String grouped(long value) {
        return String.format(java.util.Locale.ROOT, "%,d", value).replace(',', '.');
    }

    private static PDType0Font load(PDDocument document, String resource) throws IOException {
        try (InputStream font = PdfSalesReportWriter.class.getResourceAsStream(resource)) {
            if (font == null) throw new IOException("Missing font " + resource);
            return PDType0Font.load(document, font);
        }
    }

    /** A minimal flowing layout: lines and simple tables with page breaks (numbers right-aligned). */
    private static final class Canvas {
        private final PDDocument document;
        private final PDType0Font regular, bold;
        private PDPageContentStream stream;
        private float y;

        Canvas(PDDocument document, PDType0Font regular, PDType0Font bold) throws IOException {
            this.document = document;
            this.regular = regular;
            this.bold = bold;
            newPage();
        }

        void line(String text, boolean strong, float size) throws IOException {
            ensure(size + 6);
            write(text, MARGIN, strong ? bold : regular, size);
            y -= size + 6;
        }

        void heading(String text) throws IOException {
            gap();
            ensure(LEADING * 3);
            line(text, true, 11);
        }

        void gap() {
            y -= LEADING / 2;
        }

        void table(String[] headers, float[] widths, List<String[]> rows) throws IOException {
            row(headers, widths, true);
            for (String[] row : rows) row(row, widths, false);
        }

        private void row(String[] cells, float[] widths, boolean header) throws IOException {
            ensure(LEADING);
            float x = MARGIN;
            for (int i = 0; i < cells.length; i++) {
                String cell = fit(cells[i] == null ? "" : cells[i], widths[i] - 4, header ? bold : regular);
                boolean right = i > 0;
                float textWidth = width(cell, header ? bold : regular);
                write(cell, right ? x + widths[i] - 4 - textWidth : x, header ? bold : regular, SIZE);
                x += widths[i];
            }
            y -= LEADING;
        }

        private String fit(String raw, float max, PDType0Font font) throws IOException {
            String text = safe(raw, font);
            if (width(text, font) <= max) return text;
            String cut = text;
            while (!cut.isEmpty() && width(cut + "…", font) > max) cut = cut.substring(0, cut.length() - 1);
            return cut + "…";
        }

        private float width(String text, PDType0Font font) throws IOException {
            return font.getStringWidth(text) / 1000 * SIZE;
        }

        /** Characters the embedded font cannot encode (e.g. emoji) become '?' instead of failing the export. */
        private static String safe(String text, PDType0Font font) {
            var out = new StringBuilder();
            text.codePoints().forEach(cp -> {
                String ch = new String(Character.toChars(cp));
                try {
                    font.encode(ch);
                    out.append(ch);
                } catch (IOException | IllegalArgumentException ex) {
                    out.append('?');
                }
            });
            return out.toString();
        }

        private void write(String text, float x, PDType0Font font, float size) throws IOException {
            stream.beginText();
            stream.setFont(font, size);
            stream.newLineAtOffset(x, y - size);
            stream.showText(safe(text, font));
            stream.endText();
        }

        private void ensure(float height) throws IOException {
            if (y - height < MARGIN) newPage();
        }

        private void newPage() throws IOException {
            if (stream != null) stream.close();
            PDPage page = new PDPage(PAGE);
            document.addPage(page);
            stream = new PDPageContentStream(document, page);
            y = PAGE.getHeight() - MARGIN;
        }

        void close() {
            try {
                stream.close();
            } catch (IOException ex) {
                throw new UncheckedIOException(ex);
            }
        }
    }
}
