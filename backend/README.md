# Fruit_Vending_Machine

## Backend MQTT đơn giản

Backend dùng Spring Boot để nhận HTTP request, sau đó publish lệnh MQTT tới ESP32. Topic và payload khớp firmware:

- Topic: `fruit-vending/{machineId}/command`
- Payload: `NEXT` hoặc `STOP`

### Khởi chạy broker phát triển

Từ thư mục gốc repository:

```powershell
docker compose -f infra/docker-compose.yml up -d mosquitto
```

Backend chạy trên cùng máy dùng `tcp://localhost:1883`. ESP32 dùng IPv4 LAN của máy chạy broker trong `APP_MQTT_HOST` (xem bằng `ipconfig`), không dùng `localhost`.

### Cấu hình và chạy

Cần Java 21, Maven và một MQTT broker mà cả máy chạy backend lẫn ESP32 đều truy cập được. Mặc định backend kết nối `tcp://localhost:1883`.

Trong PowerShell, thay `192.168.1.10` bằng IP/hostname của broker:

```powershell
$env:MQTT_BROKER_URL = "tcp://192.168.1.10:1883"
$env:MQTT_USERNAME = ""
$env:MQTT_PASSWORD = ""
mvn spring-boot:run
```

Nếu broker không yêu cầu tài khoản, để username/password trống. Để ESP32 nhận được lệnh, cấu hình cùng địa chỉ, cổng, username và password trong `firmware/fruit/include/secrets.h`.

### Gửi lệnh

```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:8080/api/machines/machine001/commands/NEXT"
Invoke-RestMethod -Method Post -Uri "http://localhost:8080/api/machines/machine001/commands/STOP"
```

`NEXT` tiến một bước trong chu trình servo; `STOP` dừng servo theo firmware. API trả HTTP 503 nếu không publish được tới broker, và HTTP 400 nếu command hoặc machine ID không hợp lệ. Backend phải được bảo vệ bằng xác thực trước khi sử dụng ngoài mạng phát triển.