// 遊戲區域設定（中央顯示，非全螢幕）
const GAME_W = 800;
const GAME_H = 600;
let gameOffsetX, gameOffsetY, scaleV;

let video;
let handpose;
let predictions = [];
let balloons = [];
let maxBalloons = 8; // 增加氣球數量
let balloonImg; // 可自行加入氣球圖片
let gunMuzzles = [];
let bullets = [];
let muzzleHistory = [[], []]; // 記錄雙手食指尖座標
let shootCooldown = [0, 0]; // 雙手發射冷卻
let bulletInterval = 6; // 子彈冷卻幀數（加快連射）
let bulletImg;

// 緩衝區與發射鎖定
let gestureBuffer = [[], []]; // 每手10幀緩衝
let fireLock = [false, false];
const GESTURE_BUFFER_SIZE = 10;
const GESTURE_FIRE_THRESHOLD = 6; // 10幀內有6幀是1就發射
const GESTURE_STOP_THRESHOLD = 10; // 10幀都不是1才停止

// --- 氣球與文字掉落設定 ---
const BALLOON_TEXT = '歡迎加入淡江教育科技系';
let textBlocks = [];
let nextTextIndex = 0;
let lastTextClearTime = 0;
let textDropRound = 0;

function getRandomBalloonColor() {
  // 隨機顏色（七彩範圍）
  return color(random(180, 255), random(80, 255), random(80, 255));
}

function preload() {
  bulletImg = loadImage('1.png');
}

function setup() {
  createCanvas(windowWidth, windowHeight); // 讓 canvas 隨視窗變動
  video = createCapture(VIDEO);
  video.size(GAME_W, GAME_H);
  video.hide();
  handpose = ml5.handpose(video, modelReady);
  handpose.on('predict', results => {
    predictions = results;
  });
  for (let i = 0; i < maxBalloons; i++) {
    spawnBalloon();
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight); // canvas 跟著視窗變動
}

function spawnBalloon() {
  let x = random(40, GAME_W - 40);
  let y = random(-200, -40);
  let r = random(22, 36);
  // 使用 getRandomBalloonColor 產生七彩氣球
  let c = getRandomBalloonColor();
  balloons.push({ x, y, r, alive: true, c });
}

function modelReady() {
  // 模型載入完成，可選擇顯示訊息
}

