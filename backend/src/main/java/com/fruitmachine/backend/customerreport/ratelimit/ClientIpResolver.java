package com.fruitmachine.backend.customerreport.ratelimit;

import com.fruitmachine.backend.customerreport.config.PublicReportProperties;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Collections;
import java.util.Set;
import org.springframework.stereotype.Component;

/**
 * The client address of a public request: the remote address, or, only when the remote address is a trusted proxy, the right-most
 * X-Forwarded-For entry that is not itself a trusted proxy. Used for rate limits and the stored hash; never logged.
 */
@Component
public class ClientIpResolver {
    private final Set<String> trusted;

    public ClientIpResolver(PublicReportProperties properties) {
        this.trusted = Set.copyOf(properties.trustedProxies());
    }

    public String resolve(HttpServletRequest request) {
        String remote = request.getRemoteAddr() == null ? "" : request.getRemoteAddr().strip();
        if (!trusted.contains(remote)) return remote;
        var headers = Collections.list(request.getHeaders("X-Forwarded-For"));
        String client = remote;
        for (int h = headers.size() - 1; h >= 0; h--) {
            String[] entries = headers.get(h).split(",");
            for (int i = entries.length - 1; i >= 0; i--) {
                String entry = entries[i].strip();
                if (entry.isEmpty()) continue;
                if (!trusted.contains(entry)) return entry.length() > 45 ? entry.substring(0, 45) : entry;
                client = entry;
            }
        }
        return client;
    }
}
