package com.fruitmachine.backend.common.exception;

import com.fruitmachine.backend.common.response.ApiErrorResponse;
import jakarta.validation.ConstraintViolationException;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.lang.Nullable;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.ServletWebRequest;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler extends ResponseEntityExceptionHandler {
    @ExceptionHandler(org.springframework.security.core.AuthenticationException.class)
    public ResponseEntity<Object> handleAuthentication(WebRequest request) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED).header("Cache-Control", "no-store")
                .header("WWW-Authenticate", "Bearer")
                .body(response(401, "Unauthorized", "Invalid email or password", Map.of(), request));
    }

    @ExceptionHandler(ResourceNotFoundException.class)
    public ResponseEntity<Object> handleNotFound(ResourceNotFoundException ex, WebRequest request) {
        return error(HttpStatus.NOT_FOUND, "Not Found", ex.getMessage(), Map.of(), request);
    }

    @ExceptionHandler(org.springframework.security.access.AccessDeniedException.class)
    public ResponseEntity<Object> handleAccessDenied(WebRequest request) {
        return error(HttpStatus.FORBIDDEN, "Forbidden", "Access denied", Map.of(), request);
    }

    @ExceptionHandler(BadRequestException.class)
    public ResponseEntity<Object> handleBadRequest(BadRequestException ex, WebRequest request) {
        return error(HttpStatus.BAD_REQUEST, "Bad Request", ex.getMessage(), Map.of(), request);
    }

    @ExceptionHandler(ConflictException.class)
    public ResponseEntity<Object> handleConflict(ConflictException ex, WebRequest request) {
        return error(HttpStatus.CONFLICT, "Conflict", ex.getMessage(), Map.of(), request);
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<Object> handleDataConflict(DataIntegrityViolationException ex, WebRequest request) {
        // Never expose SQL, constraint contents or rejected values to clients.
        return error(HttpStatus.CONFLICT, "Conflict", "Request conflicts with existing data", Map.of(), request);
    }

    @ExceptionHandler(ConstraintViolationException.class)
    public ResponseEntity<Object> handleConstraintViolation(ConstraintViolationException ex, WebRequest request) {
        Map<String, String> errors = new LinkedHashMap<>();
        ex.getConstraintViolations().forEach(v -> errors.putIfAbsent(v.getPropertyPath().toString(), v.getMessage()));
        return error(HttpStatus.BAD_REQUEST, "Validation Failed", "Request validation failed", errors, request);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Object> handleUnexpected(Exception ex, WebRequest request) {
        log.error("Unhandled request exception of type {}", ex.getClass().getName());
        return error(HttpStatus.INTERNAL_SERVER_ERROR, "Internal Server Error",
                "An unexpected error occurred", Map.of(), request);
    }

    @Override
    protected ResponseEntity<Object> handleMethodArgumentNotValid(
            MethodArgumentNotValidException ex, HttpHeaders headers, HttpStatusCode status, WebRequest request) {
        Map<String, String> errors = new LinkedHashMap<>();
        ex.getBindingResult().getAllErrors().forEach(e -> {
            String key = e instanceof FieldError fieldError ? fieldError.getField() : e.getObjectName();
            errors.putIfAbsent(key, e.getDefaultMessage() == null ? "Invalid value" : e.getDefaultMessage());
        });
        return error(HttpStatus.BAD_REQUEST, "Validation Failed", "Request validation failed", errors, request);
    }

    @Override
    protected ResponseEntity<Object> handleHandlerMethodValidationException(
            HandlerMethodValidationException ex, HttpHeaders headers, HttpStatusCode status, WebRequest request) {
        if (ex.isForReturnValue()) {
            return error(HttpStatus.INTERNAL_SERVER_ERROR, "Internal Server Error",
                    "An unexpected error occurred", Map.of(), request);
        }
        Map<String, String> errors = new LinkedHashMap<>();
        ex.getParameterValidationResults().forEach(result -> {
            String name = result.getMethodParameter().getParameterName();
            String key = name == null ? "argument" + result.getMethodParameter().getParameterIndex() : name;
            result.getResolvableErrors().forEach(e -> errors.putIfAbsent(key,
                    e.getDefaultMessage() == null ? "Invalid value" : e.getDefaultMessage()));
        });
        return error(HttpStatus.BAD_REQUEST, "Validation Failed", "Request validation failed", errors, request);
    }

    @Override
    protected ResponseEntity<Object> handleHttpMessageNotReadable(
            HttpMessageNotReadableException ex, HttpHeaders headers, HttpStatusCode status, WebRequest request) {
        return error(HttpStatus.BAD_REQUEST, "Bad Request", "Request body is missing or malformed", Map.of(), request);
    }

    @Override
    protected ResponseEntity<Object> handleExceptionInternal(
            Exception ex, @Nullable Object body, HttpHeaders headers, HttpStatusCode status, WebRequest request) {
        HttpStatus knownStatus = HttpStatus.resolve(status.value());
        String reason = knownStatus == null ? "Request Failed" : knownStatus.getReasonPhrase();
        // Preserve framework headers (e.g. Allow on HTTP 405), replace unsafe details.
        return new ResponseEntity<>(response(status.value(), reason, reason, Map.of(), request), headers, status);
    }

    private ResponseEntity<Object> error(
            HttpStatus status, String error, String message, Map<String, String> fields, WebRequest request) {
        return ResponseEntity.status(status).body(response(status.value(), error, message, fields, request));
    }

    private ApiErrorResponse response(
            int status, String error, String message, Map<String, String> fields, WebRequest request) {
        String path = request instanceof ServletWebRequest servlet ? servlet.getRequest().getRequestURI() : "";
        return new ApiErrorResponse(Instant.now(), status, error, message, path, fields);
    }
}
