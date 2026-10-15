package com.fruitmachine.backend.order.service;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/** ORD-yyyyMMdd(UTC)-8 Crockford base32 characters from SecureRandom; never derived from a UUID or sequence. */
@Component
@RequiredArgsConstructor
public class OrderCodeGenerator {
    private static final String ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("yyyyMMdd").withZone(ZoneOffset.UTC);
    private static final SecureRandom RANDOM = new SecureRandom();
    private final Clock clock;

    public String generate() {
        var code = new StringBuilder("ORD-").append(DAY.format(clock.instant())).append('-');
        for (int i = 0; i < 8; i++) code.append(ALPHABET.charAt(RANDOM.nextInt(ALPHABET.length())));
        return code.toString();
    }
}
