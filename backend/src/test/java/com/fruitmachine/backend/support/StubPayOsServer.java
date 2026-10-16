package com.fruitmachine.backend.support;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executors;

/** Local stand-in for payOS (loopback only, JDK HttpServer). No automated test ever calls the real payOS. */
public final class StubPayOsServer implements AutoCloseable {
    public enum Mode { OK, CODE_ERROR, HTTP_500, HTTP_401, BLANK_QR, GARBAGE, SLOW }

    public record Call(String method, String path, Map<String, String> headers, String body) {
        public String header(String name) { return headers.get(name.toLowerCase()); }
    }

    private final HttpServer server;
    private final List<Call> calls = new CopyOnWriteArrayList<>();
    private volatile Mode createMode = Mode.OK;
    private volatile Mode cancelMode = Mode.OK;
    private volatile long slowMillis = 5000;
    private volatile Runnable onCancel = () -> { };

    public StubPayOsServer() {
        try {
            server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
        } catch (IOException ex) {
            throw new IllegalStateException(ex);
        }
        server.setExecutor(Executors.newCachedThreadPool());
        server.createContext("/", this::handle);
        server.start();
    }

    public String baseUrl() { return "http://127.0.0.1:" + server.getAddress().getPort(); }
    public List<Call> calls() { return calls; }
    public void createMode(Mode mode) { this.createMode = mode; }
    public void cancelMode(Mode mode) { this.cancelMode = mode; }
    public void slowMillis(long millis) { this.slowMillis = millis; }
    /** Runs on the server thread when a cancel request arrives, before it is answered. */
    public void onCancel(Runnable hook) { this.onCancel = hook; }

    public List<Call> creates() { return calls.stream().filter(c -> c.path().equals("/v2/payment-requests")).toList(); }
    public List<Call> cancels() { return calls.stream().filter(c -> c.path().endsWith("/cancel")).toList(); }

    public void reset() {
        calls.clear();
        createMode = Mode.OK;
        cancelMode = Mode.OK;
        slowMillis = 5000;
        onCancel = () -> { };
    }

    private void handle(HttpExchange exchange) throws IOException {
        try (exchange) {
            String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            Map<String, String> headers = new java.util.HashMap<>();
            exchange.getRequestHeaders().forEach((name, values) -> headers.put(name.toLowerCase(), values.get(0)));
            String path = exchange.getRequestURI().getPath();
            calls.add(new Call(exchange.getRequestMethod(), path, headers, body));
            boolean cancel = path.endsWith("/cancel");
            Mode mode = cancel ? cancelMode : createMode;
            if (cancel) onCancel.run();
            if (mode == Mode.SLOW) sleep(slowMillis);
            switch (mode) {
                case HTTP_500 -> reply(exchange, 500, "{\"code\":\"20\",\"desc\":\"secret-looking internal error body\"}");
                case HTTP_401 -> reply(exchange, 401, "{\"code\":\"201\",\"desc\":\"unauthorized\"}");
                case CODE_ERROR -> reply(exchange, 200, "{\"code\":\"231\",\"desc\":\"order already exists\",\"data\":null}");
                case BLANK_QR -> reply(exchange, 200, "{\"code\":\"00\",\"desc\":\"success\",\"data\":{\"qrCode\":\"  \"}}");
                case GARBAGE -> reply(exchange, 200, "<html>not json</html>");
                default -> reply(exchange, 200, cancel ? "{\"code\":\"00\",\"desc\":\"success\",\"data\":{\"status\":\"CANCELLED\"}}"
                        : "{\"code\":\"00\",\"desc\":\"success\",\"data\":{\"bin\":\"970422\",\"checkoutUrl\":\"https://pay.example.invalid/web/stub\","
                        + "\"paymentLinkId\":\"stub-link\",\"status\":\"PENDING\",\"qrCode\":\"STUB-VIETQR-PAYLOAD\"}}");
            }
        }
    }

    private static void reply(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        exchange.getResponseBody().write(bytes);
    }

    private static void sleep(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
        }
    }

    @Override
    public void close() {
        server.stop(0);
        ((java.util.concurrent.ExecutorService) server.getExecutor()).shutdownNow();
    }
}
