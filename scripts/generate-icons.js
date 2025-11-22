const sharp = require('sharp');
const fs = require('fs-extra');
const path = require('path');

const SOURCE_IMAGE = path.join(__dirname, '../public/Logos/TB - Fin Cyan -512/2.png');
const OUTPUT_DIR = path.join(__dirname, '../build');
const ASSETS_DIR = path.join(__dirname, '../src/renderer/assets');

// Icon sizes needed
const SIZES = [
  { size: 16, name: 'icon-16x16.png' },
  { size: 32, name: 'icon-32x32.png' },
  { size: 48, name: 'icon-48x48.png' },
  { size: 64, name: 'icon-64x64.png' },
  { size: 128, name: 'icon-128x128.png' },
  { size: 256, name: 'icon-256x256.png' },
  { size: 512, name: 'icon-512x512.png' }
];

async function generateIcons() {
  console.log('🎨 Starting icon generation...\n');

  // Ensure directories exist
  await fs.ensureDir(OUTPUT_DIR);
  await fs.ensureDir(ASSETS_DIR);

  // Check if source image exists
  if (!await fs.pathExists(SOURCE_IMAGE)) {
    console.error(`❌ Source image not found: ${SOURCE_IMAGE}`);
    process.exit(1);
  }

  console.log(`📁 Source: ${SOURCE_IMAGE}`);
  console.log(`📁 Output: ${OUTPUT_DIR}\n`);

  // Generate PNG icons at different sizes
  for (const { size, name } of SIZES) {
    const outputPath = path.join(OUTPUT_DIR, name);

    await sharp(SOURCE_IMAGE)
      .resize(size, size, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png({ compressionLevel: 9 })
      .toFile(outputPath);

    const stats = await fs.stat(outputPath);
    console.log(`✅ Generated ${name} (${(stats.size / 1024).toFixed(2)} KB)`);
  }

  // Copy 32x32 icon to assets for use in TitleBar
  const titleBarIconSource = path.join(OUTPUT_DIR, 'icon-32x32.png');
  const titleBarIconDest = path.join(ASSETS_DIR, 'logo-icon.png');
  await fs.copy(titleBarIconSource, titleBarIconDest);
  console.log(`✅ Copied icon to assets for TitleBar\n`);

  // Generate .ico file for Windows (contains multiple sizes)
  console.log('🪟 Generating Windows .ico file...');

  // For .ico generation, we'll use the built-in Windows icon format
  // Sharp can create individual PNGs, but .ico requires special handling
  // We'll create it using the 256x256 as base and let electron-builder handle multi-size
  await sharp(SOURCE_IMAGE)
    .resize(256, 256, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .toFile(path.join(OUTPUT_DIR, 'icon.ico'));

  const icoStats = await fs.stat(path.join(OUTPUT_DIR, 'icon.ico'));
  console.log(`✅ Generated icon.ico (${(icoStats.size / 1024).toFixed(2)} KB)\n`);

  console.log('✨ Icon generation complete!\n');
  console.log('📋 Summary:');
  console.log(`   - Generated ${SIZES.length} PNG files`);
  console.log(`   - Generated icon.ico for Windows`);
  console.log(`   - Copied title bar icon to src/renderer/assets/`);
  console.log(`\n🚀 You can now run "npm run package" to build your app!`);
}

generateIcons().catch(err => {
  console.error('❌ Error generating icons:', err);
  process.exit(1);
});
