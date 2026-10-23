package com.fruitmachine.backend.dispense;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;
import com.fruitmachine.backend.dispense.service.DispenseService;
import com.fruitmachine.backend.support.AbstractWebhookIntegrationTest;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@TestPropertySource(properties = {"springdoc.api-docs.enabled=true", "springdoc.swagger-ui.enabled=true", "app.dispense.sweep-enabled=false"})
class DispenseIntegrationTest extends AbstractWebhookIntegrationTest {
    @Autowired DispenseService dispense;

    String preparePath(PlacedOrder order) { return order.order() + "/dispense-command"; }
    String commandPath(JsonNode command) { return "/api/v1/kiosk/dispense-commands/" + command.path("id").asText(); }
    JsonNode paidCommand(PlacedOrder order) throws Exception {
        pay(order, 201);
        assertThat(paid(referenceOf(order.orderId()), "TX-" + UUID.randomUUID(), orderTotal(order.orderId()))).isEqualTo(200);
        return kioskData("POST", preparePath(order), order.shop().key(), null, 200);
    }
    JsonNode claim(PlacedOrder order, JsonNode command) throws Exception {
        return kioskData("POST", commandPath(command) + "/claim", order.shop().key(), null, 200);
    }
    Map<String, Object> result(JsonNode claim, String status) {
        return Map.of("dispatchToken", claim.path("dispatchToken").asText(), "status", status,
                "bowlCountBefore", 7, "bowlCountAfter", 8);
    }

    @Test
    void verifiedPaymentToCompletionIsAtomicAndDuplicateSuccessNeverSellsTwice() throws Exception {
        var order = placeOrder();
        var command = paidCommand(order);
        assertThat(kioskData("POST", preparePath(order), order.shop().key(), null, 200)).isEqualTo(command);
        assertThat(kioskData("GET", preparePath(order), order.shop().key(), null, 200).has("dispatchToken")).isFalse();
        var claim = claim(order, command);
        assertThat(orderStatus(order.orderId())).isEqualTo("DISPENSING");
        String results = commandPath(command) + "/results";
        kioskData("POST", results, order.shop().key(), Map.of("dispatchToken", claim.path("dispatchToken").asText(), "status", "ACKNOWLEDGED"), 200);
        kioskData("POST", results, order.shop().key(), result(claim, "SUCCESS"), 200);
        kioskData("POST", results, order.shop().key(), result(claim, "SUCCESS"), 200);
        assertThat(orderStatus(order.orderId())).isEqualTo("COMPLETED");
        assertThat(count("SELECT count(*) FROM inventory_items WHERE id=?::uuid AND status='SOLD'", command.path("inventoryItemId").asText())).isEqualTo(1);
        assertThat(count("SELECT count(*) FROM order_item_allocations WHERE inventory_item_id=?::uuid AND status='DISPENSED'", command.path("inventoryItemId").asText())).isEqualTo(1);
        assertThat(count("SELECT count(*) FROM inventory_transactions WHERE reference_id=?::uuid AND type='SALE'", command.path("id").asText())).isEqualTo(1);
        kioskData("POST", results, order.shop().key(), Map.of("dispatchToken", claim.path("dispatchToken").asText(), "status", "SUCCESS", "bowlCountBefore", 8, "bowlCountAfter", 9), 409);
        kioskData("POST", commandPath(command) + "/claim", order.shop().key(), null, 409);
    }

    @Test
    void paymentAndMachineOwnershipCannotBeBypassed() throws Exception {
        var order = placeOrder();
        kioskData("POST", preparePath(order), order.shop().key(), null, 409);
        mvc.perform(post(preparePath(order)).header("Authorization", "Bearer " + admin.token())).andExpect(status().isForbidden());
        var command = paidCommand(order);
        var other = shop(1);
        kioskData("GET", preparePath(order), other.key(), null, 404);
        kioskData("POST", commandPath(command) + "/claim", other.key(), null, 404);
        assertThat(kioskData("GET", "/api/v1/kiosk/dispense-commands", other.key(), null, 200)).isEmpty();
        kioskJson("POST", commandPath(command) + "/claim", null, null, 401);
    }

