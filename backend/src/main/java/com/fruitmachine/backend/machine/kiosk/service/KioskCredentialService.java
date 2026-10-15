package com.fruitmachine.backend.machine.kiosk.service;

import com.fruitmachine.backend.common.exception.ConflictException;
import com.fruitmachine.backend.common.exception.ResourceNotFoundException;
import com.fruitmachine.backend.machine.kiosk.dto.IssuedKioskCredentialResponse;
import com.fruitmachine.backend.machine.kiosk.dto.KioskCredentialResponse;
import com.fruitmachine.backend.machine.kiosk.entity.KioskCredential;
import com.fruitmachine.backend.machine.kiosk.enums.KioskCredentialStatus;
import com.fruitmachine.backend.machine.kiosk.repository.KioskCredentialRepository;
import com.fruitmachine.backend.machine.repository.MachineRepository;
import com.fruitmachine.backend.security.kiosk.AuthenticatedKiosk;
import com.fruitmachine.backend.security.user.AuthenticatedUser;
import com.fruitmachine.backend.user.entity.User;
import com.fruitmachine.backend.user.repository.UserRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Kiosk keys have the form {@code fvk_<prefix>_<secret>}. The secret is 256 random bits, so a fast
 * SHA-256 digest (compared in constant time) is sufficient; BCrypt would only add per-request CPU.
 */
@Service
@RequiredArgsConstructor
public class KioskCredentialService {
    private static final String MARKER = "fvk_";
    private static final String PREFIX_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
    private static final int PREFIX_LENGTH = 12;
    private static final int MAX_PREFIX_ATTEMPTS = 3;
    private static final Pattern KEY = Pattern.compile("^fvk_([a-z0-9]{12})_([A-Za-z0-9_-]{43})$");
    private static final SecureRandom RANDOM = new SecureRandom();
    // Compared when the prefix is unknown so a lookup miss costs the same as a hash mismatch.
    private static final byte[] DUMMY_HASH = new byte[64];

    private final KioskCredentialRepository credentials;
    private final MachineRepository machines;
    private final UserRepository users;
    private final Clock clock;

    @Transactional
    @PreAuthorize("hasRole('ADMIN')")
    public IssuedKioskCredentialResponse issue(UUID machineId) {
        // The machine row lock serializes rotation so the one-ACTIVE index is never raced.
        machines.findForUpdateById(machineId).orElseThrow(KioskCredentialService::missingMachine);
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        User actor = actorReference();
        credentials.findByMachineIdAndStatus(machineId, KioskCredentialStatus.ACTIVE).ifPresent(active -> {
            markRevoked(active, now, actor);
            // Flush so the revoked state is visible before the replacement hits the partial unique index.
            credentials.saveAndFlush(active);
        });
        String prefix = newPrefix();
        String secret = newSecret();
        var credential = new KioskCredential();
        credential.setMachine(machines.getReferenceById(machineId));
        credential.setKeyPrefix(prefix);
        credential.setSecretHash(hash(secret));
        credential.setStatus(KioskCredentialStatus.ACTIVE);
        credential.setCreatedBy(actor);
        credentials.saveAndFlush(credential);
        return new IssuedKioskCredentialResponse(credential.getId(), machineId, prefix, MARKER + prefix + "_" + secret,
                credential.getStatus(), credential.getCreatedAt());
    }

    @Transactional(readOnly = true)
    @PreAuthorize("hasRole('ADMIN')")
    public List<KioskCredentialResponse> list(UUID machineId) {
        if (!machines.existsById(machineId)) throw missingMachine();
        return credentials.findHistoryByMachineId(machineId).stream().map(this::metadata).toList();
    }

    @Transactional
    @PreAuthorize("hasRole('ADMIN')")
    public KioskCredentialResponse revoke(UUID machineId, UUID credentialId) {
        if (!machines.existsById(machineId)) throw missingMachine();
        var credential = credentials.findForUpdateByIdAndMachineId(credentialId, machineId)
                .orElseThrow(() -> new ResourceNotFoundException("Kiosk credential not found"));
        if (credential.getStatus() == KioskCredentialStatus.ACTIVE) {
            markRevoked(credential, clock.instant().truncatedTo(ChronoUnit.MICROS), actorReference());
            credentials.saveAndFlush(credential);
        }
        return metadata(credential);
    }

    /** Returns the kiosk for a valid ACTIVE key; callers must not reveal which check failed. */
    @Transactional(readOnly = true)
    public Optional<AuthenticatedKiosk> authenticate(String headerValue) {
        if (headerValue == null) return Optional.empty();
        Matcher match = KEY.matcher(headerValue);
        if (!match.matches()) return Optional.empty();
        var credential = credentials.findByKeyPrefix(match.group(1)).orElse(null);
        byte[] expected = credential == null ? DUMMY_HASH : credential.getSecretHash().getBytes(StandardCharsets.US_ASCII);
        byte[] actual = hash(match.group(2)).getBytes(StandardCharsets.US_ASCII);
        boolean equal = MessageDigest.isEqual(expected, actual);
        if (credential == null || !equal || credential.getStatus() != KioskCredentialStatus.ACTIVE) return Optional.empty();
        var machine = credential.getMachine();
        return Optional.of(new AuthenticatedKiosk(credential.getId(), machine.getId(), machine.getCode()));
    }

    private void markRevoked(KioskCredential credential, Instant now, User actor) {
        credential.setStatus(KioskCredentialStatus.REVOKED);
        // created_at comes from the database clock; never let clock skew violate revoked_at >= created_at.
        credential.setRevokedAt(credential.getCreatedAt() != null && now.isBefore(credential.getCreatedAt()) ? credential.getCreatedAt() : now);
        credential.setRevokedBy(actor);
    }

    private User actorReference() {
        var principal = (AuthenticatedUser) SecurityContextHolder.getContext().getAuthentication().getPrincipal();
        return users.getReferenceById(principal.getId());
    }

    private KioskCredentialResponse metadata(KioskCredential credential) {
        return new KioskCredentialResponse(credential.getId(), credential.getKeyPrefix(), credential.getStatus(),
                credential.getCreatedAt(), credential.getCreatedBy() == null ? null : credential.getCreatedBy().getId(),
                credential.getRevokedAt(), credential.getRevokedBy() == null ? null : credential.getRevokedBy().getId());
    }

    private String newPrefix() {
        for (int attempt = 0; attempt < MAX_PREFIX_ATTEMPTS; attempt++) {
            var builder = new StringBuilder(PREFIX_LENGTH);
            for (int i = 0; i < PREFIX_LENGTH; i++) builder.append(PREFIX_ALPHABET.charAt(RANDOM.nextInt(PREFIX_ALPHABET.length())));
            if (!credentials.existsByKeyPrefix(builder.toString())) return builder.toString();
        }
        throw new ConflictException("Could not allocate a unique credential prefix");
    }

    private static String newSecret() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static String hash(String secret) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(secret.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 is unavailable", ex);
        }
    }

    private static ResourceNotFoundException missingMachine() {
        return new ResourceNotFoundException("Machine not found");
    }
}
