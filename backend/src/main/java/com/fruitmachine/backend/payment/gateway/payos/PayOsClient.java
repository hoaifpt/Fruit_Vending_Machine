package com.fruitmachine.backend.payment.gateway.payos;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fruitmachine.backend.payment.gateway.PaymentProviderException;
import com.fruitmachine.backend.payment.gateway.payos.dto.PayOsCancelRequest;
import com.fruitmachine.backend.payment.gateway.payos.dto.PayOsCreateRequest;
import com.fruitmachine.backend.payment.gateway.payos.dto.PayOsCreateResponse;
import java.net.http.HttpClient;
import java.time.Duration;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

/**
 * HTTP calls to payOS only (Spring RestClient, no SDK). Request and response bodies are never logged, and exception
 * messages carry only the HTTP status or the payOS result code, never a body, header or secret.
 */
public class PayOsClient {
    static final String CREATE_PATH = "/v2/payment-requests";
    private static final String SUCCESS_CODE = "00";

    private final RestClient createClient;
    private final RestClient cancelClient;
    private final ObjectMapper mapper;

    public PayOsClient(PayOsProperties properties, Duration createTimeout, ObjectMapper mapper) {
        this.createClient = build(properties, createTimeout);
        this.cancelClient = build(properties, properties.cancelTimeout());
        this.mapper = mapper;
    }

    private static RestClient build(PayOsProperties properties, Duration requested) {
        // An invalid timeout is reported by PayOsProperties.problems() when payOS is active; MOCK startup must still work.
        Duration timeout = requested == null || requested.isZero() || requested.isNegative() ? Duration.ofSeconds(3) : requested;
        var factory = new JdkClientHttpRequestFactory(HttpClient.newBuilder().connectTimeout(timeout).build());
        factory.setReadTimeout(timeout);
        return RestClient.builder().baseUrl(properties.baseUrl()).requestFactory(factory)
                .defaultHeader("x-client-id", properties.clientId()).defaultHeader("x-api-key", properties.apiKey()).build();
    }

    /** Creates a payment link and returns the VietQR payload, or throws a sanitized PaymentProviderException. */
    public String createLink(PayOsCreateRequest request) {
        String body = post(createClient, CREATE_PATH, request);
        PayOsCreateResponse response;
        try {
            response = mapper.readValue(body, PayOsCreateResponse.class);
        } catch (JsonProcessingException | RuntimeException ex) {
            throw new PaymentProviderException("payOS returned an unreadable create response");
        }
        if (response == null || !SUCCESS_CODE.equals(response.code())) {
            throw new PaymentProviderException("payOS rejected the payment request (result code " + safeCode(response == null ? null : response.code()) + ")");
        }
        if (response.data() == null || response.data().qrCode() == null || response.data().qrCode().isBlank()) {
            throw new PaymentProviderException("payOS returned no QR code");
        }
        return response.data().qrCode();
    }

    /** Cancels a payment link; the caller treats any failure as best effort. */
    public void cancel(long orderCode, String reason) {
        post(cancelClient, CREATE_PATH + "/" + orderCode + "/cancel", new PayOsCancelRequest(reason));
    }

    private String post(RestClient client, String path, Object payload) {
        try {
            var entity = client.post().uri(path).contentType(MediaType.APPLICATION_JSON).body(mapper.writeValueAsString(payload))
                    .retrieve().onStatus(status -> true, (request, response) -> { }).toEntity(String.class);
            if (!entity.getStatusCode().is2xxSuccessful()) {
                // Deliberately no body: it may echo request data.
                throw new PaymentProviderException("payOS responded with HTTP " + entity.getStatusCode().value());
            }
            return entity.getBody() == null ? "" : entity.getBody();
        } catch (PaymentProviderException ex) {
            throw ex;
        } catch (JsonProcessingException ex) {
            throw new PaymentProviderException("payOS request could not be serialized");
        } catch (RuntimeException ex) {
            // Timeouts and connection errors; the cause is dropped because transport messages can include request details.
            throw new PaymentProviderException("payOS is unreachable or timed out");
        }
    }

    private static String safeCode(String code) {
        return code != null && code.matches("[0-9A-Za-z_-]{1,12}") ? code : "unknown";
    }
}