function draw() {
  background(0);
  // 計算中央偏移，讓遊戲畫面置中
  let offsetX = (width - GAME_W) / 2;
  let offsetY = (height - GAME_H) / 2;
  push();
  translate(offsetX, offsetY);
  // 攝像頭畫面等比例顯示（不拉伸），鏡像顯示，完全對齊 GAME_W, GAME_H
  if (video.width > 0 && video.height > 0) {
    let scaleV = Math.min(GAME_W / video.width, GAME_H / video.height);
    let drawW = video.width * scaleV;
    let drawH = video.height * scaleV;
    let vOffsetX = (GAME_W - drawW) / 2;
    let vOffsetY = (GAME_H - drawH) / 2;
    push();
    translate(vOffsetX + drawW, vOffsetY);
    scale(-1, 1);
    image(video, 0, 0, drawW, drawH);
    pop();

    // 畫氣球
    for (let i = 0; i < balloons.length; i++) {
      let b = balloons[i];
      if (b.alive) {
        drawBalloon(b);
        b.y += 1.2;
        if (b.y - b.r > GAME_H) {
          b.x = random(40, GAME_W - 40);
          b.y = random(-200, -40);
          b.r = random(22, 36);
          b.c = getRandomBalloonColor(); // 修正：補正顏色
          b.alive = true;
        }
      }
    }
    // --- 文字方塊物理與疊加 ---
    for (let tb of textBlocks) {
      // 溶解特效：5秒後開始 alpha 遞減
      let elapsed = millis() - (tb.spawnTime || 0);
      let dissolveAlpha = 255;
      if (elapsed > 5000) {
        dissolveAlpha = map(elapsed, 5000, 6000, 255, 0, true);
        if (dissolveAlpha <= 0) tb.toRemove = true;
      }
      drawTextBlock(tb, dissolveAlpha);
      if (tb.flashTimer > 0) tb.flashTimer--;
      tb.y += tb.vy;
      tb.vy += 0.4; // 重力
      // 疊加判斷
      let landed = false;
      if (tb.y > GAME_H - tb.h/2) {
        tb.y = GAME_H - tb.h/2;
        landed = true;
      } else {
        for (let other of textBlocks) {
          if (other !== tb && Math.abs(tb.x - other.x) < tb.w && Math.abs(tb.y + tb.h/2 - (other.y - other.h/2)) < 6) {
            let direction = (tb.x <= other.x) ? -1 : 1;
            let tryX = tb.x + direction * tb.w;
            let canStack = true;
            for (let o2 of textBlocks) {
              if (o2 !== tb && Math.abs(tryX - o2.x) < tb.w && Math.abs(tb.y + tb.h/2 - (o2.y - o2.h/2)) < 6) {
                canStack = false;
                break;
              }
            }
            if (canStack && tryX > tb.w/2 && tryX < GAME_W - tb.w/2) {
              tb.x = tryX;
            } else {
              tb.y = other.y - tb.h;
              landed = true;
              break;
            }
          }
        }
      }
      if (landed) {
        if (!tb.bounced) {
          tb.vy = -8; // 彈跳
          tb.bounced = true;
        } else if (Math.abs(tb.vy) < 1) {
          tb.vy = 0;
        }
      }
    }
    // 移除已溶解的方塊
    textBlocks = textBlocks.filter(tb => !tb.toRemove);
    // 立即允許下一輪掉落
    if (nextTextIndex === BALLOON_TEXT.length && textBlocks.filter(tb => tb.vy === 0).length === textBlocks.length) {
      textBlocks = [];
      nextTextIndex = 0;
      textDropRound = 0;
    }

    // --- 雙手偵測與準心顯示 ---
    gunMuzzles = [null, null];
    for (let i = 0; i < 2; i++) {
      if (!muzzleHistory[i]) muzzleHistory[i] = [];
      if (shootCooldown[i] === undefined) shootCooldown[i] = 0;
      if (!gestureBuffer[i]) gestureBuffer[i] = [];
      if (fireLock[i] === undefined) fireLock[i] = false;
      gunMuzzles[i] = null;
    }
    // 只顯示準心，不顯示綠色點與紅色大圓
    let hands = predictions.map(hand => getMirroredLandmarks(hand.landmarks, video.width));
    hands = hands.sort((a, b) => a[0][0] - b[0][0]);
    for (let i = 0; i < 2; i++) {
      if (hands[i]) {
        const landmarks = hands[i];
        const muzzle = landmarks[8];
        // landmarks 轉換到 GAME_W, GAME_H 座標
        let scaleV = Math.min(GAME_W / video.width, GAME_H / video.height);
        let vOffsetX = (GAME_W - video.width * scaleV) / 2;
        let vOffsetY = (GAME_H - video.height * scaleV) / 2;
        // 準心微調：再往左下移一點
        const crosshairOffsetX = -75;
        const crosshairOffsetY = 75;
        drawCrosshair(
          muzzle[0] * scaleV + vOffsetX + crosshairOffsetX,
          muzzle[1] * scaleV + vOffsetY + crosshairOffsetY,
          30, color(255,0,0)
        );
        // 不再繪製綠色點與紅色大圓
      }
    }

    // --- 雙手偵測與準心邏輯（發射/碰撞/手勢都正確）---
    gunMuzzles = [null, null];
    for (let i = 0; i < 2; i++) {
      if (!muzzleHistory[i]) muzzleHistory[i] = [];
      if (shootCooldown[i] === undefined) shootCooldown[i] = 0;
      if (!gestureBuffer[i]) gestureBuffer[i] = [];
      if (fireLock[i] === undefined) fireLock[i] = false;
      gunMuzzles[i] = null;
    }
    let logicHands = predictions.map(hand => getMirroredLandmarks(hand.landmarks, video.width));
    logicHands = logicHands.sort((a, b) => a[0][0] - b[0][0]);
    for (let i = 0; i < 2; i++) {
      if (logicHands[i]) {
        const landmarks = logicHands[i];
        // landmarks 轉換到 GAME_W, GAME_H 座標
        let scaleV = Math.min(GAME_W / video.width, GAME_H / video.height);
        let vOffsetX = (GAME_W - video.width * scaleV) / 2;
        let vOffsetY = (GAME_H - video.height * scaleV) / 2;
        // 準心微調：再往左下移一點
        const crosshairOffsetX = -75;
        const crosshairOffsetY = 75;
        const muzzle = [
          landmarks[8][0] * scaleV + vOffsetX + crosshairOffsetX,
          landmarks[8][1] * scaleV + vOffsetY + crosshairOffsetY
        ];
        const palm = [
          landmarks[0][0] * scaleV + vOffsetX + crosshairOffsetX,
          landmarks[0][1] * scaleV + vOffsetY + crosshairOffsetY
        ];
        gunMuzzles[i] = muzzle;
        // --- 緩衝區 ---
        const isOne = isOneGesture(landmarks);
        gestureBuffer[i].push(isOne);
        if (gestureBuffer[i].length > GESTURE_BUFFER_SIZE) gestureBuffer[i].shift();
        // --- 發射鎖定 ---
        const countOne = gestureBuffer[i].filter(Boolean).length;
        if (countOne >= GESTURE_FIRE_THRESHOLD) {
          fireLock[i] = true;
        } else if (gestureBuffer[i].length === GESTURE_BUFFER_SIZE && countOne === 0) {
          fireLock[i] = false;
        }
        // --- 發射 ---
        if (fireLock[i]) {
          if (shootCooldown[i] <= 0) {
            let dx = muzzle[0] - palm[0];
            let dy = muzzle[1] - palm[1];
            let len = sqrt(dx*dx + dy*dy);
            if (len > 0) {
              dx /= len;
              dy /= len;
            }
            bullets.push({ x: muzzle[0], y: muzzle[1], vx: dx*10, vy: dy*10 });
            shootCooldown[i] = bulletInterval;
          }
          shootCooldown[i]--;
        } else {
          shootCooldown[i] = 0;
        }
      } else {
        gestureBuffer[i] = [];
        fireLock[i] = false;
        gunMuzzles[i] = null;
        shootCooldown[i] = 0;
      }
    }

    // 畫子彈與碰撞
    for (let i = bullets.length - 1; i >= 0; i--) {
      let bullet = bullets[i];
      if (bulletImg) {
        push();
        translate(bullet.x, bullet.y);
        rotate(HALF_PI); // 讓子彈上下顛倒（朝下）
        image(bulletImg, -16, -16, 32, 32);
        pop();
      } else {
        fill(255, 255, 0);
        noStroke();
        ellipse(bullet.x, bullet.y, 12, 12);
      }
      bullet.x += bullet.vx;
      bullet.y += bullet.vy;
      for (let b of balloons) {
        if (b.alive && dist(bullet.x, bullet.y, b.x, b.y) < b.r) {
          b.alive = false;
          bullets.splice(i, 1);
          // 新增：產生文字方塊
          if (nextTextIndex < BALLOON_TEXT.length) {
            let char = BALLOON_TEXT[nextTextIndex];
            let tb = {
              char,
              x: b.x,
              y: b.y,
              w: 54,
              h: 54,
              vy: 0,
              bounced: false,
              flashTimer: 10,
              spawnTime: millis()
            };
            textBlocks.push(tb);
            nextTextIndex++;
            if (nextTextIndex === BALLOON_TEXT.length) {
              textDropRound++;
              lastTextClearTime = millis();
            }
          }
          setTimeout(() => {
            b.x = random(40, GAME_W - 40);
            b.y = random(-200, -40);
            b.r = random(22, 36);
            b.c = getRandomBalloonColor(); // 修正：補正顏色
            b.alive = true;
          }, 800);
          push();
          fill(255,255,0,180);
          ellipse(b.x, b.y, b.r*2.5, b.r*2.5);
          pop();
          break;
        }
      }
      if (bullet.x < 0 || bullet.x > GAME_W || bullet.y < 0 || bullet.y > GAME_H) bullets.splice(i, 1);
    }
  }
  pop();
}

