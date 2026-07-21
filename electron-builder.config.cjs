const path = require('node:path');

const runtimeDirectory = path.resolve(__dirname, 'vendor', 'upscayl', `${process.platform}-${process.arch}`);

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
  extraResources: [
    {
      from: runtimeDirectory,
      to: 'upscayl-runtime',
      filter: ['**/*']
    }
  ],
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
