package com.fruitmachine.backend.workorder.service;

import com.fruitmachine.backend.common.time.BusinessCalendar;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.format.DateTimeFormatter;
import org.springframework.stereotype.Component;

/** WO-yyyyMMdd(business day)-4 Crockford base32 characters from SecureRandom; the caller retries on a duplicate. */
@Component
public class WorkOrderCodeGenerator {
    private static final String ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    private static final SecureRandom RANDOM = new SecureRandom();
    private final Clock clock;
    private final DateTimeFormatter day;

    public WorkOrderCodeGenerator(Clock clock, BusinessCalendar calendar) {
        this.clock = clock;
        this.day = DateTimeFormatter.ofPattern("yyyyMMdd").withZone(calendar.zone());
    }

    public String generate() {
        var code = new StringBuilder("WO-").append(day.format(clock.instant())).append('-');
        for (int i = 0; i < 4; i++) code.append(ALPHABET.charAt(RANDOM.nextInt(ALPHABET.length())));
        return code.toString();
    }
}