function drawCrosshair(x, y, size, col) {
  stroke(col);
  strokeWeight(4);
  line(x - size/2, y, x + size/2, y);
  line(x, y - size/2, x, y + size/2);
}

function updateMuzzleHistory(idx, muzzle) {
  if (!muzzleHistory[idx]) muzzleHistory[idx] = [];
  muzzleHistory[idx].push([muzzle[0], muzzle[1]]);
  if (muzzleHistory[idx].length > 5) muzzleHistory[idx].shift();
}

function isShaking(idx) {
  if (muzzleHistory[idx].length < 5) return false;
  let d = dist(
    muzzleHistory[idx][0][0], muzzleHistory[idx][0][1],
    muzzleHistory[idx][4][0], muzzleHistory[idx][4][1]
  );
  return d > 30;
}

function canShoot(idx) {
  return shootCooldown[idx] === 0;
}

// 判斷是否為「1」手勢（強化容錯，掌心朝內/外/側/琢骨都可）
function isOneGesture(landmarks) {
  // 食指伸直，其他手指彎曲，且食指與掌心距離遠
  const dIndex = dist3d(landmarks[8], landmarks[5]);
  const dMiddle = dist3d(landmarks[12], landmarks[9]);
  const dRing = dist3d(landmarks[16], landmarks[13]);
  const dPinky = dist3d(landmarks[20], landmarks[17]);
  const minOther = Math.min(dMiddle, dRing, dPinky);
  const dPalm = dist3d(landmarks[8], landmarks[0]);
  const dIndexMiddle = dist3d(landmarks[8], landmarks[12]);
  const dIndexThumb = dist3d(landmarks[8], landmarks[4]);
  // 琢骨朝鏡頭時，食指與小拇指距離會明顯大於其他指
  const dIndexPinky = dist3d(landmarks[8], landmarks[20]);
  // 判斷條件：
  // 1. 一般正面/側面/背面
  // 2. 琢骨朝鏡頭（小拇指與食指距離遠，且其他指彎曲）
  const normalOne = (
    dIndex > minOther + 8 &&
    dMiddle < 45 && dRing < 45 && dPinky < 45 &&
    dPalm > 60 &&
    dIndexMiddle > 10 &&
    dIndexThumb > 10
  );
  const pinkyFacing = (
    dIndexPinky > 80 && // 食指與小拇指距離夠遠
    dMiddle < 45 && dRing < 45 &&
    dPalm > 40 // 琢骨朝鏡頭時掌心距離會較小
  );
  return normalOne || pinkyFacing;
}

