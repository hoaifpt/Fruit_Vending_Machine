package com.fruitmachine.backend.order.service;

import com.fruitmachine.backend.common.time.BusinessCalendar;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.format.DateTimeFormatter;
import org.springframework.stereotype.Component;

/**
 * ORD-yyyyMMdd(business day, app.business-zone)-8 Crockford base32 characters from SecureRandom; never derived from a UUID or
 * sequence. Issue #61: the day is the business day (Asia/Ho_Chi_Minh), not UTC, so orders between 00:00 and 06:59 Vietnam time
 * carry today's date. Codes created before #61 keep their UTC date; the random part keeps every code unique.
 */
@Component
public class OrderCodeGenerator {
    private static final String ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    private static final SecureRandom RANDOM = new SecureRandom();
    private final Clock clock;
    private final DateTimeFormatter day;

    public OrderCodeGenerator(Clock clock, BusinessCalendar calendar) {
        this.clock = clock;
        this.day = DateTimeFormatter.ofPattern("yyyyMMdd").withZone(calendar.zone());
    }

    public String generate() {
        var code = new StringBuilder("ORD-").append(day.format(clock.instant())).append('-');
        for (int i = 0; i < 8; i++) code.append(ALPHABET.charAt(RANDOM.nextInt(ALPHABET.length())));
        return code.toString();
    }
}