    @Test
    void claimIsExclusiveAndUncorrelatedOrUnprovenResultsAreRejected() throws Exception {
        var order = placeOrder();
        var command = paidCommand(order);
        var claims = parallel(List.of(
                () -> kioskCall("POST", commandPath(command) + "/claim", order.shop().key(), null).getResponse().getStatus(),
                () -> kioskCall("POST", commandPath(command) + "/claim", order.shop().key(), null).getResponse().getStatus()));
        assertThat(claims).containsExactlyInAnyOrder(200, 409);
        String token = jdbc.queryForObject("SELECT dispatch_token::text FROM dispense_commands WHERE id=?::uuid", String.class, command.path("id").asText());
        String results = commandPath(command) + "/results";
        kioskData("POST", results, order.shop().key(), Map.of("dispatchToken", UUID.randomUUID(), "status", "SUCCESS", "bowlCountBefore", 1, "bowlCountAfter", 2), 409);
        kioskData("POST", results, order.shop().key(), Map.of("dispatchToken", token, "status", "SUCCESS"), 409);
        kioskJson("POST", results, order.shop().key(), Map.of("status", "SUCCESS"), 400);
        kioskJson("POST", results, order.shop().key(), Map.of("dispatchToken", token, "status", "PAID"), 400);
    }

    @Test
    void concurrentPreparationProducesOneCommandAndSharedIrPermitsOnlyOneInFlight() throws Exception {
        var shop = shopWithSlots(2);
        var first = placeOrder(shop);
        pay(first, 201);
        paid(referenceOf(first.orderId()), "TX-" + UUID.randomUUID(), orderTotal(first.orderId()));
        var prepared = parallel(List.of(
                () -> kioskData("POST", preparePath(first), shop.key(), null, 200).path("id").asText(),
                () -> kioskData("POST", preparePath(first), shop.key(), null, 200).path("id").asText()));
        assertThat(prepared.getFirst()).isEqualTo(prepared.getLast());
        var a = kioskData("GET", preparePath(first), shop.key(), null, 200);
        var second = placeOrder(shop);
        var b = paidCommand(second);
        var firstClaim = claim(first, a);
        kioskData("POST", commandPath(b) + "/claim", shop.key(), null, 409);
        kioskData("POST", commandPath(a) + "/results", shop.key(), result(firstClaim, "SUCCESS"), 200);
        claim(second, b);
    }

    @Test
    void timeoutQuarantinesStockAndNeverReissuesMotionOrAcceptsLateSuccess() throws Exception {
        var order = placeOrder();
        var command = paidCommand(order);
        var claim = claim(order, command);
        // Scheduler runs without a user principal; no external command or automatic refund.
        dispense.expire(UUID.fromString(command.path("id").asText()), Instant.now().plusSeconds(300));
        assertThat(orderStatus(order.orderId())).isEqualTo("DISPENSE_FAILED");
        assertThat(jdbc.queryForObject("SELECT status FROM machines WHERE id=?", String.class, order.shop().machineId())).isEqualTo("MAINTENANCE");
        assertThat(count("SELECT count(*) FROM inventory_items WHERE id=?::uuid AND status='DISPENSE_FAILED'", command.path("inventoryItemId").asText())).isEqualTo(1);
        kioskData("POST", commandPath(command) + "/results", order.shop().key(), result(claim, "SUCCESS"), 409);
        assertThat(kioskData("POST", preparePath(order), order.shop().key(), null, 200).path("status").asText()).isEqualTo("TIMEOUT");
    }

    @Test
    void failedMotionAndExpiredUnclaimedCommandsCannotReturnBowlsToSaleableStock() throws Exception {
        var order = placeOrder();
        var command = paidCommand(order);
        dispense.expire(UUID.fromString(command.path("id").asText()), Instant.now().plusSeconds(300));
        assertThat(orderStatus(order.orderId())).isEqualTo("DISPENSE_FAILED");
        var another = placeOrder();
        var otherCommand = paidCommand(another);
        var claim = claim(another, otherCommand);
        kioskData("POST", commandPath(otherCommand) + "/results", another.shop().key(), Map.of("dispatchToken", claim.path("dispatchToken").asText(), "status", "FAILED"), 200);
        assertThat(orderStatus(another.orderId())).isEqualTo("DISPENSE_FAILED");
    }

