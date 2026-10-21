package com.fruitvending.backend.api;

import com.fruitvending.backend.mqtt.MqttCommandPublisher;
import org.eclipse.paho.client.mqttv3.MqttException;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.Locale;
import java.util.regex.Pattern;

@RestController
@RequestMapping("/api/machines")
public class MachineCommandController {

    private static final Pattern MACHINE_ID_PATTERN = Pattern.compile("[A-Za-z0-9_-]{1,64}");
    private final MqttCommandPublisher publisher;

    public MachineCommandController(MqttCommandPublisher publisher) {
        this.publisher = publisher;
    }

    @PostMapping("/{machineId}/commands/{command}")
    public CommandResponse sendCommand(
            @PathVariable String machineId,
            @PathVariable String command) {
        if (!MACHINE_ID_PATTERN.matcher(machineId).matches()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid machine ID");
        }

        String normalizedCommand = command.toUpperCase(Locale.ROOT);
        if (!normalizedCommand.equals("NEXT") && !normalizedCommand.equals("STOP")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Command must be NEXT or STOP");
        }

        try {
            publisher.publishCommand(machineId, normalizedCommand);
        } catch (MqttException | IllegalStateException exception) {
            throw new ResponseStatusException(
                    HttpStatus.SERVICE_UNAVAILABLE,
                    "Could not publish command to MQTT",
                    exception);
        }

        String topic = "fruit-vending/" + machineId + "/command";
        return new CommandResponse(machineId, normalizedCommand, topic, true);
    }

    public record CommandResponse(
            String machineId,
            String command,
            String topic,
            boolean published) {
    }
}