function dist3d(a, b) {
  return dist(a[0], a[1], b[0], b[1]);
}

function getMirroredLandmarks(landmarks, videoWidth) {
  return landmarks.map(([x, y, z]) => [videoWidth - x, y, z]);
}

function drawBalloon(b, idx) {
  push();
  translate(b.x, b.y);

  // 如果 b.color 沒設定，就設定一次，這樣保證每顆都有
  if (!b.color) {
    b.color = getRandomBalloonColor();
  }

  let baseColor = b.color;

  // 畫恐龍蛋風格：漸層橢圓
  for (let i = b.r * 1.2; i > 0; i -= 2) {
    let inter = map(i, b.r * 1.2, 0, 0, 1);
    let c = lerpColor(baseColor, color(255, 255, 255), inter * 0.4);
    noStroke();
    ellipse(0, 0, i * 2, i * 2.4); // 拉長橢圓形
  }

  fill(255, 255, 255, 100); // 高光
  noStroke();
  ellipse(-b.r * 0.3, -b.r * 0.4, b.r * 0.8, b.r * 0.5);

  pop();
}

// drawTextBlock 支援 alpha
function drawTextBlock(tb, alpha = 255) {
  push();
  if (tb.flashTimer > 0) {
    fill(255, 255, 120, min(220, alpha));
    stroke(255, 220, 80, min(220, alpha));
    strokeWeight(4);
  } else {
    fill(255, 255, 200, alpha);
    stroke(120, alpha);
    strokeWeight(2);
  }
  rect(tb.x - tb.w/2, tb.y - tb.h/2, tb.w, tb.h, 8);
  fill(80, 40, 0, alpha);
  noStroke();
  textAlign(CENTER, CENTER);
  textSize(28);
  text(tb.char, tb.x, tb.y);
  pop();
}

