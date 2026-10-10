package com.fruitmachine.backend.product.batch.dto;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonToken;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.deser.std.StdDeserializer;
import java.io.IOException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;

public final class BatchRequestDeserializers {
    private BatchRequestDeserializers() {}
    public static final class Quantity extends StdDeserializer<Integer> {
        public Quantity() { super(Integer.class); }
        @Override public Integer deserialize(JsonParser parser, DeserializationContext context) throws IOException {
            if (!parser.hasToken(JsonToken.VALUE_NUMBER_INT)) return (Integer) context.handleUnexpectedToken(Integer.class, parser);
            return parser.getIntValue();
        }
    }
    public static final class Timestamp extends StdDeserializer<Instant> {
        public Timestamp() { super(Instant.class); }
        @Override public Instant deserialize(JsonParser parser, DeserializationContext context) throws IOException {
            if (!parser.hasToken(JsonToken.VALUE_STRING)) return (Instant) context.handleUnexpectedToken(Instant.class, parser);
            try { return OffsetDateTime.parse(parser.getText()).toInstant(); }
            catch (DateTimeParseException exception) {
                return (Instant) context.handleWeirdStringValue(Instant.class, parser.getText(), "Use an ISO-8601 timestamp with an explicit offset");
            }
        }
    }
}
