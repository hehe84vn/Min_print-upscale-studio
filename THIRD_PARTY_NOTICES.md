# Third-party notices

Print Upscale Studio is original clean-room application code. It does not bundle
FD Advertising code, license logic, or assets.

## Bundled Upscayl runtime

The all-in-one desktop builds bundle an official Upscayl runtime and selected
NCNN model files as an external local process. Upscayl and upscayl-ncnn are
separate projects licensed under AGPL-3.0.

- https://github.com/upscayl/upscayl
- https://github.com/upscayl/upscayl-ncnn

The installer includes the corresponding license text and source/credit links in
the bundled runtime directory. Print Upscale Studio is not an official Upscayl
product.

## Real-ESRGAN experimental benchmark model weight

Model Lab bundles the official NCNN `realesrgan-x4plus` model weight from the
Real-ESRGAN project. The weight is executed by the bundled native Local AI
engine for each target platform.

Sources:

- https://github.com/xinntao/Real-ESRGAN
- https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan

Real-ESRGAN is licensed under BSD-3-Clause. The installer includes the license
text and release source information in the bundled runtime directory. Print
Upscale Studio is not an official Real-ESRGAN product.

## QR and barcode validation

V2.3 uses `@zxing/library` for local multi-format QR and barcode decoding. The
library is licensed under Apache-2.0 and supports formats including QR Code,
Data Matrix, Code 128, EAN and UPC.

- https://github.com/zxing-js/library

Code values are processed locally. Benchmark reports store a SHA-256 digest and
a short preview instead of relying on a remote scanning service.

## Runtime libraries

- Electron: MIT
- Sharp: Apache-2.0
- `@zxing/library`: Apache-2.0
- `@neplex/vectorizer`: MIT, Node.js bindings based on VTracer
- VTracer: MIT

Before commercial distribution, perform a full dependency and model-weight
license audit. This notice is not legal advice.
