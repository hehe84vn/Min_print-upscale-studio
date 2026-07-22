const fs = require('node:fs');
const path = require('node:path');

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
