package com.fruitmachine.backend.mqtt.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/** Always bound (also when MQTT is disabled) so the parser and the connection state can read the settings. */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(MqttProperties.class)
public class MqttPropertiesConfig {
}
