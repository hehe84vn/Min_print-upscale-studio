# Print Upscale Studio V2.1 Experimental

Ứng dụng desktop hybrid dành cho workflow hình ảnh, bao bì và in ấn:

- **Local Enhance**: tăng kích thước bằng bộ xử lý AI cục bộ, không gửi ảnh ra ngoài và không tốn phí API.
- **AI Enhance**: gửi ảnh tới Gemini hoặc OpenAI để tái tạo chi tiết theo ba mức Safe, Balanced và Creative.
- **Restore Safe**: khử nhiễu, phục hồi tương phản/màu và làm nét có kiểm soát.
- **Text & Artwork**: tăng độ nét chữ raster mà không OCR, không thay font và không sửa nội dung.
- **Vector Logo**: chuyển logo màu, logo một màu, con dấu hoặc line art sang SVG bằng VTracer.
- **Model Lab**: chạy cùng một ảnh qua nhiều model local, nhập Photoshop Reference và so sánh A/B bằng zoom/pan đồng bộ.
- **Print Inspector**: hiển thị kích thước pixel, dung lượng, hệ màu và kích thước in tham khảo ở 300 DPI.

Đây là code clean-room mới hoàn toàn. Dự án không chứa code, license key hoặc tài sản của FD Advertising.

## Trạng thái bản 2.1.0

- Windows 10/11 x64.
- macOS 12 trở lên, build riêng Intel x64 và Apple Silicon arm64.
- Nhúng sẵn runtime Local AI và bảy model Upscayl hiện có.
- Model Lab nhúng thêm runtime NCNN và hai model chính thức từ Real-ESRGAN.
- Gemini dùng `gemini-3.1-flash-image` hoặc `gemini-3-pro-image`.
- OpenAI dùng `gpt-image-2` qua Images Edit API.
- API key do người dùng tự nhập và được mã hóa bằng Electron `safeStorage` của hệ điều hành.
- API key không lưu trong `settings.json`, không gửi về renderer và không commit lên GitHub.
- AI Cloud cần Internet và phát sinh phí trực tiếp trên tài khoản API của người dùng.

## Model Lab

Model Lab là khu vực thử nghiệm nội bộ để chọn pipeline tốt hơn cho ảnh chụp, packshot và artwork bao bì. Nó không tự kết luận model nào tốt nhất; người dùng kiểm tra trực tiếp chữ, logo, hình học, màu phẳng, gradient, texture và halo.

Các pipeline hiện có:

- **Current · High Fidelity**: model ảnh chụp hiện tại của app.
- **Current · Packaging**: Remacri hiện tại, dùng làm mốc artwork/bao bì.
- **RealESRNet x4plus · Fidelity**: ưu tiên cấu trúc và độ trung thực.
- **RealESRGAN x4plus · Detail**: ưu tiên texture và độ nét cảm nhận.
- **Packaging Hybrid**: trộn RealESRNet với RealESRGAN ở mức Detail 5–45%, mặc định 20%.

Quy trình test:

1. Chọn ảnh nguồn.
2. Chuyển sang **Model Lab · Experimental**.
3. Chọn tỷ lệ 2×, 3× hoặc 4×.
4. Có thể nhập file đã upscale bằng Photoshop làm **Photoshop Reference**.
5. Chọn các model cần chạy và thư mục lưu.
6. Chạy Model Lab.
7. Dùng hai menu A/B, thanh chia và zoom tới 800% để so cùng một vị trí.

Model Lab luôn xuất PNG lossless và tạo `benchmark-report.json` trong thư mục kết quả. File report ghi thời gian, kích thước, model, lỗi và đường dẫn đầu ra.

### Lưu ý cho bao bì

- `RealESRNet x4plus` nên được kiểm tra trước khi cần giữ chữ, logo và hình học.
- `RealESRGAN x4plus` có thể cho texture rõ hơn nhưng dễ tạo halo hoặc thay đổi chi tiết nhỏ.
- `Packaging Hybrid` mặc định chỉ dùng 20% ảnh Detail; đây chưa phải hệ thống mask bảo vệ chữ/logo hoàn chỉnh.
- Barcode, QR, chữ nhỏ, màu spot và artwork cuối cùng vẫn phải kiểm tra trong Photoshop/Illustrator.

