package com.fruitmachine.backend.machine.dto.slot;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonToken;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.deser.std.StdDeserializer;
import com.fruitmachine.backend.machine.enums.SlotStatus;
import java.io.IOException;

/** Prevent Jackson coercion from silently truncating capacity or accepting enum ordinals. */
public final class SlotRequestDeserializers {
    private SlotRequestDeserializers() {}

    public static final class Capacity extends StdDeserializer<Integer> {
        public Capacity() { super(Integer.class); }
        @Override
        public Integer deserialize(JsonParser parser, DeserializationContext context) throws IOException {
            if (!parser.hasToken(JsonToken.VALUE_NUMBER_INT))
                return (Integer) context.handleUnexpectedToken(Integer.class, parser);
            return parser.getIntValue();
        }
    }
    public static final class Status extends StdDeserializer<SlotStatus> {
        public Status() { super(SlotStatus.class); }
        @Override
        public SlotStatus deserialize(JsonParser parser, DeserializationContext context) throws IOException {
            if (!parser.hasToken(JsonToken.VALUE_STRING))
                return (SlotStatus) context.handleUnexpectedToken(SlotStatus.class, parser);
            try {
                return SlotStatus.valueOf(parser.getText());
            } catch (IllegalArgumentException ex) {
                return (SlotStatus) context.handleWeirdStringValue(SlotStatus.class, parser.getText(), "Invalid slot status");
            }
        }
    }
}
