#include "ConfigPortalService.h"

#include <WiFi.h>

#include "app_config.h"
#include "utils/Logger.h"

bool ConfigPortalService::begin()
{
    load();
    return true;
}

void ConfigPortalService::load()
{
    preferences.begin("fvm_config", false);
    wifiSsidValue = preferences.getString("wifi_ssid", AppConfig::WIFI_SSID);
    wifiPasswordValue = preferences.getString("wifi_pass", AppConfig::WIFI_PASSWORD);
    mqttHostValue = preferences.getString("mqtt_host", AppConfig::MQTT_HOST);
    mqttPortValue = preferences.getUShort("mqtt_port", AppConfig::MQTT_PORT);
    machineCodeValue = preferences.getString("machine_code", AppConfig::MACHINE_CODE);
    mqttPasswordValue = preferences.getString("mqtt_pass", AppConfig::MQTT_PASSWORD);

    wifiSsidValue = wifiSsidValue.substring(0, 32);
    wifiPasswordValue = wifiPasswordValue.substring(0, 64);
    mqttHostValue = mqttHostValue.substring(0, 64);
    machineCodeValue = machineCodeValue.substring(0, 32);
    mqttPasswordValue = mqttPasswordValue.substring(0, 64);
    if (mqttPortValue == 0)
    {
        mqttPortValue = 1883;
    }
}

void ConfigPortalService::startPortal()
{
    if (active)
    {
        return;
    }

    WiFi.mode(WIFI_AP);
    IPAddress ip(192, 168, 4, 1);
    IPAddress gateway(192, 168, 4, 1);
    IPAddress subnet(255, 255, 255, 0);
    WiFi.softAPConfig(ip, gateway, subnet);
    WiFi.softAP("FreshVend-Setup");

    dnsServer.start(53, "*", ip);
    webServer.on("/", HTTP_GET, [this]()
                 { handleRoot(); });
    webServer.on("/save", HTTP_POST, [this]()
                 { handleSave(); });
    webServer.onNotFound([this]()
                         { handleNotFound(); });
    webServer.begin();
    active = true;
    Logger::info("Configuration portal started: SSID FreshVend-Setup, IP %s", ip.toString().c_str());
}

void ConfigPortalService::loop()
{
    if (!active)
    {
        return;
    }
    dnsServer.processNextRequest();
    webServer.handleClient();
}

void ConfigPortalService::handleRoot()
{
    webServer.send(200, "text/html; charset=utf-8", page());
}

void ConfigPortalService::handleSave()
{
    const String wifiSsid = webServer.arg("wifi_ssid");
    const String wifiPassword = webServer.arg("wifi_pass");
    const String mqttHost = webServer.arg("mqtt_host");
    const String machineCode = webServer.arg("machine_code");
    const String mqttPassword = webServer.arg("mqtt_pass");
    const String portText = webServer.arg("mqtt_port");
    const long port = portText.toInt();

    if (!validField(wifiSsid, 32, true) ||
        !validField(wifiPassword, 64, false) ||
        !validField(mqttHost, 64, true) ||
        !validField(machineCode, 32, true) ||
        !validField(mqttPassword, 64, false) ||
        port < 1 || port > 65535)
    {
        webServer.send(400, "text/html; charset=utf-8",
                       page("Dữ liệu không hợp lệ. Vui lòng kiểm tra độ dài và cổng MQTT."));
        return;
    }

    preferences.putString("wifi_ssid", wifiSsid);
    preferences.putString("wifi_pass", wifiPassword);
    preferences.putString("mqtt_host", mqttHost);
    preferences.putUShort("mqtt_port", static_cast<uint16_t>(port));
    preferences.putString("machine_code", machineCode);
    preferences.putString("mqtt_pass", mqttPassword);

    wifiSsidValue = wifiSsid;
    wifiPasswordValue = wifiPassword;
    mqttHostValue = mqttHost;
    mqttPortValue = static_cast<uint16_t>(port);
    machineCodeValue = machineCode;
    mqttPasswordValue = mqttPassword;

    webServer.send(200, "text/html; charset=utf-8",
                   page("Đã lưu thành công. Máy đang khởi động lại..."));
    Logger::info("Configuration saved to NVS; restarting");
    delay(1500);
    ESP.restart();
}

void ConfigPortalService::handleNotFound()
{
    webServer.sendHeader("Location", "http://192.168.4.1/");
    webServer.send(302, "text/plain", "");
}

bool ConfigPortalService::validField(const String &value, size_t maxLength, bool required) const
{
    return value.length() <= maxLength && (!required || value.length() > 0);
}

String ConfigPortalService::page(const char *message) const
{
    String html;
    html.reserve(5000);
    html += F("<!doctype html><html lang='vi'><head><meta charset='utf-8'>"
              "<meta name='viewport' content='width=device-width,initial-scale=1'>"
              "<title>FreshVend - Cấu Hình Máy Bán Hàng</title><style>"
              "body{font-family:Arial,sans-serif;background:#eef5f1;margin:0;padding:20px;color:#18352a}"
              ".card{max-width:560px;margin:20px auto;background:#fff;padding:26px;border-radius:18px;"
              "box-shadow:0 8px 30px #18352a22}h1{font-size:24px;color:#157347}"
              "label{display:block;font-weight:600;margin:15px 0 6px}input{box-sizing:border-box;width:100%;"
              "padding:12px;border:1px solid #cbd9d0;border-radius:9px;font-size:16px}"
              "button{width:100%;margin-top:24px;padding:14px;border:0;border-radius:9px;"
              "background:#157347;color:#fff;font-size:16px;font-weight:700}"
              ".msg{padding:12px;background:#e1f3e8;border-radius:8px;margin-bottom:12px}</style></head>"
              "<body><main class='card'><h1>FreshVend - Cấu Hình Máy Bán Hàng</h1>");
    if (message != nullptr)
    {
        html += "<div class='msg'>";
        html += message;
        html += "</div>";
    }
    html += F("<form method='post' action='/save'>"
              "<label>Tên Wi-Fi (SSID)</label><input name='wifi_ssid' maxlength='32' required>"
              "<label>Mật khẩu Wi-Fi</label><input name='wifi_pass' type='password' maxlength='64'>"
              "<label>Địa chỉ MQTT Broker</label><input name='mqtt_host' maxlength='64' required>"
              "<label>Cổng MQTT Port</label><input name='mqtt_port' type='number' min='1' max='65535' value='1883' required>"
              "<label>Mã định danh máy</label><input name='machine_code' maxlength='32' value='FV-DEV-001' required>"
              "<label>Mật khẩu MQTT</label><input name='mqtt_pass' type='password' maxlength='64'>"
              "<button type='submit'>LƯU &amp; KHỞI ĐỘNG LẠI</button></form></main></body></html>");
    return html;
}
