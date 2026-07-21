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

## Real-ESRGAN experimental benchmark runtime and models

Model Lab V2.1 bundles the official portable NCNN runtime and the following
models from the Real-ESRGAN project:

- `realesrnet-x4plus`
- `realesrgan-x4plus`

Sources:

- https://github.com/xinntao/Real-ESRGAN
- https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan

Real-ESRGAN is licensed under BSD-3-Clause. The installer includes the license
text and release source information in the bundled runtime directory. Print
Upscale Studio is not an official Real-ESRGAN product.

## Runtime libraries

- Electron: MIT
- Sharp: Apache-2.0
- `@neplex/vectorizer`: MIT, Node.js bindings based on VTracer
- VTracer: MIT

Before commercial distribution, perform a full dependency and model-weight
license audit. This notice is not legal advice.
