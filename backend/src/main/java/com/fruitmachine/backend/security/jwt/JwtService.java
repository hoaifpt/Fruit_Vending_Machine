package com.fruitmachine.backend.security.jwt;

import com.fruitmachine.backend.security.user.AuthenticatedUser;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jose.crypto.MACVerifier;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import java.text.ParseException;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.Date;
import java.util.UUID;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.stereotype.Service;

@Service
public class JwtService {
    private final byte[] key;
    private final long expirationSeconds;
    private final Clock clock;

    public JwtService(JwtProperties properties, Clock clock) {
        this.clock = clock;
        try {
            key = Base64.getDecoder().decode(properties.secret() == null ? "" : properties.secret());
        } catch (IllegalArgumentException ex) {
            throw new IllegalStateException("JWT_SECRET must be valid Base64 (minimum 32 decoded bytes)");
        }
        if (key.length < 32) {
            throw new IllegalStateException("JWT_SECRET must contain at least 32 cryptographically random decoded bytes");
        }
        expirationSeconds = properties.expirationSeconds();
        if (expirationSeconds < 1 || expirationSeconds > 86400) {
            throw new IllegalStateException("JWT_EXPIRATION_SECONDS must be between 1 and 86400");
        }
    }

    public String generateToken(AuthenticatedUser user) {
        Instant now = clock.instant().truncatedTo(ChronoUnit.SECONDS);
        JWTClaimsSet claims = new JWTClaimsSet.Builder().subject(user.getId().toString())
                .issueTime(Date.from(now)).expirationTime(Date.from(now.plusSeconds(expirationSeconds)))
                .claim("email", user.getUsername())
                .claim("roles", user.getAuthorities().stream().map(GrantedAuthority::getAuthority).sorted().toList())
                .build();
        SignedJWT jwt = new SignedJWT(new JWSHeader(JWSAlgorithm.HS256), claims);
        try {
            jwt.sign(new MACSigner(key));
            return jwt.serialize();
        } catch (JOSEException ex) {
            throw new IllegalStateException("Unable to sign access token");
        }
    }

    public JWTClaimsSet validateToken(String token) {
        try {
            SignedJWT jwt = SignedJWT.parse(token);
            if (!JWSAlgorithm.HS256.equals(jwt.getHeader().getAlgorithm()) || !jwt.verify(new MACVerifier(key))) {
                throw invalid();
            }
            JWTClaimsSet claims = jwt.getJWTClaimsSet();
            Instant now = clock.instant();
            if (claims.getIssueTime() == null || claims.getExpirationTime() == null
                    || claims.getIssueTime().toInstant().isAfter(now)
                    || !claims.getExpirationTime().toInstant().isAfter(now)
                    || !claims.getExpirationTime().after(claims.getIssueTime())
                    || (claims.getNotBeforeTime() != null && claims.getNotBeforeTime().toInstant().isAfter(now))) {
                throw invalid();
            }
            if (claims.getSubject() == null) {
                throw invalid();
            }
            UUID.fromString(claims.getSubject());
            return claims;
        } catch (ParseException | JOSEException | IllegalArgumentException ex) {
            throw invalid();
        }
    }

    public UUID extractSubject(String token) {
        return UUID.fromString(validateToken(token).getSubject());
    }

    public Instant extractExpiration(String token) {
        return validateToken(token).getExpirationTime().toInstant();
    }

    public long expirationSeconds() {
        return expirationSeconds;
    }

    private BadCredentialsException invalid() {
        return new BadCredentialsException("Invalid or expired access token");
    }
}
