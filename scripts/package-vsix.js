/**
 * Minimal .vsix packager — avoids needing @vscode/vsce when npm is missing.
 * A VSIX is a zip with [Content_Types].xml, extension.vsixmanifest, and extension/**.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const outName = `${pkg.name}-${pkg.version}.vsix`;
const staging = path.join(root, '.vsix-staging');
const extDir = path.join(staging, 'extension');

fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(extDir, { recursive: true });

const include = [
  'package.json',
  'README.md',
  'language-configuration.json',
  'out',
  'media',
  'syntaxes',
  'chuck',
  'examples',
  'bin',
];

for (const item of include) {
  const src = path.join(root, item);
  if (!fs.existsSync(src)) {
    continue;
  }
  execFileSync('cp', ['-a', src, path.join(extDir, item)]);
}

const manifest = `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${pkg.name}" Version="${pkg.version}" Publisher="${pkg.publisher}" />
    <DisplayName>${pkg.displayName}</DisplayName>
    <Description>${escapeXml(pkg.description)}</Description>
    <Tags></Tags>
    <Categories>Other</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${pkg.engines.vscode}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code"/>
  </Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
  </Assets>
</PackageManifest>
`;

const contentTypes = `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension=".json" ContentType="application/json"/>
  <Default Extension=".vsixmanifest" ContentType="text/xml"/>
  <Default Extension=".js" ContentType="application/javascript"/>
  <Default Extension=".css" ContentType="text/css"/>
  <Default Extension=".md" ContentType="text/markdown"/>
  <Default Extension=".ck" ContentType="text/plain"/>
  <Default Extension=".svg" ContentType="image/svg+xml"/>
  <Default Extension=".map" ContentType="application/json"/>
</Types>
`;

fs.writeFileSync(path.join(staging, 'extension.vsixmanifest'), manifest);
fs.writeFileSync(path.join(staging, '[Content_Types].xml'), contentTypes);

const vsixPath = path.join(root, outName);
fs.rmSync(vsixPath, { force: true });

// Python zipfile produces a real ZIP (bsdtar -a can write non-ZIP formats).
execFileSync(
  'python3',
  [
    '-c',
    `
import os, zipfile, sys
staging, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk(staging):
        for name in files:
            full = os.path.join(root, name)
            arc = os.path.relpath(full, staging)
            z.write(full, arc)
`,
    staging,
    vsixPath,
  ],
  { stdio: 'inherit' }
);

fs.rmSync(staging, { recursive: true, force: true });
console.log('Wrote', vsixPath);

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
