package com.fruitmachine.backend.dispense;

import com.fruitmachine.backend.support.AbstractWebhookIntegrationTest;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import static org.assertj.core.api.Assertions.*;

/** Real PostgreSQL, verified TESTPAY webhook, real HTTP and Python station; fake UART only. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {"spring.config.import=", "app.dispense.sweep-enabled=false"})
class DispenseStationFlowIntegrationTest extends AbstractWebhookIntegrationTest {
    @LocalServerPort int port;

    @Test
    void paidOrderTravelsThroughRealStationHttpAndSerialParserToOneCompletedSale() throws Exception {
        var order = placeOrder();
        pay(order, 201);
        assertThat(paid(referenceOf(order.orderId()), "STATION-" + UUID.randomUUID(), orderTotal(order.orderId()))).isEqualTo(200);
        kioskData("POST", order.order() + "/dispense-command", order.shop().key(), null, 200);
        Path windowsPython = Path.of("../firmware/.venv/Scripts/python.exe").toAbsolutePath();
        String python = Files.isRegularFile(windowsPython) ? windowsPython.toString() : "python3";
        var builder = new ProcessBuilder(python, "../firmware/tools/simulate_paid_dispense.py", "--backend-url", "http://127.0.0.1:" + port,
                "--machine-id", order.shop().machineId().toString(), "--slot-id", order.shop().slotId().toString());
        builder.environment().put("KIOSK_API_KEY", order.shop().key());
        builder.redirectErrorStream(true);
        var process = builder.start();
        boolean exited = process.waitFor(45, TimeUnit.SECONDS);
        if (!exited) process.destroyForcibly();
        assertThat(exited).as("simulated station terminated").isTrue();
        String output = new String(process.getInputStream().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
        assertThat(process.exitValue()).as(output).isZero();
        var result = json.readTree(output);
        assertThat(result.path("usbOpened").asBoolean(true)).isFalse();
        assertThat(result.path("motorCommands")).hasSize(1);
        assertThat(orderStatus(order.orderId())).isEqualTo("COMPLETED");
        assertThat(count("SELECT count(*) FROM inventory_transactions WHERE type='SALE' AND reference_id IN (SELECT id FROM dispense_commands WHERE order_id=?)", order.orderId())).isEqualTo(1);
    }
}
