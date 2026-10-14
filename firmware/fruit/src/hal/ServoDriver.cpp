
#include "ServoDriver.h"

#include "app_config.h"

bool ServoDriver::begin(
    uint8_t pin1,
    uint8_t pin2,
    uint8_t pin3,
    uint8_t pin4)
{
    servo1.setPeriodHertz(50);
    servo2.setPeriodHertz(50);
    servo3.setPeriodHertz(50);
    servo4.setPeriodHertz(50);

    servo1.attach(pin1, 1000, 2000);
    servo2.attach(pin2, 1000, 2000);
    servo3.attach(pin3, 1000, 2000);
    servo4.attach(pin4, 1000, 2000);

    initialized =
        servo1.attached() &&
        servo2.attached() &&
        servo3.attached() &&
        servo4.attached();

    stopAll();
    return initialized;
}

void ServoDriver::writeServo(
    Servo &servo,
    int pulseUs)
{
    if (initialized && servo.attached())
    {
        servo.writeMicroseconds(pulseUs);
    }
}

void ServoDriver::openComponent1()
{
    writeServo(servo1, AppConfig::SERVO_OPEN_US);
    writeServo(servo2, AppConfig::SERVO_OPEN_US);
}

void ServoDriver::closeComponent1()
{
    writeServo(servo1, AppConfig::SERVO_CLOSE_US);
    writeServo(servo2, AppConfig::SERVO_CLOSE_US);
}

void ServoDriver::openComponent2()
{
    writeServo(servo3, AppConfig::SERVO_OPEN_US);
    writeServo(servo4, AppConfig::SERVO_OPEN_US);
}

void ServoDriver::closeComponent2()
{
    writeServo(servo3, AppConfig::SERVO_CLOSE_US);
    writeServo(servo4, AppConfig::SERVO_CLOSE_US);
}

void ServoDriver::closeAll()
{
    closeComponent1();
    closeComponent2();
}

void ServoDriver::stopAll()
{
    if (servo1.attached())
    {
        servo1.writeMicroseconds(AppConfig::SERVO_STOP_US);
    }
    if (servo2.attached())
    {
        servo2.writeMicroseconds(AppConfig::SERVO_STOP_US);
    }
    if (servo3.attached())
    {
        servo3.writeMicroseconds(AppConfig::SERVO_STOP_US);
    }
    if (servo4.attached())
    {
        servo4.writeMicroseconds(AppConfig::SERVO_STOP_US);
    }
}