## Cấu hình AI Cloud

Trong ứng dụng, mở **Cài đặt → AI Provider & API key**:

1. Chọn Gemini hoặc OpenAI làm provider mặc định.
2. Nhập API key tương ứng.
3. Bấm **Lưu cài đặt**.
4. Bấm **Kiểm tra** để xác nhận key và kết nối.
5. Mở **AI Enhance**, chọn provider, model và mức tái tạo.

### Gemini

- Nano Banana 2: `gemini-3.1-flash-image`.
- Nano Banana Pro: `gemini-3-pro-image`.
- V2 yêu cầu đầu ra 2K hoặc 4K bằng Gemini Interactions API.

### OpenAI

- Model: `gpt-image-2`.
- Dùng chế độ image edit với input fidelity cao.
- Kích thước đầu ra để API tự lựa chọn theo ảnh nguồn.

## Các mức AI Enhance

- **Safe**: ưu tiên giữ nhận dạng, bố cục, màu, chữ và logo sát ảnh gốc.
- **Balanced**: tái tạo texture vừa phải, phù hợp ảnh quảng cáo và ảnh chụp thông thường.
- **Creative**: tái dựng mạnh hơn, có nguy cơ thay đổi chi tiết nhỏ.

AI tạo sinh không bảo đảm giữ chính xác tuyệt đối chữ, logo, barcode, màu in hoặc khuôn mặt. Luôn kiểm tra Before/After trước khi dùng cho artwork chính thức.

## Chạy ở chế độ phát triển

Yêu cầu Node.js 22 trở lên.

```bash
npm install
npm start
```

Kiểm tra cú pháp và chạy smoke test cho các pipeline local:

```bash
npm run check
```

Smoke test không gọi Gemini, OpenAI hoặc chạy model NCNN lớn và không phát sinh phí API.

## Local AI Engine

Runtime được nhúng trong installer all-in-one. Người dùng thông thường chỉ thấy trạng thái **Local AI Engine: Sẵn sàng**.

Khi cần xử lý sự cố, mở:

**Cài đặt → Cấu hình Local Engine nâng cao**

Model Upscayl hiện có:

- `upscayl-standard-4x`
- `upscayl-lite-4x`
- `high-fidelity-4x`
- `remacri-4x`
- `ultramix-balanced-4x`
- `ultrasharp-4x`
- `digital-art-4x`

Model chính thức từ Real-ESRGAN trong Model Lab:

- `realesrnet-x4plus`
- `realesrgan-x4plus`

Build script tải các runtime/model từ release chính thức, chép license và ghi `SOURCE_AND_CREDITS.md` vào thư mục runtime của installer.

## Build file cài đặt

### Windows

```bash
npm install
npm run dist:win
```

Kết quả trong `release/`:

- NSIS installer `.exe`
- Portable `.exe`

### macOS

```bash
npm install
npm run dist:mac:arm64
# hoặc trên Mac Intel
npm run dist:mac:x64
```

Kết quả trong `release/`:

- `.dmg`

## GitHub Actions

Workflow `.github/workflows/build-desktop.yml`:

- kiểm tra cú pháp và smoke test trên Ubuntu;
- build Windows x64;
- build macOS Apple Silicon và Intel;
- tải runtime/model chính thức trong lúc build;
- upload installer vào **Actions → Artifacts**;
- khi push tag `v*`, tự tạo GitHub Release.

## Chưa ký số

Workflow mặc định xuất file unsigned:

- Windows có thể hiện SmartScreen “Unknown publisher”.
- macOS có thể chặn Gatekeeper.

Để phân phối ổn định, cần Windows code-signing certificate và Apple Developer ID/notarization.

## License

Code ứng dụng: MIT. Xem `THIRD_PARTY_NOTICES.md` trước khi phân phối, đặc biệt với runtime Local AI và từng model weight.
