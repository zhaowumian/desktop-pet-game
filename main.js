const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');

let mainWindow = null;
let pets = [];
let petIdCounter = 0;
let mousePos = null; // 鼠标当前位置（渲染进程上报）

// 逃跑触发半径（像素）
const FLEE_RADIUS = 160;
// 逃跑速度倍率
const FLEE_SPEED_MULTIPLIER = 7.2;

// 宠物类型配置
const PET_TYPES = [
  { name: '小猫', emoji: '🐱', speed: 2, color: '#FFB6C1' },
  { name: '小狗', emoji: '🐕', speed: 3, color: '#87CEEB' },
  { name: '兔子', emoji: '🐰', speed: 4, color: '#98FB98' },
  { name: '仓鼠', emoji: '🐹', speed: 2, color: '#DDA0DD' },
  { name: '小鸟', emoji: '🐦', speed: 5, color: '#F0E68C' },
  { name: '乌龟', emoji: '🐢', speed: 1, color: '#20B2AA' },
];

// 随机生成宠物的时间间隔（30-60分钟）
const SPAWN_INTERVAL_MIN = 30 * 60 * 1000; // 30分钟
const SPAWN_INTERVAL_MAX = 60 * 60 * 1000; // 60分钟

// 创建主窗口（透明覆盖层）
function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: width,
    height: height,
    x: 0,
    y: 0,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    },
    hasShadow: false,
    fullscreenable: false,
    minimizable: false,
    maximizable: false
  });

  mainWindow.loadFile('index.html');
  // 默认鼠标穿透，但转发鼠标移动事件用于检测是否在宠物上
  mainWindow.setIgnoreMouseEvents(true, { forward: true });
  mainWindow.setAlwaysOnTop(true, 'screen-saver');

  // 页面加载完成后立即生成一只宠物，再开始定时调度
  mainWindow.webContents.once('did-finish-load', () => {
    spawnPet();
    scheduleNextSpawn();
  });
}

// 切换鼠标穿透状态
ipcMain.on('set-ignore-mouse-events', (event, ignore) => {
  if (mainWindow) {
    mainWindow.setIgnoreMouseEvents(ignore, { forward: true });
  }
});

// 退出应用
ipcMain.on('app-quit', () => {
  app.quit();
});

// 手动召唤宠物
ipcMain.on('spawn-pet-now', () => {
  spawnPet();
});

// 接收渲染进程上报的鼠标位置
ipcMain.on('mouse-position', (event, pos) => {
  mousePos = { x: pos.x, y: pos.y, t: Date.now() };
});

// 安排下一次宠物生成
function scheduleNextSpawn() {
  const delay = Math.random() * (SPAWN_INTERVAL_MAX - SPAWN_INTERVAL_MIN) + SPAWN_INTERVAL_MIN;
  console.log(`下一只宠物将在 ${Math.round(delay / 1000 / 60)} 分钟后出现`);
  
  setTimeout(() => {
    spawnPet();
    scheduleNextSpawn(); // 递归调度下一次
  }, delay);
}

// 生成宠物
function spawnPet() {
  if (!mainWindow) return;

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const petType = PET_TYPES[Math.floor(Math.random() * PET_TYPES.length)];
  
  // 随机位置（避免边缘）
  const x = Math.random() * (width - 200) + 100;
  const y = Math.random() * (height - 200) + 100;

  const pet = {
    id: ++petIdCounter,
    type: petType.name,
    emoji: petType.emoji,
    color: petType.color,
    x: x,
    y: y,
    vx: (Math.random() - 0.5) * petType.speed * 2,
    vy: (Math.random() - 0.5) * petType.speed * 2,
    speed: petType.speed,
    size: 60,
    isCaught: false,
    directionChangeTime: Date.now(),
    directionChangeInterval: Math.random() * 3000 + 2000 // 2-5秒改变方向
  };

  pets.push(pet);
  mainWindow.webContents.send('pet-spawned', pet);
  
  console.log(`生成了新宠物: ${pet.type} at (${x}, ${y})`);
}

// 移动所有宠物
function movePets() {
  if (!mainWindow) return;
  
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const now = Date.now();

  pets.forEach(pet => {
    if (pet.isCaught) {
      pet.fleeing = false;
      return;
    }

    // 检测鼠标是否靠近，靠近则逃离
    let fleeing = false;
    if (mousePos && now - mousePos.t < 2000) {
      const cx = pet.x + pet.size / 2;
      const cy = pet.y + pet.size / 2;
      const ddx = cx - mousePos.x;
      const ddy = cy - mousePos.y;
      const dist = Math.hypot(ddx, ddy);

      if (dist < FLEE_RADIUS && dist > 0.01) {
        fleeing = true;
        const fleeSpeed = pet.speed * FLEE_SPEED_MULTIPLIER;
        const targetVx = (ddx / dist) * fleeSpeed;
        const targetVy = (ddy / dist) * fleeSpeed;
        // 平滑过渡到逃跑方向，避免瞬间变向
        pet.vx += (targetVx - pet.vx) * 0.3;
        pet.vy += (targetVy - pet.vy) * 0.3;
        // 逃跑期间暂停随机变向
        pet.directionChangeTime = now;
      }
    }
    pet.fleeing = fleeing;

    // 非逃跑状态下随机改变方向
    if (!fleeing && now - pet.directionChangeTime > pet.directionChangeInterval) {
      pet.vx = (Math.random() - 0.5) * pet.speed * 2;
      pet.vy = (Math.random() - 0.5) * pet.speed * 2;
      pet.directionChangeTime = now;
      pet.directionChangeInterval = Math.random() * 3000 + 2000;
    }

    // 更新位置
    pet.x += pet.vx;
    pet.y += pet.vy;

    // 边界反弹
    if (pet.x < 0 || pet.x > width - pet.size) {
      pet.vx *= -1;
      pet.x = Math.max(0, Math.min(pet.x, width - pet.size));
    }
    if (pet.y < 0 || pet.y > height - pet.size) {
      pet.vy *= -1;
      pet.y = Math.max(0, Math.min(pet.y, height - pet.size));
    }
  });

  // 发送更新后的宠物位置
  mainWindow.webContents.send('pets-moved', pets);
}

// 处理捕捉宠物
ipcMain.on('pet-caught', (event, petId) => {
  const pet = pets.find(p => p.id === petId);
  if (pet) {
    pet.isCaught = true;
    mainWindow.webContents.send('pet-caught-confirmed', petId);
  }
});

// 处理宠物放入回收站
ipcMain.on('pet-recycled', (event, petId) => {
  const index = pets.findIndex(p => p.id === petId);
  if (index !== -1) {
    pets.splice(index, 1);
    mainWindow.webContents.send('pet-removed', petId);
    console.log(`宠物 ${petId} 已被回收`);
  }
});

// 释放宠物（如果没放进回收站）
ipcMain.on('pet-released', (event, petId) => {
  const pet = pets.find(p => p.id === petId);
  if (pet) {
    pet.isCaught = false;
  }
});

app.whenReady().then(() => {
  createWindow();

  // 游戏循环
  setInterval(movePets, 16); // ~60fps

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
