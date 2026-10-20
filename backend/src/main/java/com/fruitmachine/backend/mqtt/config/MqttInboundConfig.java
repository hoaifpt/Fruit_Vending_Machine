package com.fruitmachine.backend.mqtt.config;

import com.fruitmachine.backend.mqtt.MqttConnectionState;
import com.fruitmachine.backend.mqtt.inbound.MqttInboundAdapter;
import com.fruitmachine.backend.mqtt.message.MachineChannel;
import java.util.Arrays;
import org.eclipse.paho.client.mqttv3.MqttConnectOptions;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.event.EventListener;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.integration.channel.DirectChannel;
import org.springframework.integration.mqtt.core.DefaultMqttPahoClientFactory;
import org.springframework.integration.mqtt.core.MqttPahoClientFactory;
import org.springframework.integration.mqtt.inbound.MqttPahoMessageDrivenChannelAdapter;
import org.springframework.integration.mqtt.support.DefaultPahoMessageConverter;
import org.springframework.integration.mqtt.support.MqttHeaders;

/**
 * Inbound MQTT client, created only when {@code app.mqtt.enabled=true}. Subscribes to {root}/+/{telemetry,status,events}
 * and never publishes. The adapter is started after the application is ready, on its own thread, so an unreachable broker
 * never delays or fails startup; Paho then retries with exponential backoff capped at {@code max-reconnect-delay}.
 */
@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(prefix = "app.mqtt", name = "enabled", havingValue = "true")
public class MqttInboundConfig {
    private static final Logger log = LoggerFactory.getLogger(MqttInboundConfig.class);
    static final int KEEP_ALIVE_SECONDS = 30;
    static final int CONNECTION_TIMEOUT_SECONDS = 10;

    @Bean
    MqttPahoClientFactory mqttClientFactory(MqttProperties properties, Environment environment) {
        properties.requireCredentials();
        if (environment.acceptsProfiles(Profiles.of("prod")) && !properties.brokerUrl().startsWith("ssl://"))
            throw new IllegalStateException("MQTT in the prod profile requires TLS: app.mqtt.broker-url must start with ssl://");
        var options = new MqttConnectOptions();
        options.setServerURIs(new String[]{properties.brokerUrl()});
        options.setUserName(properties.username());
        options.setPassword(properties.password().toCharArray());
        options.setCleanSession(properties.cleanSession());
        options.setKeepAliveInterval(KEEP_ALIVE_SECONDS);
        options.setConnectionTimeout(CONNECTION_TIMEOUT_SECONDS);
        // Paho reconnects with exponential backoff (1 s doubling up to max-reconnect-delay); the adapter re-subscribes on every reconnect.
        options.setAutomaticReconnect(true);
        options.setMaxReconnectDelay((int) properties.maxReconnectDelay().toMillis());
        var factory = new DefaultMqttPahoClientFactory();
        factory.setConnectionOptions(options);
        return factory;
    }

    @Bean
    DirectChannel mqttInboundChannel(MqttInboundAdapter inbound) {
        var channel = new DirectChannel();
        channel.subscribe(message -> inbound.onMessage((String) message.getHeaders().get(MqttHeaders.RECEIVED_TOPIC), (byte[]) message.getPayload()));
        return channel;
    }

    @Bean
    MqttPahoMessageDrivenChannelAdapter mqttInboundChannelAdapter(MqttProperties properties, MqttPahoClientFactory factory, DirectChannel mqttInboundChannel) {
        String[] topics = Arrays.stream(MachineChannel.values()).map(c -> properties.topicRoot() + "/+/" + c.topicLevel()).toArray(String[]::new);
        var adapter = new MqttPahoMessageDrivenChannelAdapter(properties.clientId(), factory, topics);
        int[] qos = new int[topics.length];
        Arrays.fill(qos, properties.qos());
        adapter.setQos(qos);
        adapter.setCompletionTimeout(properties.completionTimeout().toMillis());
        var converter = new DefaultPahoMessageConverter();
        converter.setPayloadAsBytes(true);
        adapter.setConverter(converter);
        adapter.setOutputChannel(mqttInboundChannel);
        adapter.setAutoStartup(false);
        return adapter;
    }

    @EventListener(ApplicationReadyEvent.class)
    void startInbound(ApplicationReadyEvent event) {
        var adapter = event.getApplicationContext().getBean(MqttPahoMessageDrivenChannelAdapter.class);
        var properties = event.getApplicationContext().getBean(MqttProperties.class);
        log.info("Starting MQTT inbound client {} for {} (topics under {}/+/...)", properties.clientId(), properties.brokerUrl(), properties.topicRoot());
        var state = event.getApplicationContext().getBean(MqttConnectionState.class);
        Thread starter = new Thread(() -> {
            adapter.start();
            // With automatic reconnect a failed first attempt publishes no event; say so once instead of staying silent.
            long deadline = System.nanoTime() + properties.completionTimeout().toNanos();
            while (state.status() != MqttConnectionState.Status.CONNECTED && System.nanoTime() < deadline) {
                try {
                    Thread.sleep(100);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return;
                }
            }
            if (state.status() != MqttConnectionState.Status.CONNECTED)
                log.warn("MQTT broker {} not reachable or refused the connection; retrying in the background (backoff up to {})",
                        properties.brokerUrl(), properties.maxReconnectDelay());
        }, "mqtt-inbound-start");
        starter.setDaemon(true);
        starter.start();
    }
}
