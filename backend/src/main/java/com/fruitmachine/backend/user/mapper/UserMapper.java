package com.fruitmachine.backend.user.mapper;

import com.fruitmachine.backend.user.dto.UserResponse;
import com.fruitmachine.backend.user.entity.User;
import java.util.TreeSet;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

@Component
public class UserMapper {
    public UserResponse toResponse(User user) {
        var roles = user.getRoles().stream().map(role -> role.getName()).collect(Collectors.toCollection(TreeSet::new));
        return new UserResponse(user.getId(), user.getEmail(), user.getFullName(), user.getPhone(),
                user.getStatus(), roles, user.getCreatedAt(), user.getUpdatedAt());
    }
}
