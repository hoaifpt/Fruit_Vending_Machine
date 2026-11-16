package com.fruitmachine.backend.alert.service;

import com.fruitmachine.backend.alert.enums.AlertSeverity;
import com.fruitmachine.backend.alert.enums.AlertType;
import com.fruitmachine.backend.alert.repository.AlertWriter;
import com.fruitmachine.backend.alert.repository.HealthCheckQueries;
import com.fruitmachine.backend.config.properties.HealthCheckProperties;
import com.fruitmachine.backend.config.properties.MachineHealthProperties;
import com.fruitmachine.backend.config.properties.OrderProperties;
import com.fruitmachine.backend.machine.entity.Machine;
import com.fruitmachine.backend.machine.enums.MachineConnectivity;
import com.fruitmachine.backend.machine.enums.MachineStatus;
import com.fruitmachine.backend.machine.repository.MachineRepository;
import com.fruitmachine.backend.machine.service.ConnectivityEvaluator;
import com.fruitmachine.backend.mqtt.contract.MachineErrorCode;
import java.time.Instant;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * State-based alerts of one machine (issue #58 §2, §4), in a transaction of its own: raised while the condition holds, resolved by the
 * system when it is gone. A problem that staff resolved by hand while it still holds is raised again as a new alert at the next check
 * (intended: the condition is real).
 */
@Service
@RequiredArgsConstructor
@EnableConfigurationProperties(HealthCheckProperties.class)
public class MachineHealthCheckService {
    private final MachineRepository machines;
    private final HealthCheckQueries queries;
    private final AlertService alerts;
    private final AlertWriter writer;
    private final ConnectivityEvaluator connectivity;
    private final HealthCheckProperties properties;
    private final MachineHealthProperties health;
    private final OrderProperties orders;

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void checkMachine(UUID machineId, Instant now) {
        Machine machine = machines.findById(machineId).orElse(null);
        if (machine == null || machine.getStatus() == MachineStatus.INACTIVE) return;
        offline(machine, now);
        environment(machine, now);
        slots(machine, now);
    }

    private void offline(Machine machine, Instant now) {
        String key = AlertSpec.machineKey(AlertType.MACHINE_OFFLINE, machine.getId());
        if (connectivity.evaluate(machine.getLastSeenAt(), machine.getLastOfflineAt(), now) == MachineConnectivity.OFFLINE) {
            alerts.raise(new AlertSpec(AlertType.MACHINE_OFFLINE, AlertSeverity.WARNING, machine.getId(), null, null, key,
                    AlertTemplates.title(AlertType.MACHINE_OFFLINE, null), AlertTemplates.offline(machine.getCode())), now);
        } else {
            alerts.autoResolve(key, now);
        }
    }

    /**
     * Breach = the latest reading is out of range and every reading since the last in-range one is too, the first of them at least
     * environment-grace old. No reading within offline-after (or no sensor at all): nothing is evaluated, MACHINE_OFFLINE covers it.
     * An open TEMP_SENSOR_ERROR fault skips the temperature evaluation.
     */
    private void environment(Machine machine, Instant now) {
        var env = queries.environment(machine.getId(), machine.getTemperatureMin(), machine.getTemperatureMax(), machine.getHumidityMax());
        Instant fresh = now.minus(health.offlineAfter()), breachedBy = now.minus(properties.environmentGrace());
        boolean sensorFault = writer.isUnresolved(AlertSpec.hardwareKey(machine.getId(), MachineErrorCode.Fault.TEMP_SENSOR_ERROR.name()));
        if (env.temperatureAt() != null && !env.temperatureAt().isBefore(fresh) && !sensorFault) {
            temperature(machine, AlertType.HIGH_TEMPERATURE, env.highSince(), breachedBy, env, now);
            temperature(machine, AlertType.LOW_TEMPERATURE, env.lowSince(), breachedBy, env, now);
        }
        if (env.humidityAt() != null && !env.humidityAt().isBefore(fresh)) {
            String key = AlertSpec.machineKey(AlertType.HIGH_HUMIDITY, machine.getId());
            if (env.humidHighSince() == null) alerts.autoResolve(key, now);
            else if (!env.humidHighSince().isAfter(breachedBy)) {
                alerts.raise(new AlertSpec(AlertType.HIGH_HUMIDITY, AlertSeverity.WARNING, machine.getId(), null, null, key,
                        AlertTemplates.title(AlertType.HIGH_HUMIDITY, null), AlertTemplates.humidity(machine.getCode(), env.humidity(), machine.getHumidityMax())), now);
            }
        }
    }

    /** A temperature breach is CRITICAL and stops sales (BM04 F-06); back in range resolves the alert, the machine stays MAINTENANCE. */
    private void temperature(Machine machine, AlertType type, Instant since, Instant breachedBy, HealthCheckQueries.Environment env, Instant now) {
        String key = AlertSpec.machineKey(type, machine.getId());
        if (since == null) {
            alerts.autoResolve(key, now);
        } else if (!since.isAfter(breachedBy)) {
            alerts.raiseProtecting(new AlertSpec(type, AlertSeverity.CRITICAL, machine.getId(), null, null, key, AlertTemplates.title(type, null),
                    AlertTemplates.temperature(machine.getCode(), env.temperature(), machine.getTemperatureMin(), machine.getTemperatureMax())), true, now);
        }
    }

    private void slots(Machine machine, Instant now) {
        var conditions = queries.slots(machine.getId(), now, now.plus(orders.reservationTtl()), now.plus(properties.expiringWithin()));
        for (var slot : conditions) {
            String low = AlertSpec.slotKey(AlertType.LOW_STOCK, slot.slotId());
            if ("ACTIVE".equals(slot.slotStatus()) && slot.sellable() <= properties.lowStockThreshold()) {
                alerts.raise(new AlertSpec(AlertType.LOW_STOCK, AlertSeverity.WARNING, machine.getId(), slot.slotId(), null, low,
                        AlertTemplates.title(AlertType.LOW_STOCK, null), AlertTemplates.lowStock(machine.getCode(), slot.slotCode(), slot.sellable())), now);
            } else {
                alerts.autoResolve(low, now);
            }
            String expiring = AlertSpec.slotKey(AlertType.PRODUCT_EXPIRING, slot.slotId());
            if (slot.expiring() > 0) {
                alerts.raise(new AlertSpec(AlertType.PRODUCT_EXPIRING, AlertSeverity.INFO, machine.getId(), slot.slotId(), null, expiring,
                        AlertTemplates.title(AlertType.PRODUCT_EXPIRING, null), AlertTemplates.expiring(machine.getCode(), slot.slotCode(), slot.expiring())), now);
            } else {
                alerts.autoResolve(expiring, now);
            }
            String expired = AlertSpec.slotKey(AlertType.PRODUCT_EXPIRED, slot.slotId());
            if (slot.expired() > 0) {
                alerts.raise(new AlertSpec(AlertType.PRODUCT_EXPIRED, AlertSeverity.WARNING, machine.getId(), slot.slotId(), null, expired,
                        AlertTemplates.title(AlertType.PRODUCT_EXPIRED, null), AlertTemplates.expired(machine.getCode(), slot.slotCode(), slot.expired())), now);
            } else {
                alerts.autoResolve(expired, now);
            }
        }
    }
}
