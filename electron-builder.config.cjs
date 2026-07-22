const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const sharp = require('sharp');

const runtimeDirectory = path.resolve(__dirname, 'vendor', 'upscayl', `${process.platform}-${process.arch}`);
const autoTraceDirectory = path.resolve(__dirname, 'vendor', 'autotrace', `${process.platform}-${process.arch}`);
const colorProfilesDirectory = path.resolve(__dirname, 'vendor', 'color-profiles');

const extraResources = [
  {
    from: runtimeDirectory,
    to: 'upscayl-runtime',
    filter: ['**/*']
  },
  {
    from: colorProfilesDirectory,
    to: 'color-profiles',
    filter: ['**/*']
  }
];

if (fs.existsSync(autoTraceDirectory)) {
  extraResources.push({
    from: autoTraceDirectory,
    to: 'autotrace-runtime',
    filter: ['**/*']
  });
}

async function createPngFixture(outputPath) {
  const svg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <rect width="64" height="64" fill="#ffffff"/>
      <circle cx="32" cy="32" r="20" fill="#000000"/>
    </svg>
  `);
  await sharp(svg)
    .png({ palette: true, colours: 2, dither: 0 })
    .toFile(outputPath);
}

function packagedResourcesDirectory(context) {
  if (context.electronPlatformName === 'darwin') {
    const appBundle = fs.readdirSync(context.appOutDir).find((name) => name.endsWith('.app'));
    if (!appBundle) throw new Error(`Không tìm thấy .app trong ${context.appOutDir}`);
    return path.join(context.appOutDir, appBundle, 'Contents', 'Resources');
  }
  if (context.electronPlatformName === 'win32') return path.join(context.appOutDir, 'resources');
  return null;
}

async function validatePackagedAutoTrace(context) {
  const resourcesDirectory = packagedResourcesDirectory(context);
  if (!resourcesDirectory) return;
  const executable = path.join(
    resourcesDirectory,
    'autotrace-runtime',
    'bin',
    context.electronPlatformName === 'win32' ? 'autotrace.exe' : 'autotrace'
  );
  if (!fs.existsSync(executable)) throw new Error(`Installer thiếu AutoTrace runtime: ${executable}`);
  if (context.electronPlatformName === 'darwin') fs.chmodSync(executable, 0o755);

  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'packaged-autotrace-'));
  const inputPath = path.join(workspace, 'fixture.png');
  const outputPath = path.join(workspace, 'fixture.svg');
  await createPngFixture(inputPath);
  const env = {
    ...process.env,
    HOME: workspace,
    AUTOTRACE_BINARY: '',
    DYLD_LIBRARY_PATH: '',
    DYLD_FALLBACK_LIBRARY_PATH: '',
    MAGICK_CONFIGURE_PATH: ''
  };
  if (context.electronPlatformName === 'darwin') env.PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

  try {
    const result = spawnSync(executable, [
      '-input-format', 'png',
      '-output-format', 'svg',
      '-output-file', outputPath,
      '-color-count', '2',
      '-background-color', 'FFFFFF',
      '-despeckle-level', '0',
      inputPath
    ], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30000,
      env
    });
    if (result.error || result.status !== 0) {
      throw new Error(`Packaged AutoTrace failed (${result.status}): ${result.error?.message || result.stderr || result.stdout || 'unknown error'}`);
    }
    const svg = fs.readFileSync(outputPath, 'utf8');
    if (!/<svg\b/i.test(svg) || !/<(?:path|polygon|polyline)\b/i.test(svg)) {
      throw new Error('Packaged AutoTrace không tạo SVG hợp lệ.');
    }
    console.log(`Packaged AutoTrace verified in ${resourcesDirectory}`);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

module.exports = {
  appId: 'vn.min.printupscalestudio',
  productName: 'Print Upscale Studio',
  asar: true,
  directories: {
    output: 'release',
    buildResources: 'build'
  },
  files: [
    'src/**/*',
    'package.json',
    'LICENSE',
    'THIRD_PARTY_NOTICES.md'
  ],
  extraResources,
  afterPack: validatePackagedAutoTrace,
  mac: {
    category: 'public.app-category.graphics-design',
    target: ['dmg'],
    artifactName: '${productName}-${version}-mac-${arch}.${ext}',
    minimumSystemVersion: '12.0',
    hardenedRuntime: false,
    gatekeeperAssess: false
  },
  dmg: { sign: false },
  win: { target: ['nsis', 'portable'] },
  nsis: {
    artifactName: '${productName}-${version}-windows-${arch}-setup.${ext}',
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Print Upscale Studio'
  },
  portable: {
    artifactName: '${productName}-${version}-windows-${arch}-portable.${ext}'
  },
  asarUnpack: [
    'node_modules/@neplex/vectorizer*/**/*',
    'node_modules/@img/**/*',
    'node_modules/sharp/**/*'
  ]
};
