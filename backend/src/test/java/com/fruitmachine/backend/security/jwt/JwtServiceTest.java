package com.fruitmachine.backend.security.jwt;

import com.fruitmachine.backend.security.user.AuthenticatedUser;
import com.fruitmachine.backend.user.enums.UserStatus;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.Date;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.core.authority.SimpleGrantedAuthority;

import static org.assertj.core.api.Assertions.*;

class JwtServiceTest {
    static final Instant NOW = Instant.parse("2026-10-03T00:00:00Z");
    static final Clock CLOCK = Clock.fixed(NOW, ZoneOffset.UTC);
    final String key = newKey();
    final JwtService tokens = new JwtService(new JwtProperties(key, 3600), CLOCK);
    final AuthenticatedUser user = new AuthenticatedUser(UUID.randomUUID(), "test@example.com", "hash-not-a-claim",
            UserStatus.ACTIVE, List.of(new SimpleGrantedAuthority("ROLE_ADMIN")));

    public static String newKey() {
        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        return Base64.getEncoder().encodeToString(bytes);
    }

    @Test
    void generatesParsesAndValidatesMinimalSignedTokenWithStableSubjectAndTimes() throws Exception {
        String token = tokens.generateToken(user);
        var parsed = SignedJWT.parse(token);
        var claims = tokens.validateToken(token);
        assertThat(parsed.getHeader().getAlgorithm()).isEqualTo(JWSAlgorithm.HS256);
        assertThat(tokens.extractSubject(token)).isEqualTo(user.getId());
        assertThat(claims.getSubject()).isEqualTo(user.getId().toString());
        assertThat(claims.getIssueTime().toInstant()).isEqualTo(NOW);
        assertThat(tokens.extractExpiration(token)).isEqualTo(NOW.plusSeconds(3600));
        assertThat(claims.getClaims()).containsOnlyKeys("sub", "email", "roles", "iat", "exp");
        assertThat(claims.getStringListClaim("roles")).containsExactly("ROLE_ADMIN");
        assertThat(claims.toString()).doesNotContain(user.getPassword());
    }

    @Test
    void rejectsAtExpirationBoundaryWithoutRealWaiting() {
        String token = tokens.generateToken(user);
        var expired = new JwtService(new JwtProperties(key, 3600), Clock.fixed(NOW.plusSeconds(3600), ZoneOffset.UTC));
        assertThatThrownBy(() -> expired.validateToken(token)).isInstanceOf(BadCredentialsException.class);
    }

    @Test
    void rejectsModifiedPayloadAndDifferentSigningKey() {
        String token = tokens.generateToken(user);
        String[] parts = token.split("\\.");
        parts[1] = Base64.getUrlEncoder().withoutPadding().encodeToString("{\"sub\":\"attacker\"}".getBytes());
        assertThatThrownBy(() -> tokens.validateToken(String.join(".", parts))).isInstanceOf(BadCredentialsException.class);
        var other = new JwtService(new JwtProperties(newKey(), 3600), CLOCK);
        assertThatThrownBy(() -> tokens.validateToken(other.generateToken(user))).isInstanceOf(BadCredentialsException.class);
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "garbage", "a.b.c", "eyJhbGciOiJub25lIn0.e30."})
    void rejectsMalformedAndUnsignedTokens(String token) {
        assertThatThrownBy(() -> tokens.validateToken(token)).isInstanceOf(BadCredentialsException.class);
    }

    @Test
    void rejectsMissingClaimsInvalidSubjectFutureIssueAndWrongAlgorithm() throws Exception {
        for (var claims : List.of(
                new JWTClaimsSet.Builder().issueTime(Date.from(NOW)).expirationTime(Date.from(NOW.plusSeconds(10))).build(),
                new JWTClaimsSet.Builder().subject("bad-id").issueTime(Date.from(NOW)).expirationTime(Date.from(NOW.plusSeconds(10))).build(),
                new JWTClaimsSet.Builder().subject(user.getId().toString()).expirationTime(Date.from(NOW.plusSeconds(10))).build(),
                new JWTClaimsSet.Builder().subject(user.getId().toString()).issueTime(Date.from(NOW)).build(),
                new JWTClaimsSet.Builder().subject(user.getId().toString()).issueTime(Date.from(NOW.plusSeconds(5)))
                        .expirationTime(Date.from(NOW.plusSeconds(10))).build())) {
            SignedJWT jwt = new SignedJWT(new JWSHeader(JWSAlgorithm.HS256), claims);
            jwt.sign(new MACSigner(Base64.getDecoder().decode(key)));
            assertThatThrownBy(() -> tokens.validateToken(jwt.serialize())).isInstanceOf(BadCredentialsException.class);
        }
        byte[] longer = new byte[64];
        new SecureRandom().nextBytes(longer);
        var service = new JwtService(new JwtProperties(Base64.getEncoder().encodeToString(longer), 3600), CLOCK);
        SignedJWT wrongAlgorithm = new SignedJWT(new JWSHeader(JWSAlgorithm.HS512),
                SignedJWT.parse(service.generateToken(user)).getJWTClaimsSet());
        wrongAlgorithm.sign(new MACSigner(longer));
        assertThatThrownBy(() -> service.validateToken(wrongAlgorithm.serialize())).isInstanceOf(BadCredentialsException.class);
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "not-base64!", "c2hvcnQ="})
    void failsClearlyForMissingMalformedAndWeakSecretWithoutEchoingSecret(String secret) {
        assertThatThrownBy(() -> new JwtService(new JwtProperties(secret, 3600), CLOCK))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("JWT_SECRET");
        assertThat(new JwtProperties(secret, 3600).toString()).doesNotContain("secret=" + secret + ",");
    }

    @ParameterizedTest
    @ValueSource(longs = {0, -1, 86401})
    void rejectsUnsafeExpirationConfiguration(long expiry) {
        assertThatThrownBy(() -> new JwtService(new JwtProperties(key, expiry), CLOCK)).isInstanceOf(IllegalStateException.class);
    }
}
