package com.fruitmachine.backend.machine.kiosk.service;

import com.fruitmachine.backend.common.exception.ResourceNotFoundException;
import com.fruitmachine.backend.machine.kiosk.dto.KioskIdentityResponse;
import com.fruitmachine.backend.machine.repository.MachineRepository;
import com.fruitmachine.backend.security.kiosk.AuthenticatedKiosk;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
@PreAuthorize("hasRole('KIOSK')")
public class KioskIdentityService {
    private final MachineRepository machines;

    @Transactional(readOnly = true)
    public KioskIdentityResponse identity(AuthenticatedKiosk kiosk) {
        var machine = machines.findById(kiosk.machineId()).orElseThrow(() -> new ResourceNotFoundException("Machine not found"));
        return new KioskIdentityResponse(machine.getId(), machine.getCode(), machine.getName(), machine.getStatus());
    }
}
