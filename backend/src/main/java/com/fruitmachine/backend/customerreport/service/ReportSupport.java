package com.fruitmachine.backend.customerreport.service;

import com.fruitmachine.backend.common.time.BusinessCalendar;
import com.fruitmachine.backend.customerreport.config.PublicReportProperties;
import com.fruitmachine.backend.customerreport.dto.ReportContactResponse;
import com.fruitmachine.backend.customerreport.entity.CustomerReport;
import com.fruitmachine.backend.customerreport.repository.CustomerReportRepository;
import com.fruitmachine.backend.payment.gateway.HmacSha256;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.format.DateTimeFormatter;
import java.util.Base64;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/** Report codes, client IP hashing and contact masking (issue #74). */
@Slf4j
@Component
public class ReportSupport {
    private static final String ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final int MAX_CODE_ATTEMPTS = 10;
    private final CustomerReportRepository reports;
    private final Clock clock;
    private final DateTimeFormatter day;
    private final String ipHashSecret;

    public ReportSupport(CustomerReportRepository reports, Clock clock, BusinessCalendar calendar, PublicReportProperties properties) {
        this.reports = reports;
        this.clock = clock;
        this.day = DateTimeFormatter.ofPattern("yyyyMMdd").withZone(calendar.zone());
        if (properties.ipHashSecret().isBlank()) {
            byte[] random = new byte[32];
            RANDOM.nextBytes(random);
            this.ipHashSecret = Base64.getEncoder().encodeToString(random);
            log.warn("REPORT_IP_HASH_SECRET is not set: customer report IP hashes use a per-start random secret and cannot be compared across restarts");
        } else {
            this.ipHashSecret = properties.ipHashSecret();
        }
    }

    /** RPT-yyyyMMdd(business day)-4 Crockford base32 characters, unique. */
    public String newCode() {
        for (int attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
            String code = randomCode();
            if (!reports.existsByCode(code)) return code;
        }
        throw new IllegalStateException("Could not generate a unique report code");
    }

    /** A code of the same shape that is never stored (honeypot submissions). */
    public String randomCode() {
        var code = new StringBuilder("RPT-").append(day.format(clock.instant())).append('-');
        for (int i = 0; i < 4; i++) code.append(ALPHABET.charAt(RANDOM.nextInt(ALPHABET.length())));
        return code.toString();
    }

    public String hashIp(String ip) {
        return HmacSha256.hex(ipHashSecret, ip == null ? "" : ip);
    }

    /** 22-character base64url token (128 random bits) for a rotated report QR. */
    public static String newReportToken() {
        byte[] random = new byte[16];
        RANDOM.nextBytes(random);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(random);
    }

    public static ReportContactResponse contact(CustomerReport report, boolean full) {
        if (report.getContactName() == null && report.getContactPhone() == null && report.getContactEmail() == null) return null;
        if (full) return new ReportContactResponse(report.getContactName(), report.getContactPhone(), report.getContactEmail(), false);
        return new ReportContactResponse(maskName(report.getContactName()), maskPhone(report.getContactPhone()), maskEmail(report.getContactEmail()), true);
    }

    /** 0901234567 -> 090****567. */
    public static String maskPhone(String phone) {
        if (phone == null) return null;
        if (phone.length() <= 6) return "*".repeat(phone.length());
        return phone.substring(0, 3) + "*".repeat(phone.length() - 6) + phone.substring(phone.length() - 3);
    }

    /** an.nguyen@example.com -> a***@example.com. */
    public static String maskEmail(String email) {
        if (email == null) return null;
        int at = email.indexOf('@');
        if (at <= 0) return "***";
        return email.charAt(0) + "***" + email.substring(at);
    }

    private static String maskName(String name) {
        if (name == null || name.isEmpty()) return name;
        return name.charAt(0) + "***";
    }
}
