package com.fruitmachine.backend.order;

import com.fasterxml.jackson.databind.JsonNode;
import com.fruitmachine.backend.support.AbstractOrderIntegrationTest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

class OrderManagementReadIntegrationTest extends AbstractOrderIntegrationTest {
    private record Shop(UUID machineId, UUID slotId, UUID productId, UUID secondProductId, String key) {}

    private Shop shop() throws Exception {
        UUID machine = fixtures.machine(admin.token());
        UUID slot = createSlot(machine, "S1", 30), a = createProduct("Read A", "10000"), b = createProduct("Read B", "2500.50");
        load(fixtures.batch(a, 10, staff.token()), slot, 10);
        load(fixtures.batch(b, 10, staff.token()), slot, 10);
        return new Shop(machine, slot, a, b, issueKey(machine));
    }

    @Test
    void adminAndStaffListFilterPageAndSortOrders() throws Exception {
        Shop shop = shop(), other = shop();
        Instant start = Instant.now().minusSeconds(5);
        List<JsonNode> created = new ArrayList<>();
        created.add(kioskData("POST", "/api/v1/kiosk/orders", shop.key(), orderBody(line(shop.productId(), 1)), 201));
        created.add(kioskData("POST", "/api/v1/kiosk/orders", shop.key(), orderBody(line(shop.productId(), 2), line(shop.secondProductId(), 1)), 201));
        created.add(kioskData("POST", "/api/v1/kiosk/orders", shop.key(), orderBody(line(shop.secondProductId(), 3)), 201));
        kioskData("POST", "/api/v1/kiosk/orders", other.key(), orderBody(line(other.productId(), 1)), 201);
        kioskData("POST", "/api/v1/kiosk/orders/" + created.get(2).path("id").asText() + "/cancel", shop.key(), null, 200);

        for (String token : new String[]{admin.token(), staff.token()}) {
            var page = fixtures.api("GET", "/api/v1/orders?machineId=" + shop.machineId() + "&size=2&page=0", null, token, 200);
            assertThat(page.path("totalElements").asInt()).isEqualTo(3);
            assertThat(page.path("totalPages").asInt()).isEqualTo(2);
            assertThat(page.path("content")).hasSize(2);
            // Default sort is newest first.
            assertThat(page.path("content").get(0).path("id").asText()).isEqualTo(created.get(2).path("id").asText());
            assertThat(page.path("content").get(0).path("machineCode").asText()).isNotBlank();
        }
        var second = fixtures.api("GET", "/api/v1/orders?machineId=" + shop.machineId() + "&size=2&page=1", null, staff.token(), 200);
        assertThat(second.path("content")).hasSize(1);
        assertThat(second.path("content").get(0).path("itemCount").asLong()).isEqualTo(1);

        var cancelled = fixtures.api("GET", "/api/v1/orders?status=CANCELLED&machineId=" + shop.machineId(), null, admin.token(), 200);
        assertThat(cancelled.path("content")).hasSize(1);
        assertThat(cancelled.path("content").get(0).path("cancelledAt").isNull()).isFalse();
        var pending = fixtures.api("GET", "/api/v1/orders?status=PENDING_PAYMENT&machineId=" + shop.machineId(), null, admin.token(), 200);
        assertThat(pending.path("totalElements").asInt()).isEqualTo(2);
        var multiLine = fixtures.api("GET", "/api/v1/orders?machineId=" + shop.machineId() + "&sort=orderCode,asc&size=10", null, admin.token(), 200);
        assertThat(multiLine.path("content").findValuesAsText("orderCode")).isSorted();
        var byTotal = fixtures.api("GET", "/api/v1/orders?machineId=" + shop.machineId() + "&sort=totalAmount,desc", null, admin.token(), 200);
        var totals = byTotal.path("content").findValues("totalAmount").stream().map(JsonNode::decimalValue).toList();
        assertThat(totals).isSortedAccordingTo(java.util.Comparator.reverseOrder());
        assertThat(totals.get(0)).isEqualByComparingTo("22500.50");

        String code = created.get(1).path("orderCode").asText();
        var found = fixtures.api("GET", "/api/v1/orders?search=" + code.substring(6, 14).toLowerCase(), null, staff.token(), 200);
        assertThat(found.path("content").findValuesAsText("orderCode")).contains(code);
        assertThat(fixtures.api("GET", "/api/v1/orders?search=%25", null, staff.token(), 200).path("content")).isEmpty();
        assertThat(fixtures.api("GET", "/api/v1/orders?search=_", null, staff.token(), 200).path("content")).isEmpty();

        var window = fixtures.api("GET", "/api/v1/orders?machineId=" + shop.machineId() + "&createdFrom=" + start + "&createdTo=" + Instant.now().plusSeconds(60), null, admin.token(), 200);
        assertThat(window.path("totalElements").asInt()).isEqualTo(3);
        var empty = fixtures.api("GET", "/api/v1/orders?machineId=" + shop.machineId() + "&createdTo=" + start, null, admin.token(), 200);
        assertThat(empty.path("totalElements").asInt()).isZero();

        for (String bad : new String[]{"size=0", "size=101", "page=-1", "sort=machine,asc", "sort=createdAt,sideways", "status=PAYING", "machineId=nope", "createdFrom=yesterday"})
            fixtures.response("GET", "/api/v1/orders?" + bad, null, admin.token(), 400);
    }

