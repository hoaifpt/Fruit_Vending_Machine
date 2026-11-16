package com.fruitmachine.backend.mqtt;

import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.Socket;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.util.Arrays;
import java.util.List;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;

/**
 * TLS sockets for {@code ssl://} broker URLs (issue #59): TLS 1.3 / 1.2 only, trusting either the JVM default trust store
 * (public CA such as Let's Encrypt) or one PKCS12 truststore (private CA). Hostname verification is switched on by the gateway.
 */
public final class MqttTlsSocketFactory extends SSLSocketFactory {
    static final List<String> PROTOCOLS = List.of("TLSv1.3", "TLSv1.2");

    private final SSLSocketFactory delegate;
    private final String[] protocols;

    private MqttTlsSocketFactory(SSLSocketFactory delegate, String[] supported) {
        this.delegate = delegate;
        this.protocols = PROTOCOLS.stream().filter(p -> Arrays.asList(supported).contains(p)).toArray(String[]::new);
        if (protocols.length == 0) throw new IllegalStateException("This JVM supports neither TLSv1.3 nor TLSv1.2");
    }

    /**
     * @param truststorePath PKCS12 truststore, or empty for the JVM default trust store
     * @param truststorePassword its password (may be empty); never logged, never part of an exception message
     */
    public static MqttTlsSocketFactory create(String truststorePath, String truststorePassword) {
        try {
            TrustManager[] trust = null;
            if (truststorePath != null && !truststorePath.isBlank()) {
                KeyStore store = KeyStore.getInstance("PKCS12");
                try (InputStream in = Files.newInputStream(Path.of(truststorePath))) {
                    store.load(in, truststorePassword == null ? new char[0] : truststorePassword.toCharArray());
                }
                var factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
                factory.init(store);
                trust = factory.getTrustManagers();
            }
            SSLContext context = SSLContext.getInstance("TLS");
            context.init(null, trust, null);
            SSLSocketFactory sockets = context.getSocketFactory();
            return new MqttTlsSocketFactory(sockets, context.getSupportedSSLParameters().getProtocols());
        } catch (IOException | GeneralSecurityException ex) {
            // The exception type and message (e.g. "keystore password was incorrect") never contain the password itself.
            throw new IllegalStateException("Cannot load app.mqtt.truststore-path as a PKCS12 truststore: " + ex.getClass().getSimpleName()
                    + (ex.getMessage() == null ? "" : " (" + ex.getMessage() + ")"));
        }
    }

    List<String> protocols() {
        return List.of(protocols);
    }

    private Socket limit(Socket socket) {
        if (socket instanceof SSLSocket ssl) ssl.setEnabledProtocols(protocols);
        return socket;
    }

    @Override
    public Socket createSocket() throws IOException {
        return limit(delegate.createSocket());
    }

    @Override
    public Socket createSocket(Socket s, String host, int port, boolean autoClose) throws IOException {
        return limit(delegate.createSocket(s, host, port, autoClose));
    }

    @Override
    public Socket createSocket(String host, int port) throws IOException {
        return limit(delegate.createSocket(host, port));
    }

    @Override
    public Socket createSocket(String host, int port, InetAddress localHost, int localPort) throws IOException {
        return limit(delegate.createSocket(host, port, localHost, localPort));
    }

    @Override
    public Socket createSocket(InetAddress host, int port) throws IOException {
        return limit(delegate.createSocket(host, port));
    }

    @Override
    public Socket createSocket(InetAddress address, int port, InetAddress localAddress, int localPort) throws IOException {
        return limit(delegate.createSocket(address, port, localAddress, localPort));
    }

    @Override
    public String[] getDefaultCipherSuites() {
        return delegate.getDefaultCipherSuites();
    }

    @Override
    public String[] getSupportedCipherSuites() {
        return delegate.getSupportedCipherSuites();
    }
}
