package com.fruitmachine.backend.common.exception;

import com.fruitmachine.backend.common.response.ApiResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

// This slice tests MVC response handling only; authentication is covered by full-chain tests.
@WebMvcTest(value = GlobalExceptionHandlerTest.TestController.class,
        excludeAutoConfiguration = org.springframework.boot.autoconfigure.security.servlet.UserDetailsServiceAutoConfiguration.class)
@org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc(addFilters = false)
@Import({GlobalExceptionHandler.class, GlobalExceptionHandlerTest.TestController.class})
class GlobalExceptionHandlerTest {
    @Autowired MockMvc mvc;

    @Test
    void serializesCommonSuccessResponse() throws Exception {
        mvc.perform(post("/foundation-test/body").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"test@example.com\",\"name\":\"Test\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.timestamp").isString())
                .andExpect(jsonPath("$.message").value("Request completed successfully"))
                .andExpect(jsonPath("$.data.name").value("Test"));
    }

    @Test
    void mapsNotFoundBadRequestAndConflict() throws Exception {
        for (var expected : Map.of("not-found", 404, "bad-request", 400, "conflict", 409).entrySet()) {
            String path = "/foundation-test/error/" + expected.getKey();
            mvc.perform(get(path)).andExpect(status().is(expected.getValue()))
                    .andExpect(jsonPath("$.status").value(expected.getValue()))
                    .andExpect(jsonPath("$.timestamp").isString())
                    .andExpect(jsonPath("$.message").value("Public error message"))
                    .andExpect(jsonPath("$.path").value(path))
                    .andExpect(jsonPath("$.fieldErrors").doesNotExist());
        }
    }

    @Test
    void returnsFieldErrorsWithoutRejectedValues() throws Exception {
        mvc.perform(post("/foundation-test/body").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"invalid-secret\",\"name\":\"\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.error").value("Validation Failed"))
                .andExpect(jsonPath("$.message").value("Request validation failed"))
                .andExpect(jsonPath("$.fieldErrors.email").value("Email must be valid"))
                .andExpect(jsonPath("$.fieldErrors.name").value("Name must not be blank"))
                .andExpect(content().string(not(containsString("invalid-secret"))));
    }

    @Test
    void handlesMethodParameterValidation() throws Exception {
        mvc.perform(get("/foundation-test/number").param("count", "0"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("Validation Failed"))
                .andExpect(jsonPath("$.fieldErrors.count").value("Count must be positive"));
    }

    @Test
    void handlesMalformedJsonMissingParametersAndTypeMismatch() throws Exception {
        mvc.perform(post("/foundation-test/body").contentType(MediaType.APPLICATION_JSON).content("{bad-secret"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Request body is missing or malformed"))
                .andExpect(content().string(not(containsString("bad-secret"))));
        mvc.perform(get("/foundation-test/number"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.status").value(400));
        mvc.perform(get("/foundation-test/number").param("count", "not-a-number"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("Bad Request"));
    }

    @Test
    void hidesInternalAndDatabaseExceptionDetails() throws Exception {
        mvc.perform(get("/foundation-test/error/unexpected"))
                .andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.message").value("An unexpected error occurred"))
                .andExpect(jsonPath("$.trace").doesNotExist())
                .andExpect(content().string(not(containsString("db_password"))));
        mvc.perform(get("/foundation-test/error/data-conflict"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").value("Request conflicts with existing data"))
                .andExpect(content().string(not(containsString("db_password"))));
    }

    @Test
    void handlesMissingRouteAndPreservesMethodNotAllowedHeader() throws Exception {
        mvc.perform(get("/foundation-test/missing"))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.path").value("/foundation-test/missing"));
        mvc.perform(get("/foundation-test/body"))
                .andExpect(status().isMethodNotAllowed())
                .andExpect(header().string("Allow", "POST"))
                .andExpect(jsonPath("$.status").value(405));
    }

    // Test-only controller; no feature API is added to production.
    @RestController
    public static class TestController {
        @GetMapping("/foundation-test/error/{kind}")
        public void error(@PathVariable String kind) {
            switch (kind) {
                case "not-found" -> throw new ResourceNotFoundException("Public error message");
                case "bad-request" -> throw new BadRequestException("Public error message");
                case "conflict" -> throw new ConflictException("Public error message");
                case "data-conflict" -> throw new DataIntegrityViolationException("db_password=internal-secret");
                default -> throw new IllegalStateException("db_password=internal-secret");
            }
        }

        @PostMapping("/foundation-test/body")
        public ApiResponse<Map<String, String>> body(@Valid @RequestBody TestRequest body) {
            return ApiResponse.success("Request completed successfully", Map.of("name", body.name()));
        }

        @GetMapping("/foundation-test/number")
        public ApiResponse<Integer> number(@RequestParam @Min(value = 1, message = "Count must be positive") int count) {
            return ApiResponse.success("Request completed successfully", count);
        }
    }

    public record TestRequest(
            @NotBlank(message = "Email must not be blank") @Email(message = "Email must be valid") String email,
            @NotBlank(message = "Name must not be blank") String name) {}
}
