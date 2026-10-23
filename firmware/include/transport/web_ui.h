#pragma once
#include <Arduino.h>

const char INDEX_HTML[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ESP32 Quad Servo Control Center</title>
<style>
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0b0f19;color:#e5e7eb}
header{background:#111827;color:#fff;padding:16px 20px;border-bottom:1px solid #1f2937;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px}
header h1{margin:0;font-size:20px;color:#00f2fe;font-weight:700;letter-spacing:.5px}
header p{margin:4px 0 0;color:#9ca3af;font-size:12px}
.badge-live{background:#064e3b;color:#34d399;padding:4px 10px;border-radius:20px;font-size:11px;font-weight:600;display:inline-flex;align-items:center;gap:6px}
.pulse{width:7px;height:7px;border-radius:50%;background:#10b981;animation:pulse 1.5s infinite}
@keyframes pulse{0%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.8)}100%{opacity:1;transform:scale(1)}}
nav{display:flex;overflow-x:auto;gap:8px;padding:10px 16px;background:#131b2e;border-bottom:1px solid #1f2937}
nav button{border:1px solid #1f2937;padding:8px 16px;border-radius:6px;background:#1e293b;color:#94a3b8;white-space:nowrap;cursor:pointer;font-size:13px;font-weight:600;transition:.2s}
nav button.active{background:#00f2fe;color:#0b0f19;border-color:#00f2fe}
main{max-width:1050px;margin:auto;padding:16px}
.section{display:none}.section.active{display:block}
.card{background:#111827;border:1px solid #1f2937;border-radius:10px;padding:18px;margin-bottom:16px;box-shadow:0 4px 12px rgba(0,0,0,.3)}
.card h2{margin-top:0;font-size:16px;color:#38bdf8;border-bottom:1px solid #1f2937;padding-bottom:10px;display:flex;justify-content:space-between;align-items:center}
.grid-4{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
.grid-2{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px}
.stat-box{background:#182234;border:1px solid #233148;border-radius:8px;padding:14px}
.stat-tag{font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;font-weight:700}
.stat-val{font-size:16px;font-weight:700;margin:6px 0 2px;color:#f8fafc}
.stat-sub{font-size:11px;color:#64748b}
.btn-deck{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.btn{border:none;padding:10px 14px;border-radius:6px;cursor:pointer;font-weight:600;font-size:12px;transition:.15s;display:inline-flex;align-items:center;gap:6px}
.btn-primary{background:#0284c7;color:#fff}.btn-primary:hover{background:#0369a1}
.btn-success{background:#059669;color:#fff}.btn-success:hover{background:#047857}
.btn-warning{background:#d97706;color:#fff}.btn-warning:hover{background:#b45309}
.btn-danger{background:#dc2626;color:#fff}.btn-danger:hover{background:#b91c1c}
.btn-purple{background:#7c3aed;color:#fff}.btn-purple:hover{background:#6d28d9}
.btn-dark{background:#334155;color:#e2e8f0}.btn-dark:hover{background:#475569}
.btn-dispense{background:linear-gradient(135deg,#059669,#0284c7);color:#fff;padding:12px 18px;font-size:13px;border-radius:8px}
.form-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}
label{display:block;font-size:11px;color:#94a3b8;margin-bottom:4px;font-weight:600}
input{width:100%;padding:8px 10px;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#f8fafc;font-size:13px}
input:focus{outline:none;border-color:#00f2fe}
.col-header{padding:8px 12px;border-radius:6px;margin-bottom:10px;font-weight:700;font-size:13px}
.col-header-1{background:rgba(2,132,199,.2);color:#38bdf8;border-left:4px solid #0284c7}
.col-header-2{background:rgba(5,150,105,.2);color:#34d399;border-left:4px solid #059669}
</style>
</head>
<body>
<header>
  <div>
    <h1>ESP32 QUAD SERVO & VENDING CENTER</h1>
    <p>Dieu khien 4 Servo (2 Cot Vending FIFO) - Active Ground Clamping 0V</p>
  </div>
  <div class="badge-live"><span class="pulse"></span> ONLINE <span id="hdr-ip">192.168.4.1</span></div>
</header>
<nav>
  <button class="active" onclick="showTab('tab-overview')">Tong Quan</button>
  <button onclick="showTab('tab-action')">Ban Dieu Khien</button>
  <button onclick="showTab('tab-config')">Cau Hinh NVS</button>
</nav>
<main>
  <!-- TAB OVERVIEW -->
  <div id="tab-overview" class="section active">
    <!-- Vending Dispenser Status -->
    <div class="card">
      <h2>BO NHA TO BAN HANG TU DONG (FIFO DUAL-COLUMN)</h2>
      <div class="grid-2">
        <div class="stat-box">
          <div class="col-header col-header-1">COT 1: TAO (APPLE)</div>
          <div class="stat-tag">Trang thai nha to:</div>
          <div class="stat-val" id="col1-state">San sang</div>
          <div class="stat-sub">S1(GPIO 1 - Duoi) & S2(GPIO 2 - Tren)</div>
          <div style="margin-top:10px">
            <button class="btn btn-dispense" onclick="apiCmd('DISPENSE 1')">&#10003; NHA TO COT 1 (FIFO)</button>
          </div>
        </div>
        <div class="stat-box">
          <div class="col-header col-header-2">COT 2: DUA LUOI (MELON)</div>
          <div class="stat-tag">Trang thai nha to:</div>
          <div class="stat-val" id="col2-state">San sang</div>
          <div class="stat-sub">S3(GPIO 12 - Duoi) & S4(GPIO 13 - Tren)</div>
          <div style="margin-top:10px">
            <button class="btn btn-dispense" onclick="apiCmd('DISPENSE 2')">&#10003; NHA TO COT 2 (FIFO)</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 4 Servos Stat Matrix -->
    <div class="card">
      <h2>TRANG THAI 4 KENH SERVO</h2>
      <div class="grid-4">
        <div class="stat-box">
          <div class="stat-tag">SERVO 1 (Cot 1 Duoi)</div>
          <div class="stat-val" id="s1-state">San sang</div>
          <div class="stat-sub" id="s1-info">Chu ky: 0/1</div>
        </div>
        <div class="stat-box">
          <div class="stat-tag">SERVO 2 (Cot 1 Tren)</div>
          <div class="stat-val" id="s2-state">San sang</div>
          <div class="stat-sub" id="s2-info">Chu ky: 0/1</div>
        </div>
        <div class="stat-box">
          <div class="stat-tag">SERVO 3 (Cot 2 Duoi)</div>
          <div class="stat-val" id="s3-state">San sang</div>
          <div class="stat-sub" id="s3-info">Chu ky: 0/1</div>
        </div>
        <div class="stat-box">
          <div class="stat-tag">SERVO 4 (Cot 2 Tren)</div>
          <div class="stat-val" id="s4-state">San sang</div>
          <div class="stat-sub" id="s4-info">Chu ky: 0/1</div>
        </div>
      </div>
    </div>

    <!-- IR Detector Deck -->
    <div class="card">
      <h2>CAM BIEN HONG NGOAI NHAN DIEN TO (GPIO 10)</h2>
      <div class="grid-2">
        <div class="stat-box">
          <div class="stat-tag">Trang thai tia:</div>
          <div class="stat-val" id="ir-state" style="color:#10b981">THONG SUOT</div>
          <div class="stat-sub" id="ir-count">Tong to di qua: 0</div>
        </div>
        <div class="btn-deck" style="align-items:center">
          <button class="btn btn-dark" onclick="apiCmd('IR_TRIGGER')">Xung to ao</button>
          <button class="btn btn-danger" onclick="apiCmd('IR_RESET')">Reset bo dem</button>
        </div>
      </div>
    </div>
  </div>

  <!-- TAB ACTION DECK -->
  <div id="tab-action" class="section">
    <!-- Master Deck -->
    <div class="card">
      <h2>DIEU KHIEN DONG THOI TOAN HE THONG (MASTER)</h2>
      <div class="btn-deck">
        <button class="btn btn-success" onclick="apiCmd('ALL_OPEN')">Mo Tat Ca (4 Servo)</button>
        <button class="btn btn-primary" onclick="apiCmd('ALL_CLOSE')">Dong Tat Ca (4 Servo)</button>
        <button class="btn btn-purple" onclick="apiCmd('ALL_START')">Chay Chu Ky Tat Ca</button>
        <button class="btn btn-danger" onclick="apiCmd('ALL_STOP')">DUNG KHAN CAP (0V CLAMP)</button>
      </div>
    </div>

    <!-- Column 1 Servos -->
    <div class="card">
      <h2>COT 1 (TAO) - SERVO 1 (DUOI) & SERVO 2 (TREN)</h2>
      <div class="col-header col-header-1">SERVO 1 (GPIO 1 / 18 - Cua duoi xa to)</div>
      <div class="btn-deck">
        <button class="btn btn-success" onclick="apiCmd('S1_OPEN')">Mo S1</button>
        <button class="btn btn-primary" onclick="apiCmd('S1_CLOSE')">Dong S1</button>
        <button class="btn btn-purple" onclick="apiCmd('S1_START')">Chu Ky S1</button>
        <button class="btn btn-danger" onclick="apiCmd('S1_STOP')">Dung S1</button>
        <button class="btn btn-dark" onclick="apiCmd('S1_TEST_FWD')">Test Thuan</button>
        <button class="btn btn-dark" onclick="apiCmd('S1_TEST_REV')">Test Nghich</button>
      </div>
      <div class="col-header col-header-1" style="margin-top:14px">SERVO 2 (GPIO 2 / 19 - Cua tren giu/nap to)</div>
      <div class="btn-deck">
        <button class="btn btn-success" onclick="apiCmd('S2_OPEN')">Mo S2</button>
        <button class="btn btn-primary" onclick="apiCmd('S2_CLOSE')">Dong S2</button>
        <button class="btn btn-purple" onclick="apiCmd('S2_START')">Chu Ky S2</button>
        <button class="btn btn-danger" onclick="apiCmd('S2_STOP')">Dung S2</button>
        <button class="btn btn-dark" onclick="apiCmd('S2_TEST_FWD')">Test Thuan</button>
        <button class="btn btn-dark" onclick="apiCmd('S2_TEST_REV')">Test Nghich</button>
      </div>
    </div>

    <!-- Column 2 Servos -->
    <div class="card">
      <h2>COT 2 (DUA LUOI) - SERVO 3 (DUOI) & SERVO 4 (TREN)</h2>
      <div class="col-header col-header-2">SERVO 3 (GPIO 12 / 21 - Cua duoi xa to)</div>
      <div class="btn-deck">
        <button class="btn btn-success" onclick="apiCmd('S3_OPEN')">Mo S3</button>
        <button class="btn btn-primary" onclick="apiCmd('S3_CLOSE')">Dong S3</button>
        <button class="btn btn-purple" onclick="apiCmd('S3_START')">Chu Ky S3</button>
        <button class="btn btn-danger" onclick="apiCmd('S3_STOP')">Dung S3</button>
        <button class="btn btn-dark" onclick="apiCmd('S3_TEST_FWD')">Test Thuan</button>
        <button class="btn btn-dark" onclick="apiCmd('S3_TEST_REV')">Test Nghich</button>
      </div>
      <div class="col-header col-header-2" style="margin-top:14px">SERVO 4 (GPIO 13 / 22 - Cua tren giu/nap to)</div>
      <div class="btn-deck">
        <button class="btn btn-success" onclick="apiCmd('S4_OPEN')">Mo S4</button>
        <button class="btn btn-primary" onclick="apiCmd('S4_CLOSE')">Dong S4</button>
        <button class="btn btn-purple" onclick="apiCmd('S4_START')">Chu Ky S4</button>
        <button class="btn btn-danger" onclick="apiCmd('S4_STOP')">Dung S4</button>
        <button class="btn btn-dark" onclick="apiCmd('S4_TEST_FWD')">Test Thuan</button>
        <button class="btn btn-dark" onclick="apiCmd('S4_TEST_REV')">Test Nghich</button>
      </div>
    </div>
  </div>

  <!-- TAB CONFIG -->
  <div id="tab-config" class="section">
    <div class="card">
      <h2>CAU HINH THONG SO NVS FLASH (4 SERVO)</h2>
      <form id="cfg-form" onsubmit="saveConfig(event)">
        <!-- S1 -->
        <div class="col-header col-header-1">SERVO 1 (COT 1 DUOI)</div>
        <div class="form-grid">
          <div><label>Diem Dung (0-180)</label><input type="number" id="cfg-stop1" value="90"></div>
          <div><label>Toc Do Thuan (0-180)</label><input type="number" id="cfg-fwd1" value="110"></div>
          <div><label>Toc Do Nghich (0-180)</label><input type="number" id="cfg-rev1" value="70"></div>
          <div><label>Thoi Gian Thuan (ms)</label><input type="number" id="cfg-fwdMs1" value="1000"></div>
          <div><label>Thoi Gian Nghich (ms)</label><input type="number" id="cfg-revMs1" value="1000"></div>
          <div><label>Thoi Gian Dung (ms)</label><input type="number" id="cfg-pauseMs1" value="500"></div>
        </div>

        <!-- S2 -->
        <div class="col-header col-header-1" style="margin-top:14px">SERVO 2 (COT 1 TREN)</div>
        <div class="form-grid">
          <div><label>Diem Dung (0-180)</label><input type="number" id="cfg-stop2" value="90"></div>
          <div><label>Toc Do Thuan (0-180)</label><input type="number" id="cfg-fwd2" value="110"></div>
          <div><label>Toc Do Nghich (0-180)</label><input type="number" id="cfg-rev2" value="70"></div>
          <div><label>Thoi Gian Thuan (ms)</label><input type="number" id="cfg-fwdMs2" value="1000"></div>
          <div><label>Thoi Gian Nghich (ms)</label><input type="number" id="cfg-revMs2" value="1000"></div>
          <div><label>Thoi Gian Dung (ms)</label><input type="number" id="cfg-pauseMs2" value="500"></div>
        </div>

        <!-- S3 -->
        <div class="col-header col-header-2" style="margin-top:14px">SERVO 3 (COT 2 DUOI)</div>
        <div class="form-grid">
          <div><label>Diem Dung (0-180)</label><input type="number" id="cfg-stop3" value="90"></div>
          <div><label>Toc Do Thuan (0-180)</label><input type="number" id="cfg-fwd3" value="110"></div>
          <div><label>Toc Do Nghich (0-180)</label><input type="number" id="cfg-rev3" value="70"></div>
          <div><label>Thoi Gian Thuan (ms)</label><input type="number" id="cfg-fwdMs3" value="1000"></div>
          <div><label>Thoi Gian Nghich (ms)</label><input type="number" id="cfg-revMs3" value="1000"></div>
          <div><label>Thoi Gian Dung (ms)</label><input type="number" id="cfg-pauseMs3" value="500"></div>
        </div>

        <!-- S4 -->
        <div class="col-header col-header-2" style="margin-top:14px">SERVO 4 (COT 2 TREN)</div>
        <div class="form-grid">
          <div><label>Diem Dung (0-180)</label><input type="number" id="cfg-stop4" value="90"></div>
          <div><label>Toc Do Thuan (0-180)</label><input type="number" id="cfg-fwd4" value="110"></div>
          <div><label>Toc Do Nghich (0-180)</label><input type="number" id="cfg-rev4" value="70"></div>
          <div><label>Thoi Gian Thuan (ms)</label><input type="number" id="cfg-fwdMs4" value="1000"></div>
          <div><label>Thoi Gian Nghich (ms)</label><input type="number" id="cfg-revMs4" value="1000"></div>
          <div><label>Thoi Gian Dung (ms)</label><input type="number" id="cfg-pauseMs4" value="500"></div>
        </div>

        <div style="margin-top:16px;display:flex;gap:10px">
          <button type="submit" class="btn btn-success">Luu Cau Hinh Vao NVS Flash</button>
          <button type="button" class="btn btn-danger" onclick="apiCmd('RESET')">Khoi Phuc Mac Dinh</button>
        </div>
      </form>
    </div>
  </div>
</main>

<script>
function showTab(id) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  event.target.classList.add('active');
}

async function apiCmd(cmd) {
  try {
    await fetch('/api/cmd', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({cmd})
    });
    updateStatus();
  } catch(e) {
    console.error(e);
  }
}

async function saveConfig(e) {
  e.preventDefault();
  const params = new URLSearchParams();
  for (let ch = 1; ch <= 4; ch++) {
    params.append('stop' + ch, document.getElementById('cfg-stop' + ch).value);
    params.append('forward' + ch, document.getElementById('cfg-fwd' + ch).value);
    params.append('reverse' + ch, document.getElementById('cfg-rev' + ch).value);
    params.append('forwardMs' + ch, document.getElementById('cfg-fwdMs' + ch).value);
    params.append('reverseMs' + ch, document.getElementById('cfg-revMs' + ch).value);
    params.append('pauseMs' + ch, document.getElementById('cfg-pauseMs' + ch).value);
  }
  await fetch('/api/config', {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: params.toString()
  });
  alert('Da luu cau hinh 4 servo vao NVS Flash!');
}

async function updateStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (!data.ok) return;

    if (data.ip) document.getElementById('hdr-ip').innerText = data.ip;

    // S1..S4
    ['s1','s2','s3','s4'].forEach((k) => {
      if (data[k]) {
        document.getElementById(k + '-state').innerText = data[k].state || 'San sang';
        document.getElementById(k + '-info').innerText = 'Chu ky: ' + (data[k].cycle||0) + '/' + (data[k].cycles||1);
      }
    });

    // Columns
    if (data.col1) document.getElementById('col1-state').innerText = data.col1.state || 'San sang';
    if (data.col2) document.getElementById('col2-state').innerText = data.col2.state || 'San sang';

    // IR
    if (data.ir) {
      document.getElementById('ir-state').innerText = data.ir.detected ? 'TO DANG CHAN TIA!' : 'THONG SUOT';
      document.getElementById('ir-state').style.color = data.ir.detected ? '#ef4444' : '#10b981';
      document.getElementById('ir-count').innerText = 'Tong to di qua: ' + data.ir.count;
    }
  } catch(e) {}
}

setInterval(updateStatus, 500);
updateStatus();
</script>
</body>
</html>
)rawliteral";
