# Print Upscale Studio V2.3 Semantic Guard

Ứng dụng desktop hybrid dành cho workflow hình ảnh, bao bì và in ấn:

- **Local Enhance**: tăng kích thước bằng bộ xử lý AI cục bộ, không gửi ảnh ra ngoài và không tốn phí API.
- **AI Enhance**: gửi ảnh tới Gemini hoặc OpenAI để tái tạo chi tiết.
- **Restore Safe**: khử nhiễu, phục hồi tương phản/màu và làm nét có kiểm soát.
- **Text & Artwork**: tăng độ nét chữ raster mà không OCR, không thay font và không sửa nội dung.
- **Vector Logo**: chuyển logo màu, logo một màu, con dấu hoặc line art sang SVG bằng VTracer.
- **Model Lab**: chạy cùng một ảnh qua bốn pipeline local, nhập Photoshop Reference và so sánh A/B bằng zoom/pan đồng bộ.
- **Packaging Safe Pro V0.2**: semantic text/logo protection kết hợp QR & Barcode Guard.
- **Print Inspector**: hiển thị kích thước pixel, dung lượng, hệ màu và kích thước in tham khảo ở 300 DPI.

Đây là code clean-room mới hoàn toàn. Dự án không chứa code, license key hoặc tài sản của FD Advertising.

## Trạng thái bản 2.3.0

- Windows 10/11 x64.
- macOS 12 trở lên, build riêng Intel x64 và Apple Silicon arm64.
- Nhúng runtime Local AI và bảy model Upscayl hiện có.
- Model Lab bổ sung trọng số NCNN `realesrgan-x4plus` từ Real-ESRGAN.
- QR/barcode được kiểm tra local bằng ZXing; không dùng dịch vụ scan bên ngoài.
- API key AI Cloud được mã hóa bằng Electron `safeStorage`.

## Bốn pipeline giữ lại

- **Current · High Fidelity**: giữ cấu trúc ảnh và dùng làm nền fidelity.
- **Current · Packaging**: Remacri hiện tại, phù hợp artwork và bao bì.
- **RealESRGAN · Detail**: ưu tiên texture và độ nét cảm nhận.
- **Packaging Hybrid**: High Fidelity + RealESRGAN Detail + Semantic Guard.

## Packaging Safe Pro V0.2

Khi bật protection, app tạo ba lớp mask:

1. **Structural Mask**: cạnh mạnh và hình học.
2. **Text/Logo Semantic Mask**: vùng có mật độ nét, hướng stroke và độ phẳng cục bộ giống chữ/logo.
3. **QR/Barcode Guard Mask**: vùng mã được ZXing phát hiện và khóa bảo vệ.

Ba lớp được gộp thành **Combined Protection Mask**:

- vùng sáng: ưu tiên High Fidelity;
- vùng tối: cho phép nhận thêm RealESRGAN Detail.

Semantic Mask là phân tích heuristic local, không phải OCR và không gõ lại nội dung. Nó giảm tình trạng texture tự nhiên bị bảo vệ nhầm so với mask chỉ dựa trên cạnh, nhưng vẫn cần kiểm tra trực quan.

## QR & Barcode Guard

App hỗ trợ kiểm tra các định dạng phổ biến như QR Code, Data Matrix, Code 128, EAN, UPC, ITF và Codabar.

Quy trình:

1. Đọc mã trên ảnh nguồn.
2. Đưa toàn vùng mã vào protection mask.
3. Kiểm tra lại mã trên Packaging Hybrid sau xử lý.
4. Nếu mã không còn đọc được hoặc sai nội dung, app tự phục hồi vùng đó từ ảnh nguồn bằng nội suy nearest-neighbour.
5. Kiểm tra lại lần cuối và ghi trạng thái vào `benchmark-report.json`.

Trạng thái có thể là:

- `pass`: mã vẫn đọc đúng;
- `pass + restored`: app đã tự phục hồi và đọc lại thành công;
- `unreadable`: mã nguồn đọc được nhưng kết quả cuối không đọc được;
- `mismatch`: mã kết quả khác mã nguồn;
- `not-detected`: app không phát hiện được mã trên ảnh nguồn.

Code Guard hiện kiểm tra mã đầu tiên đọc được trong ảnh. Artwork cuối cùng vẫn cần kiểm tra trong Photoshop/Illustrator và bằng phần mềm preflight chuyên dụng.

## File xuất từ Model Lab

Model Lab luôn xuất PNG lossless và tạo:

- bốn kết quả pipeline đã chọn;
- `*_protection-mask.png`;
- `*_text-logo-mask.png`;
- `*_barcode-mask.png` khi phát hiện mã;
- `benchmark-report.json`.

Report ghi model, thời gian, kích thước, Detail Strength, độ nhạy mask, coverage từng lớp và trạng thái Code Guard. Giá trị mã được đối chiếu bằng SHA-256; report chỉ lưu thêm preview ngắn để kiểm tra thủ công.

## Quy trình test đề xuất

1. Chọn ảnh nguồn bao bì hoặc packshot.
2. Vào **Model Lab**.
3. Chọn 2× hoặc 3×.
4. Giữ cả bốn pipeline.
5. Bật:
   - `Text/Logo Semantic Protection`;
   - `QR & Barcode Guard`.
6. Đặt Detail 20%, sensitivity 65.
7. Chạy và kiểm tra:
   - Combined Mask;
   - Text/Logo Semantic Mask;
   - QR/Barcode Guard Mask;
   - trạng thái mã trong danh sách kết quả.
8. So sánh A/B ở 100%, 200% và 400%.

## Chạy ở chế độ phát triển

Yêu cầu Node.js 22 trở lên.

```bash
npm install
npm start
```

Kiểm tra cú pháp và smoke test:

```bash
npm run check
```

Smoke test kiểm tra semantic mask, protected blend và QR decode nhưng không gọi Gemini/OpenAI hoặc chạy model NCNN lớn.

## Local AI Engine

Model Upscayl hiện có:

- `upscayl-standard-4x`
- `upscayl-lite-4x`
- `high-fidelity-4x`
- `remacri-4x`
- `ultramix-balanced-4x`
- `ultrasharp-4x`
- `digital-art-4x`

Model Real-ESRGAN trong Model Lab:

- `realesrgan-x4plus`

## Build file cài đặt

### Windows

```bash
npm install
npm run dist:win
```

### macOS Apple Silicon

```bash
npm install
npm run dist:mac:arm64
```

### macOS Intel

```bash
npm install
npm run dist:mac:x64
```

Workflow GitHub Actions upload các artifact:

- `print-upscale-studio-v2.3-windows-x64`
- `print-upscale-studio-v2.3-macos-arm64`
- `print-upscale-studio-v2.3-macos-x64`

## Chưa ký số

- Windows có thể hiện SmartScreen “Unknown publisher”.
- macOS có thể chặn Gatekeeper.

Để phân phối ổn định, cần Windows code-signing certificate và Apple Developer ID/notarization.

## License

Code ứng dụng: MIT. Xem `THIRD_PARTY_NOTICES.md` trước khi phân phối, đặc biệt với runtime Local AI và từng model weight.