    @Test
    void detailsExposePriceSnapshotsAndAllocationsAndMissingOrderIs404() throws Exception {
        Shop shop = shop();
        var order = kioskData("POST", "/api/v1/kiosk/orders", shop.key(), orderBody(line(shop.productId(), 2), line(shop.secondProductId(), 1)), 201);
        String id = order.path("id").asText();
        kioskData("POST", "/api/v1/kiosk/orders/" + id + "/cancel", shop.key(), null, 200);
        for (String token : new String[]{admin.token(), staff.token()}) {
            var detail = fixtures.api("GET", "/api/v1/orders/" + id, null, token, 200);
            assertThat(detail.path("status").asText()).isEqualTo("CANCELLED");
            assertThat(detail.path("machineCode").asText()).isNotBlank();
            assertThat(detail.path("subtotal").decimalValue()).isEqualByComparingTo("22500.50");
            assertThat(detail.path("paidAt").isNull()).isTrue();
            assertThat(detail.path("completedAt").isNull()).isTrue();
            assertThat(detail.path("cancelledAt").isNull()).isFalse();
            assertThat(detail.path("items")).hasSize(2);
            for (var item : detail.path("items")) {
                assertThat(item.path("allocations")).hasSize(item.path("quantity").asInt());
                for (var allocation : item.path("allocations")) {
                    assertThat(allocation.path("status").asText()).isEqualTo("RELEASED");
                    assertThat(allocation.path("releasedAt").isNull()).isFalse();
                    assertThat(allocation.path("slotCode").asText()).isEqualTo("S1");
                    assertThat(allocation.path("batchCode").asText()).isNotBlank();
                    assertThat(Instant.parse(allocation.path("batchExpiresAt").asText())).isAfter(Instant.now());
                }
            }
        }
        fixtures.response("GET", "/api/v1/orders/" + UUID.randomUUID(), null, admin.token(), 404);
        fixtures.response("GET", "/api/v1/orders/not-a-uuid", null, admin.token(), 400);
    }

    @Test
    void ordersApiIsReadOnlyAndRejectsKiosksAndAnonymousCallers() throws Exception {
        Shop shop = shop();
        var order = kioskData("POST", "/api/v1/kiosk/orders", shop.key(), orderBody(line(shop.productId(), 1)), 201);
        String id = order.path("id").asText();
        assertThat(kioskCall("GET", "/api/v1/orders", shop.key(), null).getResponse().getStatus()).isEqualTo(401);
        assertThat(kioskCall("GET", "/api/v1/orders/" + id, shop.key(), null).getResponse().getStatus()).isEqualTo(401);
        fixtures.response("GET", "/api/v1/orders", null, null, 401);
        fixtures.response("GET", "/api/v1/orders/" + id, null, null, 401);
        for (String method : new String[]{"POST", "PUT", "PATCH", "DELETE"}) {
            for (String path : new String[]{"/api/v1/orders", "/api/v1/orders/" + id, "/api/v1/orders/" + id + "/status", "/api/v1/orders/" + id + "/cancel"}) {
                fixtures.response(method, path, java.util.Map.of("status", "PAID"), admin.token(), 403);
                fixtures.response(method, path, java.util.Map.of("status", "PAID"), staff.token(), 403);
                fixtures.response(method, path, java.util.Map.of("status", "PAID"), null, 401);
            }
        }
        assertThat(jdbc.queryForObject("SELECT status FROM orders WHERE id=?", String.class, UUID.fromString(id))).isEqualTo("PENDING_PAYMENT");
    }
}
