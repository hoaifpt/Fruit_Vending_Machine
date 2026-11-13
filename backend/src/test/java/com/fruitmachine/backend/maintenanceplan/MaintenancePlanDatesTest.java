package com.fruitmachine.backend.maintenanceplan;

import com.fruitmachine.backend.common.time.BusinessCalendar;
import com.fruitmachine.backend.config.properties.BusinessProperties;
import com.fruitmachine.backend.maintenanceplan.service.MaintenancePlanGenerator;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

/** Issue #70 §8: plan dates are business-zone dates (fixed clocks, no Spring). */
class MaintenancePlanDatesTest {
    static BusinessCalendar calendar(String instant) {
        return new BusinessCalendar(Clock.fixed(Instant.parse(instant), ZoneOffset.UTC), new BusinessProperties("Asia/Ho_Chi_Minh"));
    }

    @Test
    void theDayBoundaryIsTheBusinessZone() {
        LocalDate due = LocalDate.of(2026, 11, 14);
        // 14/11 00:30 in Vietnam is still 13/11 in UTC: the plan due on 14/11 (lead 0) is due in Vietnam.
        var justAfterMidnight = calendar("2026-11-13T17:30:00Z");
        assertThat(MaintenancePlanGenerator.isDue(due, 0, justAfterMidnight.today())).isTrue();
        assertThat(MaintenancePlanGenerator.isDue(due, 0, LocalDate.ofInstant(Instant.parse("2026-11-13T17:30:00Z"), ZoneOffset.UTC))).isFalse();
        // 13/11 23:30 in Vietnam: not yet, unless one lead day.
        var lateEvening = calendar("2026-11-13T16:30:00Z");
        assertThat(MaintenancePlanGenerator.isDue(due, 0, lateEvening.today())).isFalse();
        assertThat(MaintenancePlanGenerator.isDue(due, 1, lateEvening.today())).isTrue();
        // Missed runs: an old occurrence stays due.
        assertThat(MaintenancePlanGenerator.isDue(due.minusDays(21), 0, lateEvening.today())).isTrue();
    }

    @Test
    void theWorkOrderIsDueAtTheLocalDueTime() {
        assertThat(MaintenancePlanGenerator.dueAt(LocalDate.of(2026, 11, 20), LocalTime.of(17, 0), calendar("2026-11-13T00:00:00Z").zone()))
                .isEqualTo(Instant.parse("2026-11-20T10:00:00Z"));
        assertThat(MaintenancePlanGenerator.dueAt(LocalDate.of(2026, 11, 20), LocalTime.of(6, 30), calendar("2026-11-13T00:00:00Z").zone()))
                .isEqualTo(Instant.parse("2026-11-19T23:30:00Z"));
    }
}