    @Test
    void expiredInventoryAndInactiveSlotsAreRefusedBeforeDispatch() throws Exception {
        var order = placeOrder();
        var command = paidCommand(order);
        jdbc.update("UPDATE product_batches SET expires_at=now() - interval '1 second' WHERE id=(SELECT batch_id FROM inventory_items WHERE id=?::uuid)", command.path("inventoryItemId").asText());
        kioskData("POST", commandPath(command) + "/claim", order.shop().key(), null, 409);
        assertThat(orderStatus(order.orderId())).isEqualTo("PAID");
        assertThat(count("SELECT count(*) FROM dispense_commands WHERE order_id=? AND sent_at IS NOT NULL", order.orderId())).isZero();
        var other = placeOrder();
        var b = paidCommand(other);
        jdbc.update("UPDATE machine_slots SET status='INACTIVE' WHERE id=?", other.shop().slotId());
        kioskData("POST", commandPath(b) + "/claim", other.shop().key(), null, 409);
    }

    @Test
    void historyWriteFailureRollsBackTheEntireSaleAndAllowsEvidenceRetry() throws Exception {
        var order = placeOrder();
        var command = paidCommand(order);
        var claim = claim(order, command);
        jdbc.execute("CREATE FUNCTION dispense_test_reject_sale() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test sale failure'; END; $$");
        jdbc.execute("CREATE TRIGGER dispense_test_reject_sale BEFORE INSERT ON inventory_transactions FOR EACH ROW WHEN (NEW.type='SALE') EXECUTE FUNCTION dispense_test_reject_sale()");
        try {
            kioskJson("POST", commandPath(command) + "/results", order.shop().key(), result(claim, "SUCCESS"), 500);
            assertThat(orderStatus(order.orderId())).isEqualTo("DISPENSING");
            assertThat(count("SELECT count(*) FROM inventory_items WHERE id=?::uuid AND status='RESERVED'", command.path("inventoryItemId").asText())).isEqualTo(1);
            assertThat(count("SELECT count(*) FROM dispense_commands WHERE id=?::uuid AND status='SENT'", command.path("id").asText())).isEqualTo(1);
        } finally {
            jdbc.execute("DROP TRIGGER dispense_test_reject_sale ON inventory_transactions");
            jdbc.execute("DROP FUNCTION dispense_test_reject_sale()");
        }
        kioskData("POST", commandPath(command) + "/results", order.shop().key(), result(claim, "SUCCESS"), 200);
        assertThat(orderStatus(order.orderId())).isEqualTo("COMPLETED");
    }

    @Test
    void swaggerAndCommittedContractExposeExactlyTheNewOperationsAndSchemas() throws Exception {
        mvc.perform(get("/swagger-ui/index.html")).andExpect(status().isOk());
        JsonNode actual = json.readTree(mvc.perform(get("/v3/api-docs")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        Files.writeString(Path.of("target/dispense-openapi.json"), json.writerWithDefaultPrettyPrinter().writeValueAsString(actual));
        JsonNode expected = new ObjectMapper(new YAMLFactory()).readTree(Path.of("../api-contract/api.yaml").toFile());
        Files.writeString(Path.of("target/contract-before.json"), json.writerWithDefaultPrettyPrinter().writeValueAsString(expected));
        for (String path : List.of("/api/v1/kiosk/orders/{orderId}/dispense-command", "/api/v1/kiosk/dispense-commands",
                "/api/v1/kiosk/dispense-commands/{commandId}/claim", "/api/v1/kiosk/dispense-commands/{commandId}/results")) {
            assertThat(actual.path("paths").path(path)).isEqualTo(expected.path("paths").path(path));
        }
        actual.path("components").path("schemas").fields().forEachRemaining(entry -> {
            if (entry.getKey().contains("Dispense")) assertThat(entry.getValue()).isEqualTo(expected.path("components").path("schemas").path(entry.getKey()));
        });
        assertThat(actual.path("tags")).isEqualTo(expected.path("tags"));
        assertThat(actual.toString()).doesNotContain("secretHash", "secret_hash");
    }
}
