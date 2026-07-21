# Print Upscale Studio V2.2 Experimental

Ứng dụng desktop hybrid dành cho workflow hình ảnh, bao bì và in ấn:

- **Local Enhance**: tăng kích thước bằng bộ xử lý AI cục bộ, không gửi ảnh ra ngoài và không tốn phí API.
- **AI Enhance**: gửi ảnh tới Gemini hoặc OpenAI để tái tạo chi tiết theo ba mức Safe, Balanced và Creative.
- **Restore Safe**: khử nhiễu, phục hồi tương phản/màu và làm nét có kiểm soát.
- **Text & Artwork**: tăng độ nét chữ raster mà không OCR, không thay font và không sửa nội dung.
- **Vector Logo**: chuyển logo màu, logo một màu, con dấu hoặc line art sang SVG bằng VTracer.
- **Model Lab**: chạy cùng một ảnh qua bốn pipeline local, nhập Photoshop Reference và so sánh A/B bằng zoom/pan đồng bộ.
- **Packaging Safe Pro V0.1**: tạo protection mask để giảm Detail tại chữ, logo, đường biên và hình học mạnh.
- **Print Inspector**: hiển thị kích thước pixel, dung lượng, hệ màu và kích thước in tham khảo ở 300 DPI.

Đây là code clean-room mới hoàn toàn. Dự án không chứa code, license key hoặc tài sản của FD Advertising.

## Trạng thái bản 2.2.0

- Windows 10/11 x64.
- macOS 12 trở lên, build riêng Intel x64 và Apple Silicon arm64.
- Nhúng sẵn runtime Local AI và bảy model Upscayl hiện có.
- Model Lab bổ sung trọng số NCNN `realesrgan-x4plus` từ Real-ESRGAN và chạy bằng Local AI Engine native của từng nền tảng.
- API key do người dùng tự nhập và được mã hóa bằng Electron `safeStorage` của hệ điều hành.
- AI Cloud cần Internet và phát sinh phí trực tiếp trên tài khoản API của người dùng.

## Bốn pipeline giữ lại

- **Current · High Fidelity**: giữ cấu trúc ảnh và dùng làm nền fidelity.
- **Current · Packaging**: Remacri hiện tại, phù hợp artwork và bao bì.
- **RealESRGAN · Detail**: ưu tiên texture và độ nét cảm nhận.
- **Packaging Hybrid**: High Fidelity + RealESRGAN Detail + protection mask tùy chọn.

## Packaging Safe Pro V0.1

Khi bật **Tự động bảo vệ chữ, logo và cạnh hình học**, app:

1. Resize ảnh nguồn đúng kích thước đầu ra.
2. Tạo high-frequency edge mask từ ảnh gốc.
3. Mở rộng và làm mềm vùng biên để bảo vệ chữ, logo và hình học mạnh.
4. Cho phép RealESRGAN Detail tác động nhiều hơn ở vùng tối của mask.
5. Giữ High Fidelity ở vùng sáng của mask.
6. Xuất thêm file `protection-mask.png` để kiểm tra trực tiếp.

Trong mask:

- vùng sáng: ưu tiên High Fidelity;
- vùng tối: cho phép nhận thêm RealESRGAN Detail.

Điều chỉnh:

- **Detail trong Hybrid**: 5–45%, mặc định 20%; bao bì nên thử 15–25%.
- **Độ nhạy protection mask**: 20–95, mặc định 65.
- Tăng độ nhạy khi chữ/cạnh chưa được bảo vệ đủ.
- Giảm độ nhạy khi mask phủ quá nhiều texture tự nhiên.

Đây là mask hình học dựa trên cạnh, chưa phải OCR hoặc semantic segmentation. Barcode, QR, chữ nhỏ, màu spot và artwork cuối cùng vẫn phải kiểm tra trong Photoshop/Illustrator.

## Quy trình test

1. Chọn ảnh nguồn.
2. Chuyển sang **Model Lab · Experimental**.
3. Chọn tỷ lệ 2×, 3× hoặc 4×.
4. Có thể nhập file Photoshop Reference.
5. Giữ bốn pipeline hoặc bỏ chọn pipeline không cần chạy.
6. Bật protection mask, thử độ nhạy 55, 65 và 75.
7. Chạy Model Lab.
8. So sánh A/B ở 100%, 200% và 400%.
9. Chọn `Packaging Hybrid · Protection Mask` để xem vùng được bảo vệ.

Model Lab luôn xuất PNG lossless và tạo `benchmark-report.json`. Report ghi model, thời gian, kích thước, Detail Strength, độ nhạy mask và tỷ lệ diện tích được bảo vệ.

## Cấu hình AI Cloud

Trong ứng dụng, mở **Cài đặt → AI Provider & API key**:

1. Chọn Gemini hoặc OpenAI làm provider mặc định.
2. Nhập API key tương ứng.
3. Bấm **Lưu cài đặt**.
4. Bấm **Kiểm tra** để xác nhận key và kết nối.
5. Mở **AI Enhance**, chọn provider, model và mức tái tạo.

AI tạo sinh không bảo đảm giữ chính xác tuyệt đối chữ, logo, barcode, màu in hoặc khuôn mặt. Luôn kiểm tra Before/After trước khi dùng cho artwork chính thức.

## Chạy ở chế độ phát triển

Yêu cầu Node.js 22 trở lên.

```bash
npm install
npm start
```

Kiểm tra cú pháp và chạy smoke test:

```bash
npm run check
```

Smoke test kiểm tra cả protection mask và protected blend, nhưng không gọi Gemini/OpenAI hoặc chạy model NCNN lớn.

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

Build script tải runtime/model từ release chính thức, chép license và ghi `SOURCE_AND_CREDITS.md` vào thư mục runtime của installer.

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

- `print-upscale-studio-v2.2-windows-x64`
- `print-upscale-studio-v2.2-macos-arm64`
- `print-upscale-studio-v2.2-macos-x64`

## Chưa ký số

- Windows có thể hiện SmartScreen “Unknown publisher”.
- macOS có thể chặn Gatekeeper.

Để phân phối ổn định, cần Windows code-signing certificate và Apple Developer ID/notarization.

## License

Code ứng dụng: MIT. Xem `THIRD_PARTY_NOTICES.md` trước khi phân phối, đặc biệt với runtime Local AI và từng model weight.
