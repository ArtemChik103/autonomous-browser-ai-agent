import { chromium } from 'playwright';
import http from 'http';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';

async function main() {
  console.log('=== [1/5] Starting Local Web Server for Demo Harness ===');
  const app = express();
  app.use(express.static(path.resolve('./public')));
  
  const server = http.createServer(app);
  const port = 3847;
  await new Promise<void>((resolve) => server.listen(port, resolve));
  console.log(`Server listening at http://localhost:${port}`);

  const recordingsDir = path.resolve('./recordings');
  if (!fs.existsSync(recordingsDir)) {
    fs.mkdirSync(recordingsDir, { recursive: true });
  } else {
    for (const f of fs.readdirSync(recordingsDir)) {
      try {
        fs.unlinkSync(path.join(recordingsDir, f));
      } catch {}
    }
  }

  console.log('=== [2/5] Launching Playwright Chromium with 1920x1080 Video Recorder ===');
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--font-render-hinting=medium'
    ]
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: {
      dir: recordingsDir,
      size: { width: 1920, height: 1080 }
    }
  });

  const page = await context.newPage();
  console.log('=== [3/5] Loading Side-by-Side Simulation (Browser Left, CLI Right) ===');
  await page.goto(`http://localhost:${port}/demo-screen.html`, { waitUntil: 'networkidle' });

  console.log('Waiting for agent automation sequence to complete...');
  await page.waitForFunction(() => (window as any).__DEMO_FINISHED === true, {
    timeout: 60000
  });

  console.log('Demo sequence finished. Adding 2.5s outro pause for viewing results...');
  await page.waitForTimeout(2500);

  console.log('=== [4/5] Finalizing Raw WebM Recording ===');
  await page.close();
  await context.close();
  await browser.close();
  server.close();

  const webmFiles = fs.readdirSync(recordingsDir).filter((f) => f.endsWith('.webm'));
  if (webmFiles.length === 0) {
    throw new Error('No recorded video file found in ./recordings');
  }

  const rawVideoPath = path.join(recordingsDir, webmFiles[0]);
  console.log(`Raw video saved: ${rawVideoPath} (${(fs.statSync(rawVideoPath).size / 1024).toFixed(1)} KB)`);

  console.log('=== [5/5] Transcoding to Universal H.264 MP4 via FFmpeg ===');
  // Dynamic import of ffmpeg-static
  const ffmpegModule = await import('ffmpeg-static');
  const ffmpegPath: string = (ffmpegModule.default || ffmpegModule) as any;

  const outputMp4 = path.resolve('./demo.mp4');
  if (fs.existsSync(outputMp4)) {
    fs.unlinkSync(outputMp4);
  }

  execFileSync(
    ffmpegPath,
    [
      '-i',
      rawVideoPath,
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-r',
      '30',
      '-movflags',
      '+faststart',
      '-y',
      outputMp4
    ],
    { stdio: 'inherit' }
  );

  const stats = fs.statSync(outputMp4);
  console.log(`\n======================================================`);
  console.log(`✅ DEMO VIDEO SUCCESSFULLY GENERATED: demo.mp4`);
  console.log(`   Path: ${outputMp4}`);
  console.log(`   Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   Resolution: 1920x1080 @ 30fps H.264`);
  console.log(`======================================================\n`);
}

main().catch((err) => {
  console.error('Fatal error during demo recording:', err);
  process.exit(1);
});
